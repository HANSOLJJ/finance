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

// 소스별 예수금 행의 배치 규칙 — 계좌의 카테고리 섹션 안에 넣고 자산타입만 '현금'.
// (섹션 = 계좌 단위 그룹이라는 사용자 결정. 자산타입 축 집계는 '현금'으로 정확해진다.)
// 빗썸 원화만 예외로 현금 섹션 — 암호화폐 카테고리는 assetTypeFixed 라 왜곡되기 때문.
const BROKER_CASH_PLACEMENT = {
  'kis-pension': { category: '연금저축펀드', name: '예수금 (한투)', usd: false },
  'kis-isa': { category: 'ISA', name: '예수금 (한투)', usd: false },
  'kw-kr': { category: '국내주식', name: '예수금 (키움)', usd: false },
  'kw-us': { category: '해외주식', name: '달러 예수금 (키움)', usd: true },
  bithumb: { category: '현금', name: '빗썸 원화', usd: false },
};

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

    // 예수금 — 마커 행(<id>:cash)을 계좌 섹션 안에 생성·관리 (배치 규칙 상단 참조)
    if (source.cash) {
      const place = BROKER_CASH_PLACEMENT[source.id];
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

// ==================== 설정 탭 — 🔑 API 키 카드 ====================
// 키는 서버(/api/broker-keys)를 통해 로그인 이메일 귀속 KV 에 저장된다.
// 저장 후 입력칸은 즉시 비우고, 상태 표시는 마스킹된 값(앞 4자)만 사용한다.

const BROKER_KEY_FIELDS = ['kisAppkey', 'kisAppsecret', 'kisCano', 'kwAppkey', 'kwSecretkey', 'bithumbKey', 'bithumbSecret'];

// 등록 상태 갱신 — 설정 탭 카드의 상태 줄을 서버 마스킹 응답으로 채운다.
async function refreshBrokerKeyStatus() {
  const el = document.getElementById('brokerKeyStatus');
  if (!el) return;
  try {
    const res = await fetch('/api/broker-keys', { cache: 'no-store' });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(`HTTP ${res.status}`);
    if (!data.registered) { el.textContent = '등록된 키 없음'; return; }
    const label = { kisAppkey: '한투 앱키', kisAppsecret: '한투 시크릿', kisCano: '한투 계좌', kwAppkey: '키움 앱키', kwSecretkey: '키움 시크릿', bithumbKey: '빗썸 키', bithumbSecret: '빗썸 시크릿' };
    const parts = BROKER_KEY_FIELDS.filter(f => data.fields[f]).map(f => `${label[f]} ${data.fields[f]}`);
    el.textContent = parts.length ? `등록됨 — ${parts.join(' · ')}` : '등록된 키 없음';
  } catch (_) {
    el.textContent = '상태 확인 불가 (서버 연결 필요)';
  }
}

// 저장 — 입력된 필드만 보낸다 (빈 칸은 기존 값 유지, 서버 PUT 이 부분 갱신).
async function saveBrokerKeys() {
  const body = {};
  let any = false;
  for (const f of BROKER_KEY_FIELDS) {
    const inp = document.getElementById(`bk_${f}`);
    if (inp && inp.value.trim()) { body[f] = inp.value.trim(); any = true; }
  }
  if (!any) { toast('⚠️ 입력된 키가 없습니다'); return; }
  try {
    const res = await fetch('/api/broker-keys', { method: 'PUT', body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    for (const f of BROKER_KEY_FIELDS) {
      const inp = document.getElementById(`bk_${f}`);
      if (inp) inp.value = ''; // 화면에 키 잔류 금지
    }
    toast('🔑 API 키 저장됨');
    refreshBrokerKeyStatus();
  } catch (err) {
    toast(`⚠️ 키 저장 실패: ${err.message}`);
  }
}

// 전체 삭제 — 키와 토큰 캐시가 서버에서 함께 지워진다.
async function deleteBrokerKeys() {
  if (!confirm('등록된 증권사 API 키를 전부 삭제할까요?\n(동기화 기능이 비활성화됩니다)')) return;
  try {
    const res = await fetch('/api/broker-keys', { method: 'DELETE' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    toast('🔑 API 키 삭제됨');
    refreshBrokerKeyStatus();
  } catch (err) {
    toast(`⚠️ 키 삭제 실패: ${err.message}`);
  }
}
