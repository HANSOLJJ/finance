// ============================================================================
// 증권사 잔고 자동 동기화 (한투 연금저축·ISA / 키움 국내·미국 / 빗썸).
// 자산 입력 탭의 🏦 버튼 → GET /api/broker(서버가 3사 조회·정규화) →
// computeBrokerDiff(순수 함수)로 현재 state.holdings 와 비교 →
// 미리보기 모달에서 확인 → [적용] 시 반영. 설정 탭의 🔑 API 키 카드도 담당.
// [소유권 규칙] 동기화가 만든 행에는 h.source(소스 id, 예수금은 '<id>:cash')가
// 찍히고, 삭제는 그 마커 행만 대상 — 수동 입력 행은 절대 지우지 않는다.
// 수량·평단·현재가만 덮고 이름/계좌/노출/타입/유동성/메모는 보존한다.
// [안전 규칙] 실패한 소스(ok:false)는 diff 에서 통째로 스킵 — 특히 삭제 판정을
// 하지 않는다 (증권사 장애가 "전량 매도"로 오판되는 사고 방지).
// 로드 순서 constants→state→calc→render→charts→data-io→fetch→sync→broker→main 중
// 9번째 — state/calc(num)/render(escapeHtml·render)/data-io(toast)/fetch(refreshHolding)/
// sync(flushServerSave) 의 전역을 사용하고, main.js 가 window 노출과 초기 호출을 맡는다.
// ============================================================================

// 예수금 행의 배치 — 서버 응답에서 파생한다(하드코딩 테이블 없음).
// 카테고리: source.cashCategory (없으면 계좌 카테고리 그대로). 계좌 섹션 안에 두되
// 자산타입만 '현금'으로 지정해 섹션=계좌 그룹을 유지하면서 자산타입 축 집계는 정확하게.
// 빗썸처럼 카테고리에 assetTypeFixed 가 걸린 곳은 provider 가 cashCategory 를 따로 준다.
// 통화(USD 여부)는 source.cash.currency 로 판정 — provider 별 분기 불필요.
function _bkCashPlan(source) {
  const category = source.cashCategory || source.category;
  const usd = !!(source.cash && source.cash.currency === 'USD');
  // 라벨은 "연결이름 · 카테고리" 형태라 예수금 행 이름에는 연결이름만 쓴다(중복 방지).
  const connName = String(source.label || '').split(' · ')[0];
  return { category, usd, name: `${usd ? '달러 ' : ''}예수금${connName ? ` (${connName})` : ''}` };
}

// dust 기준 — 이보다 작은 신규 항목(예수금·코인)은 행을 만들지 않는다.
// 이미 동기화 행이 존재하면 금액이 작아져도 계속 갱신한다(0원 포함).
const BROKER_DUST_KRW = 10000;
const BROKER_DUST_USD = 10;

// 숫자 비교 허용 오차 — 수량은 코인 8자리 소수까지, 단가는 소수 셋째 자리까지 의미.
const _bkSameNum = (a, b) => Math.abs(a - b) < 1e-9;

// 종목 매칭 키 정규화 — 앱의 ticker/symbol 형식 편차를 흡수한다.
// 국내(6자리): 야후 접미사 .KS/.KQ 제거 / 미국: 대문자 티커 / 암호화폐: 대문자 심볼
// (암호화폐 h.ticker 는 CoinGecko id('bitcoin')라 매칭에 못 쓰고 h.symbol 을 본다).
function _bkKey(category, h) {
  if (category === '암호화폐') return String(h.symbol || '').toUpperCase();
  const raw = String(h.symbol || h.ticker || '').toUpperCase();
  return raw.replace(/\.(KS|KQ)$/, '');
}

// 소스가 덮는 필드 값을 카테고리 유형에 맞게 읽기/쓰기 위한 헬퍼.
// 해외주식(isUSD)은 avgPriceUSD/priceUSD, 그 외는 avgPrice/price 를 쓴다.
function _bkFields(category) {
  const isUSD = !!(CATEGORY_MAP[category] && CATEGORY_MAP[category].isUSD);
  return isUSD
    ? { avg: 'avgPriceUSD', price: 'priceUSD', unit: '$' }
    : { avg: 'avgPrice', price: 'price', unit: '' };
}

// ==================== diff 계산 (순수 함수) ====================
// holdings(현 state)와 서버 정규화 응답(sources)을 비교해 적용 목록을 만든다.
// 반환: { updates, adds, removes, cashChanges, skippedDust, failedSources }
//  - updates: { row, source, changes: [{field,label,from,to}], set: {필드:새값(문자열)} }
//  - adds: { source, newRow(id 없이 — 적용 시 uid 부여) }
//  - removes: { row, source } — h.source === 소스 id 인 행만
//  - cashChanges: { source, row|null, amount, usd, newRow? }
function computeBrokerDiff(holdings, sources) {
  const updates = [], adds = [], removes = [], cashChanges = [], skippedDust = [];
  const failedSources = sources.filter(s => !s.ok);

  for (const source of sources) {
    if (!source.ok) continue; // 실패 소스는 통째 스킵 — 삭제 오판 방지 (최우선 안전 규칙)
    const cat = source.category;
    const f = _bkFields(cat);
    const rows = holdings.filter(h => h.category === cat && h.source !== `${source.id}:cash`);
    const consumed = new Set();

    for (const item of source.holdings) {
      const key = String(item.symbol || '').toUpperCase();
      if (!key) continue;
      // dust — 기존 행에 매칭되면 무조건 포함, 신규 후보만 걸러낸다
      const matched =
        rows.find(r => !consumed.has(r.id) && r.source === source.id && _bkKey(cat, r) === key) ||
        rows.find(r => !consumed.has(r.id) && _bkKey(cat, r) === key);
      const unitPrice = Math.max(item.avgPrice || 0, item.price || 0);
      const dustLimit = item.currency === 'USD' ? BROKER_DUST_USD : BROKER_DUST_KRW;
      if (!matched && (unitPrice === 0 || item.quantity * unitPrice < dustLimit)) {
        skippedDust.push(`${item.name || key} (${source.label})`);
        continue;
      }

      if (matched) {
        consumed.add(matched.id);
        const changes = [];
        const set = { source: source.id, syncedAt: new Date().toISOString() };
        if (!_bkSameNum(num(matched.quantity), item.quantity)) {
          changes.push({ label: '수량', from: num(matched.quantity), to: item.quantity });
          set.quantity = String(item.quantity);
        }
        if (!_bkSameNum(num(matched[f.avg]), item.avgPrice)) {
          changes.push({ label: '평단', from: num(matched[f.avg]), to: item.avgPrice, unit: f.unit });
          set[f.avg] = String(item.avgPrice);
        }
        // 현재가 — 빗썸은 응답에 없음(0). 시세는 앱의 기존 갱신 체계가 담당.
        if (item.price > 0 && !_bkSameNum(num(matched[f.price]), item.price)) {
          changes.push({ label: '현재가', from: num(matched[f.price]), to: item.price, unit: f.unit });
          set[f.price] = String(item.price);
          set.lastFetched = new Date().toISOString();
        }
        if (changes.length) updates.push({ row: matched, source, changes, set });
        else updates.push({ row: matched, source, changes: [], set }); // 마커만 갱신 (변경 없음 그룹)
      } else {
        // 신규 행 — 노출/타입/유동성은 카테고리 기본값(constants.js), 계좌는 소스 라벨.
        // 국내 신규 ticker 는 6자리 코드(시세 갱신이 .KS 자동 부착 — 코스닥 ETF 한계는 수용),
        // 암호화폐는 symbol 만 채운다(ticker=CoinGecko id 는 알 수 없음 — 코인게코 모드 한계).
        const newRow = {
          category: cat, name: item.name || key, account: source.label,
          ticker: cat === '암호화폐' ? '' : item.symbol,
          symbol: item.symbol,
          quantity: String(item.quantity), price: '', priceUSD: '',
          avgPrice: '', avgPriceUSD: '',
          exposure: DEFAULT_EXPOSURE_BY_CAT[cat] || '원화', memo: '',
          assetType: (CATEGORY_MAP[cat] && CATEGORY_MAP[cat].assetTypeFixed) || '주식',
          liquidity: DEFAULT_LIQUIDITY_BY_CAT[cat] || 'liquid',
          lastFetched: '', source: source.id, syncedAt: new Date().toISOString(),
        };
        newRow[f.avg] = String(item.avgPrice || '');
        if (item.price > 0) newRow[f.price] = String(item.price);
        adds.push({ source, newRow });
      }
    }

    // 삭제 판정 — 이 소스가 만든 행(마커 일치)인데 이번 응답에 없는 것 = 전량 매도
    for (const r of rows) {
      if (r.source === source.id && !consumed.has(r.id)) removes.push({ row: r, source });
    }

    // 예수금 — 마커 행(<id>:cash)을 계좌 섹션 안에 생성·관리 (배치는 _bkCashPlan 참조)
    if (source.cash) {
      const place = _bkCashPlan(source);
      const cashRow = holdings.find(h => h.source === `${source.id}:cash`) || null;
      const amount = source.cash.amount;
      const cur = cashRow ? num(place.usd ? cashRow.priceUSD : cashRow.price) : null;
      const dustLimit = place.usd ? BROKER_DUST_USD : BROKER_DUST_KRW;
      if (cashRow) {
        if (!_bkSameNum(cur, amount)) cashChanges.push({ source, row: cashRow, from: cur, to: amount, usd: place.usd });
      } else if (amount >= dustLimit) {
        const cashCat = CATEGORY_MAP[place.category] || {};
        const newRow = {
          category: place.category, name: place.name, account: source.label,
          ticker: '', symbol: '',
          quantity: '1', price: '', priceUSD: '',
          avgPrice: '', avgPriceUSD: '',
          exposure: place.usd ? '달러(노출)' : '원화', memo: '',
          // 예수금은 성격상 현금 — hasTicker 카테고리(연금·ISA 등)에서도 자산타입을 '현금'으로
          assetType: cashCat.assetTypeFixed || '현금',
          liquidity: DEFAULT_LIQUIDITY_BY_CAT[place.category] || 'liquid',
          lastFetched: '', source: `${source.id}:cash`, syncedAt: new Date().toISOString(),
        };
        // ⚠️ kw-us(해외주식 섹션)는 isUSD 카테고리라 priceUSD 에 USD 금액을 넣어야
        // 수량1 × priceUSD × 환율로 환산된다. KRW 계열은 price 에 금액.
        if (place.usd) newRow.priceUSD = String(amount);
        else newRow.price = String(amount);
        cashChanges.push({ source, row: null, from: null, to: amount, usd: place.usd, newRow });
      }
    }
  }

  return { updates, adds, removes, cashChanges, skippedDust, failedSources };
}

// ==================== 미리보기 모달 ====================

// 금액 표시 헬퍼 — USD 는 $ 소수 2자리, KRW 는 콤마 정수.
function _bkFmt(v, usd) {
  if (v === null || v === undefined) return '—';
  return usd ? '$' + Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 })
    : Number(v).toLocaleString('ko-KR', { maximumFractionDigits: 8 });
}

// 🏦 동기화 모달 — 열면 서버 조회 → diff → 미리보기 → [적용].
// debugResponse 를 주면 fetch 를 생략하고 그 응답으로 diff 한다 (로컬 픽스처 검증 훅).
// 모달이 떠 있는 동안은 toast 가 딤 레이어에 가려지므로(z-index) 진행/에러는
// 모달 내부(#bkStatus)에 쓰고, 최종 토스트는 close() 이후에만 띄운다.
async function openBrokerSyncModal(debugResponse) {
  const existing = document.getElementById('bkBackdrop');
  if (existing) existing.remove();

  const backdrop = document.createElement('div');
  backdrop.id = 'bkBackdrop';
  backdrop.className = 'memo-modal-backdrop';
  backdrop.innerHTML = `
    <div class="memo-modal" style="width:min(680px,94vw);">
      <div class="memo-modal-head">
        <div>
          <div class="memo-modal-title">🏦 증권사 잔고 동기화</div>
          <div class="memo-modal-sub">한투 연금저축·ISA / 키움 국내·미국 / 빗썸 — 조회 전용, 적용 전 미리보기</div>
        </div>
        <button class="memo-modal-x" id="bkCloseX" title="닫기">×</button>
      </div>
      <div class="memo-modal-hint" id="bkStatus">서버에서 잔고를 조회하는 중… (증권사별 순차 호출, 수 초 걸림)</div>
      <div id="bkList" style="max-height:60vh;overflow-y:auto;"></div>
      <div class="memo-modal-foot">
        <span class="memo-modal-help" id="bkHint"></span>
        <div style="display:flex;gap:8px;">
          <button class="btn" id="bkCancelBtn">닫기</button>
          <button class="btn primary" id="bkApplyBtn" disabled>적용</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(backdrop);

  const close = () => backdrop.remove();
  document.getElementById('bkCloseX').onclick = close;
  document.getElementById('bkCancelBtn').onclick = close;
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });

  // 1) 조회
  let data = debugResponse;
  if (!data) {
    try {
      const res = await fetch('/api/broker', { cache: 'no-store' });
      data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
    } catch (err) {
      const st = document.getElementById('bkStatus');
      if (st) { st.textContent = `⚠️ 조회 실패: ${err.message}`; st.style.borderLeftColor = '#dc2626'; st.style.background = '#fef2f2'; }
      return;
    }
  }
  if (!document.getElementById('bkBackdrop')) return; // 조회 중 닫힌 경우

  // 2) diff
  const diff = computeBrokerDiff(state.holdings, data.sources);
  const realUpdates = diff.updates.filter(u => u.changes.length > 0);
  const total = realUpdates.length + diff.adds.length + diff.removes.length + diff.cashChanges.length;

  // 3) 미리보기 렌더 — 소스별 그룹. 신규 초록 / 삭제 빨강 / 변경은 전→후.
  const esc = escapeHtml;
  const rowLine = (icon, color, title, detail) => `
    <div style="padding:6px 10px;border-bottom:1px solid var(--border);font-size:12px;">
      <span style="color:${color};font-weight:600;">${icon} ${esc(title)}</span>
      ${detail ? `<span style="color:var(--text-muted);margin-left:6px;">${detail}</span>` : ''}
    </div>`;
  let html = '';
  for (const source of data.sources) {
    const su = realUpdates.filter(u => u.source.id === source.id);
    const sa = diff.adds.filter(a => a.source.id === source.id);
    const sr = diff.removes.filter(r => r.source.id === source.id);
    const sc = diff.cashChanges.filter(c => c.source.id === source.id);
    html += `<div style="padding:8px 10px;background:#f8fafc;border-bottom:1px solid var(--border);font-size:12px;font-weight:700;">
      ${esc(source.label)} <span style="color:var(--text-muted);font-weight:400;">→ ${esc(source.category)}</span>
      ${source.ok ? '' : `<span style="color:#dc2626;font-weight:600;margin-left:6px;">⚠️ ${esc(source.error || '실패')} — 이 계좌는 건너뜀</span>`}
    </div>`;
    if (!source.ok) continue;
    for (const u of su) {
      const parts = u.changes.map(c => `${c.label} ${_bkFmt(c.from, c.unit === '$')} → <b>${_bkFmt(c.to, c.unit === '$')}</b>`).join(' · ');
      html += rowLine('🔄', '#2563eb', u.row.name || _bkKey(source.category, u.row), parts);
    }
    for (const a of sa) {
      const f = _bkFields(a.source.category);
      const usd = f.unit === '$';
      html += rowLine('➕', '#16a34a', `신규: ${a.newRow.name}`,
        `수량 ${_bkFmt(num(a.newRow.quantity), false)} · 평단 ${_bkFmt(num(a.newRow[f.avg]), usd)}`);
    }
    for (const r of sr) {
      html += rowLine('➖', '#dc2626', `삭제 예정: ${r.row.name}`, '이번 조회에 없음 (전량 매도로 판단)');
    }
    for (const c of sc) {
      html += rowLine('💰', '#a16207', c.row ? `예수금: ${c.row.name}` : `예수금 신규: ${c.newRow.name}`,
        `${_bkFmt(c.from, c.usd)} → <b>${_bkFmt(c.to, c.usd)}</b> (D+2)`);
    }
    if (!su.length && !sa.length && !sr.length && !sc.length) {
      html += `<div style="padding:6px 10px;border-bottom:1px solid var(--border);font-size:12px;color:var(--text-muted);">변경 없음</div>`;
    }
  }
  if (diff.skippedDust.length) {
    html += `<div style="padding:6px 10px;font-size:11px;color:var(--text-muted);">소액(dust) ${diff.skippedDust.length}건 제외: ${esc(diff.skippedDust.join(', '))}</div>`;
  }
  document.getElementById('bkList').innerHTML = html;

  const st = document.getElementById('bkStatus');
  st.innerHTML = total === 0
    ? '차이가 없습니다 — 앱과 실계좌가 일치합니다.'
    : `변경 ${realUpdates.length} · 신규 ${diff.adds.length} · <span style="color:#dc2626;">삭제 ${diff.removes.length}</span> · 예수금 ${diff.cashChanges.length}건 — 내용 확인 후 적용하세요.`;
  document.getElementById('bkHint').textContent = '같은 성격의 수기 행(예수금 등)이 따로 있으면 적용 후 직접 삭제하세요';

  // 4) 적용
  const applyBtn = document.getElementById('bkApplyBtn');
  applyBtn.disabled = total === 0;
  applyBtn.textContent = total === 0 ? '적용할 변경 없음' : `적용 (${total}건)`;
  applyBtn.onclick = () => {
    applyBrokerDiff(diff);
    close();
    render();
    toast(`🏦 동기화 적용 — 변경 ${realUpdates.length} · 신규 ${diff.adds.length} · 삭제 ${diff.removes.length} · 예수금 ${diff.cashChanges.length}`);
    // 신규 국내/해외 행은 시세를 즉시 보정 (실패는 조용히 무시 — 다음 전체 갱신이 처리)
    const refreshables = diff.adds.filter(a => a.source.category !== '암호화폐');
    (async () => {
      for (const a of refreshables) {
        const h = state.holdings.find(x => x.source === a.source.id && x.symbol === a.newRow.symbol);
        if (!h) continue;
        try { await refreshHolding(h.id); } catch (_) {}
        await new Promise(r => setTimeout(r, 250));
      }
    })();
  };
}

// diff 적용 — state.holdings 를 실제로 바꾼다. 값은 앱 관례대로 문자열 저장.
// 저장은 saveState()(디바운스) + flushServerSave()(즉시 확정 — 복원과 같은 관례).
function applyBrokerDiff(diff) {
  for (const u of diff.updates) Object.assign(u.row, u.set);
  for (const a of diff.adds) state.holdings.push({ id: uid(), ...a.newRow });
  const removeIds = new Set(diff.removes.map(r => r.row.id));
  if (removeIds.size) state.holdings = state.holdings.filter(h => !removeIds.has(h.id));
  for (const c of diff.cashChanges) {
    if (c.row) {
      if (c.usd) c.row.priceUSD = String(c.to);
      else c.row.price = String(c.to);
      c.row.syncedAt = new Date().toISOString();
    } else {
      state.holdings.push({ id: uid(), ...c.newRow });
    }
  }
  saveState();
  flushServerSave();
}

// ==================== 설정 탭 — 증권사 연결 관리 ====================
// 연결 하나 = { id, provider, label, creds, accounts[] }. 서버(/api/broker-connections)가
// 목록과 함께 provider 메타(입력칸 정의·계좌 모드)를 주므로, 새 증권사가 추가돼도
// 이 UI 코드는 수정할 필요가 없다 — 폼이 메타를 읽어 자동으로 그려진다.
// 자격증명 원본은 서버가 돌려주지 않으므로(마스킹만) 수정 시 빈 칸은 "기존 유지"를 뜻한다.

let _bkConns = [];      // 현재 연결 목록 (자격증명은 마스킹된 상태)
let _bkProviders = {};  // provider 메타 (서버 제공)

// 설정 탭 연결 목록 렌더 — main.js boot() 와 저장/삭제 후에 호출된다.
async function refreshBrokerConnections() {
  const box = document.getElementById('brokerConnList');
  if (!box) return;
  try {
    const res = await fetch('/api/broker-connections', { cache: 'no-store' });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(`HTTP ${res.status}`);
    _bkConns = data.connections || [];
    _bkProviders = data.providers || {};
  } catch (_) {
    box.innerHTML = '<div class="backup-desc">연결 상태를 확인할 수 없습니다 (서버 연결 필요)</div>';
    return;
  }
  if (!_bkConns.length) {
    box.innerHTML = '<div class="backup-desc">등록된 연결이 없습니다. 아래 버튼으로 증권사를 추가하세요.</div>';
    return;
  }
  const esc = escapeHtml;
  box.innerHTML = _bkConns.map(c => {
    const p = _bkProviders[c.provider] || { label: c.provider, accountMode: 'fixed', accounts: [] };
    const accs = p.accountMode === 'fixed' ? (p.accounts || []) : (c.accounts || []);
    const chips = accs.map(a => `<span class="badge" style="margin-right:4px;">${esc(a.category || a.code)}</span>`).join('');
    return `<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--border);flex-wrap:wrap;">
      <div style="flex:1;min-width:160px;">
        <div style="font-weight:600;font-size:13px;">${esc(c.label || p.label)}</div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">${esc(p.label)} · ${chips || '<span style="color:#dc2626">계좌 미지정</span>'}</div>
      </div>
      <button class="btn" data-bk-edit="${esc(c.id)}" style="padding:4px 10px;font-size:12px;">수정</button>
      <button class="btn" data-bk-del="${esc(c.id)}" style="padding:4px 10px;font-size:12px;color:#dc2626;">삭제</button>
    </div>`;
  }).join('');
  box.querySelectorAll('[data-bk-edit]').forEach(b => {
    b.onclick = () => openBrokerConnModal(b.getAttribute('data-bk-edit'));
  });
  box.querySelectorAll('[data-bk-del]').forEach(b => {
    b.onclick = () => deleteBrokerConnection(b.getAttribute('data-bk-del'));
  });
}

// 연결 추가/수정 모달 — provider 를 고르면 credFields 로 입력칸을,
// accountMode 가 'user' 면 계좌 편집 행을 그린다. [계좌 찾기]로 상품코드 자동 발견.
function openBrokerConnModal(connId) {
  const existing = document.getElementById('bkConnBackdrop');
  if (existing) existing.remove();
  const conn = connId ? _bkConns.find(c => c.id === connId) : null;
  const esc = escapeHtml;
  // 편집 중인 계좌 목록 (모달 로컬 상태 — 저장 시에만 서버로 전송)
  let accounts = conn && Array.isArray(conn.accounts) ? conn.accounts.map(a => ({ ...a })) : [];

  const backdrop = document.createElement('div');
  backdrop.id = 'bkConnBackdrop';
  backdrop.className = 'memo-modal-backdrop';
  backdrop.innerHTML = `
    <div class="memo-modal" style="width:min(560px,94vw);">
      <div class="memo-modal-head">
        <div>
          <div class="memo-modal-title">${conn ? '🔗 연결 수정' : '🔗 증권사 연결 추가'}</div>
          <div class="memo-modal-sub">조회 전용 API 키만 등록하세요 — 이 앱은 주문 API를 호출하지 않습니다</div>
        </div>
        <button class="memo-modal-x" id="bkConnCloseX" title="닫기">×</button>
      </div>
      <label style="font-size:12px;">
        <div style="color:var(--text-muted);margin-bottom:4px;">증권사</div>
        <select id="bkConnProvider" class="inp" style="width:100%;border:1px solid var(--border);padding:6px 8px;" ${conn ? 'disabled' : ''}>
          ${Object.entries(_bkProviders).map(([id, p]) =>
            `<option value="${esc(id)}" ${conn && conn.provider === id ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}
        </select>
      </label>
      <label style="font-size:12px;">
        <div style="color:var(--text-muted);margin-bottom:4px;">표시 이름 (선택)</div>
        <input id="bkConnLabel" class="inp" placeholder="예: 한투 연금·ISA" value="${esc(conn ? conn.label : '')}" style="border:1px solid var(--border);padding:6px 8px;width:100%;" />
      </label>
      <div id="bkConnCreds" class="hist-form-grid"></div>
      <div id="bkConnAccounts"></div>
      <div class="memo-modal-hint" id="bkConnMsg" style="display:none;"></div>
      <div class="memo-modal-foot">
        <span class="memo-modal-help">수정 시 빈 칸은 기존 값을 유지합니다</span>
        <div style="display:flex;gap:8px;">
          <button class="btn" id="bkConnCancel">취소</button>
          <button class="btn primary" id="bkConnSave">저장</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(backdrop);

  const close = () => backdrop.remove();
  const msgEl = document.getElementById('bkConnMsg');
  const showMsg = (text, isError) => {
    msgEl.style.display = 'block';
    msgEl.textContent = text;
    msgEl.style.borderLeftColor = isError ? '#dc2626' : '#0e7490';
    msgEl.style.background = isError ? '#fef2f2' : '#ecfeff';
  };

  const collectCreds = (p) => {
    const creds = {};
    for (const f of p.credFields) {
      const el = document.getElementById(`bkc_${f.key}`);
      if (el && el.value.trim()) creds[f.key] = el.value.trim();
    }
    return creds;
  };

  // 계좌 행 렌더 — 코드 입력 + 카테고리 select. 카테고리 목록은 앱의 CATEGORIES 그대로.
  const renderAccRows = (p) => {
    const box = document.getElementById('bkConnAccRows');
    if (!box) return;
    if (!accounts.length) {
      box.innerHTML = '<div class="backup-desc">계좌를 1개 이상 추가하세요 (🔍 계좌 찾기 권장)</div>';
      return;
    }
    box.innerHTML = accounts.map((a, i) => `
      <div style="display:grid;grid-template-columns:100px 1fr 28px;gap:6px;margin-bottom:6px;align-items:center;">
        <input class="inp" data-acc-code="${i}" value="${esc(a.code)}" placeholder="${esc(p.accountCodeLabel || '코드')}" style="border:1px solid var(--border);padding:5px 8px;font-size:12px;" />
        <select class="inp" data-acc-cat="${i}" style="border:1px solid var(--border);padding:5px 8px;font-size:12px;">
          <option value="">카테고리 선택…</option>
          ${CATEGORIES.filter(c => !c.isDebt).map(c => `<option value="${esc(c.key)}" ${a.category === c.key ? 'selected' : ''}>${esc(c.key)}</option>`).join('')}
        </select>
        <button class="icon-btn" data-acc-del="${i}" title="삭제">×</button>
      </div>`).join('');
    box.querySelectorAll('[data-acc-code]').forEach(el => {
      el.oninput = () => { accounts[+el.getAttribute('data-acc-code')].code = el.value.trim(); };
    });
    box.querySelectorAll('[data-acc-cat]').forEach(el => {
      el.onchange = () => { accounts[+el.getAttribute('data-acc-cat')].category = el.value; };
    });
    box.querySelectorAll('[data-acc-del]').forEach(el => {
      el.onclick = () => { accounts.splice(+el.getAttribute('data-acc-del'), 1); renderAccRows(p); };
    });
  };

  // 계좌 찾기 — 서버가 후보 코드를 순차 조회해 실제 존재하는 계좌만 돌려준다.
  // 보유 종목명을 함께 보여줘서 사용자가 카테고리만 고르면 되게 한다.
  const discoverAccounts = async (p) => {
    const btn = document.getElementById('bkConnDiscover');
    btn.disabled = true; btn.textContent = '🔍 찾는 중…';
    try {
      const body = { provider: document.getElementById('bkConnProvider').value, creds: collectCreds(p) };
      if (conn) body.connId = conn.id;
      const res = await fetch('/api/broker-discover', { method: 'POST', body: JSON.stringify(body) });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || `HTTP ${res.status}`);
      for (const a of data.accounts) {
        if (!accounts.some(x => x.code === a.code)) accounts.push({ code: a.code, category: '' });
      }
      renderAccRows(p);
      showMsg(data.accounts.map(a =>
        `${a.code}: ${a.holdingCount}종목${a.sampleNames.length ? ' (' + a.sampleNames.join(', ') + ')' : ''}`
      ).join(' / ') + ' — 각 계좌의 카테고리를 골라주세요', false);
    } catch (err) {
      showMsg(`계좌 찾기 실패: ${err.message}`, true);
    }
    btn.disabled = false; btn.textContent = '🔍 계좌 찾기';
  };

  // 계좌 편집 영역 — 'user' 모드(한투)만 편집 UI, fixed 모드는 안내 문구만.
  const renderAccounts = (p) => {
    const box = document.getElementById('bkConnAccounts');
    if (p.accountMode !== 'user') {
      const list = (p.accounts || []).map(a => a.category).join(' · ');
      box.innerHTML = `<div class="backup-desc" style="margin-top:4px;">조회 대상: <b>${esc(list)}</b> (자동)</div>`;
      return;
    }
    box.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin:8px 0 4px;gap:8px;flex-wrap:wrap;">
        <div style="font-size:12px;color:var(--text-muted);">조회할 계좌 — ${esc(p.accountCodeHint || '')}</div>
        <div style="display:flex;gap:6px;">
          ${p.discoverable ? '<button class="btn" id="bkConnDiscover" style="padding:4px 10px;font-size:12px;">🔍 계좌 찾기</button>' : ''}
          <button class="btn" id="bkConnAddAcc" style="padding:4px 10px;font-size:12px;">+ 계좌</button>
        </div>
      </div>
      <div id="bkConnAccRows"></div>`;
    renderAccRows(p);
    const disc = document.getElementById('bkConnDiscover');
    if (disc) disc.onclick = () => discoverAccounts(p);
    document.getElementById('bkConnAddAcc').onclick = () => { accounts.push({ code: '', category: '' }); renderAccRows(p); };
  };

  // provider 메타에 맞춰 입력칸·계좌 영역을 그린다 (증권사 전환 시 재호출).
  const renderForm = () => {
    const pid = document.getElementById('bkConnProvider').value;
    const p = _bkProviders[pid];
    if (!p) return;
    document.getElementById('bkConnCreds').innerHTML = p.credFields.map(f => `
      <label style="font-size:12px;">
        <div style="color:var(--text-muted);margin-bottom:4px;">${esc(f.label)}${conn && conn.credsMasked && conn.credsMasked[f.key] ? ` <span style="color:#16a34a;">(등록됨)</span>` : ''}</div>
        <input id="bkc_${esc(f.key)}" type="password" class="inp" autocomplete="off"
          placeholder="${conn ? '변경 시에만 입력' : esc(f.hint || '')}" style="border:1px solid var(--border);padding:6px 8px;width:100%;" />
      </label>`).join('');
    renderAccounts(p);
  };

  document.getElementById('bkConnProvider').onchange = renderForm;
  document.getElementById('bkConnCloseX').onclick = close;
  document.getElementById('bkConnCancel').onclick = close;
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });

  // 저장 — 전체 연결 배열을 보낸다. 다른 연결의 creds 는 빈 객체로 보내 기존 값이 유지되게.
  document.getElementById('bkConnSave').onclick = async () => {
    const pid = document.getElementById('bkConnProvider').value;
    const p = _bkProviders[pid];
    const entry = {
      id: conn ? conn.id : `c${Date.now().toString(36)}`,
      provider: pid,
      label: document.getElementById('bkConnLabel').value.trim() || p.label,
      creds: collectCreds(p),
      accounts: p.accountMode === 'user' ? accounts.filter(a => a.code) : [],
    };
    if (p.accountMode === 'user' && entry.accounts.some(a => !a.category)) {
      showMsg('각 계좌의 카테고리를 선택하세요', true); return;
    }
    const next = _bkConns.filter(c => c.id !== entry.id).map(c => ({
      id: c.id, provider: c.provider, label: c.label, creds: {}, accounts: c.accounts,
    }));
    next.push(entry);
    try {
      const res = await fetch('/api/broker-connections', { method: 'PUT', body: JSON.stringify({ connections: next }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
      close();
      toast('🔗 증권사 연결 저장됨');
      refreshBrokerConnections();
    } catch (err) {
      showMsg(`저장 실패: ${err.message}`, true);
    }
  };

  renderForm();
}

// 연결 1개 삭제 — 서버가 해당 연결의 토큰 캐시도 함께 지운다.
async function deleteBrokerConnection(id) {
  const conn = _bkConns.find(c => c.id === id);
  if (!confirm(`'${conn ? (conn.label || conn.provider) : id}' 연결을 삭제할까요?\n(등록된 API 키가 지워집니다)`)) return;
  try {
    const res = await fetch(`/api/broker-connections?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    toast('🔗 연결 삭제됨');
    refreshBrokerConnections();
  } catch (err) {
    toast(`⚠️ 삭제 실패: ${err.message}`);
  }
}
