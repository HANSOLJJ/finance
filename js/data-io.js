// data-io.js — 데이터 입출력 계층. state 전체의 JSON 백업/복원, 일별 자산 스냅샷 기록,
// 과거 이력 소급 보정, 전체 초기화, 토스트 알림을 담당한다.
// 스냅샷은 state.history 배열에 쌓이며 각 원소는 { id, date(YYYY-MM-DD), total, totalUSD,
// fxRate, krw/usd(통화노출별 KRW), liquid/locked(유동성별)와 각 USD 환산값,
// byAssetType, byCategory, cpiIndex·cpiLabel·cpiYoYPct, m2·m2Label·m2YoYPct } 구조로,
// 이력 차트(charts.js)와 실질가치 분석의 원천 데이터가 된다.
// 복원 시 구버전 백업은 state.js의 migrateState()가 현재 스키마로 끌어올린다.
// 로드 순서 constants→state→calc→render→charts→data-io→fetch→sync→main 중 6번째.
// calc.js의 합계 함수와 state.js(saveState·defaultState·uid)에 의존하고,
// snapshot()은 fetch.js의 fetchUSCPI/fetchM2를 호출한다(실행 시점엔 이미 로드되어 있음).
// ==================== 액션 ====================
// ==================== 과거 이력 보정 (빠진 자산 소급 추가) ====================
// '빠진 자산 소급 추가' 모달을 띄운다. 원래부터 있었는데 기록에서 누락된 자산(청약 등)을
// 모든 과거 스냅샷과 현재 holdings에 같은 금액으로 한꺼번에 반영하기 위한 UI.
// 모달 DOM을 동적으로 생성해 body에 붙이고, 카테고리 변경 시 통화노출·유동성 기본값을 동기화하며,
// 금액 입력 시 첫/마지막 스냅샷의 적용 전후 미리보기를 보여준다.
// 실제 데이터 변경은 확인(confirm)을 거쳐 applyHistoricalAsset()에 위임한다. 롤백 불가 작업.
function openHistoricalAddModal() {
  const existing = document.getElementById('histAddBackdrop');
  if (existing) existing.remove();

  const snapCount = state.history.length;
  if (snapCount === 0) {
    alert('저장된 스냅샷이 없습니다. 먼저 이력 탭에서 스냅샷을 찍으세요.');
    return;
  }

  const backdrop = document.createElement('div');
  backdrop.id = 'histAddBackdrop';
  backdrop.className = 'memo-modal-backdrop';
  backdrop.innerHTML = `
    <div class="memo-modal" style="width:min(540px,94vw);">
      <div class="memo-modal-head">
        <div>
          <div class="memo-modal-title">📋 빠진 자산 소급 추가</div>
          <div class="memo-modal-sub">모든 과거 스냅샷 ${snapCount}개 + 현재 holdings에 동일 금액 적용</div>
        </div>
        <button class="memo-modal-x" id="histAddCloseBtn" title="닫기">×</button>
      </div>
      <div class="memo-modal-hint" style="border-left-color:#dc2626;background:#fef2f2;">
        ⚠️ 이 작업은 과거 스냅샷을 수정합니다. 적용 전에 설정 탭에서 "백업 다운로드"로 JSON 백업을 받아두세요. 롤백 안 됩니다.
      </div>
      <div class="hist-form-grid">
        <label style="font-size:12px;">
          <div style="color:var(--text-muted);margin-bottom:4px;">카테고리</div>
          <select id="histAddCategory" class="inp" style="width:100%;border:1px solid var(--border);padding:6px 8px;">
            ${CATEGORIES.filter(c => !c.isDebt).map(c => `<option value="${c.key}">${c.key}</option>`).join('')}
          </select>
        </label>
        <label style="font-size:12px;">
          <div style="color:var(--text-muted);margin-bottom:4px;">자산명</div>
          <input id="histAddName" class="inp" placeholder="예: 주택청약저축" style="border:1px solid var(--border);padding:6px 8px;width:100%;" />
        </label>
        <label style="font-size:12px;">
          <div style="color:var(--text-muted);margin-bottom:4px;">계좌/거래소 (선택)</div>
          <input id="histAddAccount" class="inp" placeholder="예: 우리은행" style="border:1px solid var(--border);padding:6px 8px;width:100%;" />
        </label>
        <label style="font-size:12px;">
          <div style="color:var(--text-muted);margin-bottom:4px;">금액 (KRW)</div>
          <input id="histAddAmount" class="inp right" placeholder="0" inputmode="numeric" style="border:1px solid var(--border);padding:6px 8px;width:100%;" />
        </label>
        <label style="font-size:12px;">
          <div style="color:var(--text-muted);margin-bottom:4px;">통화노출</div>
          <select id="histAddExposure" class="inp" style="width:100%;border:1px solid var(--border);padding:6px 8px;">
            ${EXPOSURES.map(e => `<option value="${e}">${e}</option>`).join('')}
          </select>
        </label>
        <label style="font-size:12px;">
          <div style="color:var(--text-muted);margin-bottom:4px;">유동성</div>
          <select id="histAddLiquidity" class="inp" style="width:100%;border:1px solid var(--border);padding:6px 8px;">
            <option value="liquid">💧 유동 (즉시 인출 가능)</option>
            <option value="locked">🔒 묶임 (제도/제약)</option>
          </select>
        </label>
      </div>
      <div class="memo-modal-hint" id="histAddPreview" style="border-left-color:#0e7490;background:#ecfeff;">
        금액을 입력하면 적용 결과 미리보기가 표시됩니다.
      </div>
      <div class="memo-modal-foot">
        <span class="memo-modal-help">카테고리 변경 시 통화노출/유동성 기본값 자동 설정</span>
        <div style="display:flex;gap:8px;">
          <button class="btn" id="histAddCancelBtn">취소</button>
          <button class="btn primary" id="histAddApplyBtn">적용 (${snapCount}개 스냅샷)</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);

  const catEl = document.getElementById('histAddCategory');
  const expEl = document.getElementById('histAddExposure');
  const liqEl = document.getElementById('histAddLiquidity');
  const amtEl = document.getElementById('histAddAmount');
  const nameEl = document.getElementById('histAddName');
  const accEl = document.getElementById('histAddAccount');
  const previewEl = document.getElementById('histAddPreview');

  // 카테고리 변경 시 노출/유동성 기본값 동기화
  const syncDefaults = () => {
    const cat = catEl.value;
    expEl.value = DEFAULT_EXPOSURE_BY_CAT[cat] || '원화';
    liqEl.value = DEFAULT_LIQUIDITY_BY_CAT[cat] || 'liquid';
  };
  catEl.addEventListener('change', syncDefaults);
  syncDefaults();
  // 사용자가 가장 많이 빠뜨릴 카테고리부터 기본 선택 (현금)
  catEl.value = '현금'; syncDefaults();

  // 금액 입력 시 첫/마지막 스냅샷 기준의 적용 전후 미리보기 갱신.
  const updatePreview = () => {
    const amt = num(amtEl.value);
    if (!amt || amt <= 0) {
      previewEl.textContent = '금액을 입력하면 적용 결과 미리보기가 표시됩니다.';
      return;
    }
    const sortedSnaps = [...state.history].sort((a, b) => a.date.localeCompare(b.date));
    const first = sortedSnaps[0];
    const last = sortedSnaps[sortedSnaps.length - 1];
    previewEl.innerHTML = `각 스냅샷에 <b>${fmtKRWshort(amt)}</b>씩 더합니다.<br/>
      • 첫 스냅샷(${first.date}): ${fmtKRWshort(first.total || 0)} → <b>${fmtKRWshort((first.total || 0) + amt)}</b><br/>
      • 마지막 스냅샷(${last.date}): ${fmtKRWshort(last.total || 0)} → <b>${fmtKRWshort((last.total || 0) + amt)}</b><br/>
      • 현재 자산 입력에도 같은 자산이 새로 추가됩니다.`;
  };
  amtEl.addEventListener('input', updatePreview);

  const close = () => backdrop.remove();
  // 입력 검증 → 최종 확인(confirm) → 소급 적용 실행
  const apply = () => {
    const data = {
      category: catEl.value,
      name: (nameEl.value || '').trim(),
      account: (accEl.value || '').trim(),
      amount: num(amtEl.value),
      exposure: expEl.value,
      liquidity: liqEl.value,
    };
    if (!data.name) { alert('자산명을 입력하세요.'); nameEl.focus(); return; }
    if (!data.amount || data.amount <= 0) { alert('금액을 입력하세요.'); amtEl.focus(); return; }
    const ok = confirm(`적용하시겠습니까?\n\n자산: ${data.name}\n금액: ${fmtKRW(data.amount)}\n대상 스냅샷: ${snapCount}개 (모두 동일 금액 가산)\n\n현재 holdings에도 같은 자산이 추가됩니다.\n적용 후 롤백 불가 — 백업 받아두셨나요?`);
    if (!ok) return;
    applyHistoricalAsset(data);
    close();
    toast(`📋 ${data.name} 소급 적용 완료 — ${snapCount}개 스냅샷 + 현재 holdings`);
  };

  document.getElementById('histAddCloseBtn').onclick = close;
  document.getElementById('histAddCancelBtn').onclick = close;
  document.getElementById('histAddApplyBtn').onclick = apply;
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  setTimeout(() => nameEl.focus(), 30);
}

// 소급 추가의 실제 데이터 변경부. 현재 holdings에 새 자산 1건을 추가하고
// state.history의 모든 스냅샷에 동일 금액을 가산한 뒤 저장·재렌더한다.
// 스냅샷은 total뿐 아니라 파생 필드(totalUSD·krw/usd·byCategory·byAssetType·
// liquid/locked와 각 USD 환산값)까지 함께 보정해 이력 차트의 정합성을 유지한다.
function applyHistoricalAsset(data) {
  const cat = CATEGORY_MAP[data.category];
  const assetType = (cat && cat.assetTypeFixed) || '주식';

  // 1. 현재 holdings에 추가 (amount-only로 처리: price=금액, quantity=1)
  // 카테고리가 amountOnly가 아니어도 단순화 위해 quantity=1, price=금액으로 저장
  // (퇴직연금/연금저축은 hasTicker인데 사용자 편의상 amount 입력으로 처리)
  const isAmountOnly = !!(cat && cat.amountOnly);
  state.holdings.push({
    id: uid(),
    category: data.category,
    name: data.name,
    account: data.account || '',
    ticker: '',
    symbol: '',
    quantity: '1',
    price: String(data.amount),
    priceUSD: '',
    avgPrice: '',
    avgPriceUSD: '',
    exposure: data.exposure,
    memo: '소급 추가',
    assetType,
    liquidity: data.liquidity,
    lastFetched: '',
  });

  // 2. 모든 스냅샷에 동일 금액 가산
  state.history.forEach(snap => {
    const amt = data.amount;
    snap.total = (snap.total || 0) + amt;
    if (snap.fxRate) snap.totalUSD = snap.total / snap.fxRate;
    if (data.exposure === '원화') {
      snap.krw = (snap.krw || 0) + amt;
    } else {
      snap.usd = (snap.usd || 0) + amt;
      snap.usdTotal = snap.usd;
    }
    if (snap.byCategory) {
      snap.byCategory[data.category] = (snap.byCategory[data.category] || 0) + amt;
    }
    if (snap.byAssetType) {
      snap.byAssetType[assetType] = (snap.byAssetType[assetType] || 0) + amt;
    }
    if (data.liquidity === 'liquid') {
      snap.liquid = (snap.liquid || 0) + amt;
      if (snap.fxRate) snap.liquidUSD = snap.liquid / snap.fxRate;
    } else {
      snap.locked = (snap.locked || 0) + amt;
      if (snap.fxRate) snap.lockedUSD = snap.locked / snap.fxRate;
    }
  });

  saveState();
  render();
}

// 서버(KV)에 실제로 저장돼 있는 진본 JSON을 portfolio_날짜.json 파일로 다운로드한다(백업).
// 자동 저장 체제에선 서버가 유일한 진실이므로 백업도 서버 응답을 그대로 받는 것이 정확하다.
// 서버 실패 시에는 현재 화면의 state 직렬화로 폴백해, 동기화 장애 중에도 백업은 가능하다.
// 성공 시 state.lastBackupAt을 기록·저장해 설정 탭의 마지막 백업 표시(14일 경고)를 갱신한다.
async function exportJSON() {
  try {
    // 서버 진본 우선 조회 — 실패(오프라인·미배포 환경 등)는 조용히 폴백으로 넘어간다.
    let json = null;
    try {
      const res = await fetch('/api/portfolio', { cache: 'no-store' });
      if (res.ok) json = await res.text();
    } catch (_) {}
    const fromServer = json !== null;
    if (!fromServer) json = JSON.stringify(state, null, 2);
    const filename = `portfolio_${localDateStr()}.json`;

    // Blob URL + 임시 <a> 클릭 방식 — 브라우저 다운로드 폴더에 바로 저장된다.
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      try { document.body.removeChild(a); } catch (_) {}
      URL.revokeObjectURL(url);
    }, 1000);

    // 백업 시점 기록
    state.lastBackupAt = new Date().toISOString();
    saveState();
    renderSettings();

    toast(`💾 ${filename} 다운로드 시작${fromServer ? ' (서버 진본)' : ' (서버 응답 없음 — 현재 화면 기준)'}`);
  } catch (err) {
    console.error('[Export] 에러:', err);
    alert('내보내기 실패: ' + err.message);
  }
}

// 파일 선택 input의 change 이벤트에서 백업 JSON 파일을 FileReader로 읽어 복원을 시작한다.
// 실제 검증·적용은 applyImportedJSON()에 위임한다. 마지막의 input value 초기화는
// 같은 파일을 연달아 다시 선택해도 change 이벤트가 재발생하게 하기 위한 처리.
function importJSON(e) {
  console.log('[Import] 호출됨, event:', e);
  const file = e && e.target && e.target.files && e.target.files[0];
  if (!file) {
    console.warn('[Import] 파일 없음');
    return;
  }
  console.log('[Import] 파일:', file.name, file.size, 'bytes');
  const reader = new FileReader();
  reader.onload = (ev) => applyImportedJSON(ev.target.result, file.name);
  reader.onerror = (err) => {
    console.error('[Import] FileReader 에러:', err);
    alert('파일 읽기 실패');
  };
  reader.readAsText(file, 'UTF-8');
  if (e.target) e.target.value = '';
}

// 백업 JSON 텍스트를 검증한 뒤 state를 통째로 교체한다. holdings 배열과
// 목표 비중(assetTypeTargets 또는 레거시 catTargets) 존재가 최소 형식 요건.
// 자동 저장 체제에선 복원이 곧 서버 덮어쓰기이므로 교체 전에 confirm 을 받고,
// 확정 시 defaultState()에 백업을 덮어씌워 migrateState()로 보정한 뒤
// 디바운스 없이 즉시 서버에 반영한다(사고 복구는 명시적 행동이라 바로 저장).
// 실패 시 state를 건드리지 않고 alert만 띄운다. 잘못 복원해도 서버의 날짜별 버전(90일)으로 재복구 가능.
function applyImportedJSON(text, fileName) {
  try {
    if (!text) throw new Error('파일이 비어있습니다');
    const data = JSON.parse(text);
    if (!data.holdings || !Array.isArray(data.holdings)) throw new Error('잘못된 형식: holdings 배열 없음');
    // assetTypeTargets 또는 (레거시) catTargets 중 하나는 있어야 함
    if (!data.assetTypeTargets && !data.catTargets) throw new Error('잘못된 형식: 목표 비중 없음');
    if (!confirm(`"${fileName}" 백업으로 교체할까요?\n이 화면과 서버 데이터가 모두 이 내용으로 바뀝니다.`)) return;
    state = migrateState({ ...defaultState(), ...data });
    saveState();
    flushServerSave();
    render();
    updateFxBadge();
    toast(`📂 ${fileName} 불러오기 완료 (${data.holdings.length}개 종목)`);
  } catch (err) {
    console.error('Import 실패:', err);
    alert('파일을 읽을 수 없습니다: ' + err.message);
  }
}

// ==================== 입출금 기록 (현금흐름 원장) ====================
// 이력 탭의 💰 버튼이 여는 모달. 날짜·금액(출금은 음수)·메모를 기록하고 목록에서 삭제한다.
// 기록은 state.cashflows 에 쌓여 TWR(실투자 수익률) 계산의 원천이 된다 (calc.js computeTWRSeries).
// 추가/삭제 즉시 saveState()로 자동 저장이 예약되고, 모달을 닫을 때 render()로 이력 탭이 갱신된다.
function openCashflowModal() {
  const existing = document.getElementById('cashflowBackdrop');
  if (existing) existing.remove();

  const backdrop = document.createElement('div');
  backdrop.id = 'cashflowBackdrop';
  backdrop.className = 'memo-modal-backdrop';

  // 목록 HTML 생성 — 최신 날짜가 위로 오게 정렬해 최근 기록부터 보인다.
  const listHtml = () => {
    const flows = [...(state.cashflows || [])].sort((a, b) => b.date.localeCompare(a.date));
    if (flows.length === 0) {
      return '<div style="color:var(--text-muted);font-size:12px;padding:8px 0;">아직 기록이 없습니다 — 월급 이체·큰 입출금이 있을 때 적어두면 실투자 수익률(TWR)이 정확해집니다.</div>';
    }
    return `<table style="width:100%;font-size:12px;">
      <thead><tr style="background:#f8fafc;"><th style="text-align:left;padding:4px 8px;">날짜</th><th class="right" style="padding:4px 8px;">금액</th><th style="text-align:left;padding:4px 8px;">메모</th><th></th></tr></thead>
      <tbody>${flows.map(f => `<tr>
        <td style="padding:3px 8px;white-space:nowrap;">${f.date}</td>
        <td class="right" style="padding:3px 8px;color:${num(f.amount) >= 0 ? '#16a34a' : '#dc2626'};font-variant-numeric:tabular-nums;">${num(f.amount) >= 0 ? '+' : ''}${fmtKRW(num(f.amount))}</td>
        <td style="padding:3px 8px;">${escapeHtml(f.memo || '')}</td>
        <td style="padding:3px 4px;"><button class="icon-btn" data-del-flow="${f.id}" title="삭제">×</button></td>
      </tr>`).join('')}</tbody>
    </table>`;
  };

  backdrop.innerHTML = `
    <div class="memo-modal" style="width:min(560px,94vw);">
      <div class="memo-modal-head">
        <div>
          <div class="memo-modal-title">💰 입출금 기록</div>
          <div class="memo-modal-sub">외부에서 넣거나 뺀 돈만 기록 (자산 간 이동은 기록 안 함)</div>
        </div>
        <button class="memo-modal-x" id="cfCloseBtn" title="닫기">×</button>
      </div>
      <div class="memo-modal-hint">
        입금(월급·이체)은 양수, 출금(생활비 인출 등)은 음수로. 이 기록으로 "투자를 잘해서 늘었는지, 돈을 넣어서 늘었는지"를 분리해 TWR을 계산합니다.
      </div>
      <div class="cf-form-grid">
        <label style="font-size:12px;">
          <div style="color:var(--text-muted);margin-bottom:4px;">날짜</div>
          <input id="cfDate" type="date" class="inp" style="border:1px solid var(--border);padding:6px 8px;width:100%;" />
        </label>
        <label style="font-size:12px;">
          <div style="color:var(--text-muted);margin-bottom:4px;">금액 (KRW, 출금은 −)</div>
          <input id="cfAmount" class="inp right" placeholder="예: 3000000 / -500000" inputmode="numeric" style="border:1px solid var(--border);padding:6px 8px;width:100%;" />
        </label>
        <label style="font-size:12px;">
          <div style="color:var(--text-muted);margin-bottom:4px;">메모 (선택)</div>
          <input id="cfMemo" class="inp" placeholder="예: 8월 월급" style="border:1px solid var(--border);padding:6px 8px;width:100%;" />
        </label>
        <button class="btn primary" id="cfAddBtn" style="height:32px;">추가</button>
      </div>
      <div id="cfList" style="margin-top:12px;max-height:280px;overflow-y:auto;">${listHtml()}</div>
      <div class="memo-modal-foot">
        <span class="memo-modal-help">기록은 자동 저장됨 · 첫 스냅샷 이전 날짜는 TWR 계산에서 제외</span>
        <button class="btn" id="cfDoneBtn">닫기</button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);

  const dateEl = document.getElementById('cfDate');
  const amtEl = document.getElementById('cfAmount');
  const memoEl = document.getElementById('cfMemo');
  dateEl.value = localDateStr();

  // 삭제 버튼 바인딩 — 목록을 다시 그릴 때마다 재바인딩해야 한다.
  const bindDeletes = () => {
    backdrop.querySelectorAll('[data-del-flow]').forEach(btn => {
      btn.onclick = () => {
        const id = btn.getAttribute('data-del-flow');
        state.cashflows = state.cashflows.filter(f => f.id !== id);
        saveState();
        refreshList();
      };
    });
  };
  const refreshList = () => {
    document.getElementById('cfList').innerHTML = listHtml();
    bindDeletes();
  };
  bindDeletes();

  // 추가 — 날짜·금액 검증 후 원장에 기록. 금액 0은 의미가 없으므로 거부한다.
  const add = () => {
    const date = dateEl.value;
    const amount = num(amtEl.value);
    if (!date) { alert('날짜를 선택하세요.'); dateEl.focus(); return; }
    if (!amount) { alert('금액을 입력하세요 (출금은 음수).'); amtEl.focus(); return; }
    state.cashflows.push({ id: uid(), date, amount, memo: (memoEl.value || '').trim() });
    saveState();
    amtEl.value = ''; memoEl.value = '';
    refreshList();
    amtEl.focus();
  };
  document.getElementById('cfAddBtn').onclick = add;
  amtEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
  memoEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });

  // 닫기 — 이력 테이블·차트에 TWR 반영을 위해 닫을 때 한 번만 전체 재렌더한다.
  const close = () => { backdrop.remove(); render(); };
  document.getElementById('cfCloseBtn').onclick = close;
  document.getElementById('cfDoneBtn').onclick = close;
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
}

// 현재 자산 총계를 오늘 날짜의 스냅샷으로 state.history에 저장한다(같은 날짜는 덮어씀).
// auto=true 는 시세 갱신(refreshAllPrices) 완료 시의 자동 호출 — 토스트 문구만 다르고
// 동작은 수동 버튼과 동일하다. 기록 후 saveState()로 자동 저장까지 예약된다.
// 총액과 함께 통화노출(krw/usd)·유동성(liquid/locked)·자산타입별·카테고리별 내역과
// 당시 환율을 같이 기록해, 이후 구성이 바뀌어도 과거 시점 분석이 가능하게 한다.
// 미국 CPI·M2는 fetch.js(fetchUSCPI/fetchM2)로 자동 수집하되, 실패하면
// state.lastCPI/lastM2 캐시값으로 대체하고 스냅샷 자체는 계속 진행한다(네트워크 불통 대비).
// YoY는 API 응답에서 함께 계산해 저장하므로 사용자의 이력이 짧아도 표시할 수 있다.
async function snapshot(auto = false) {
  const date = localDateStr();
  const total = grandTotal();
  const krw = exposureTotal('원화');
  const usd = exposureTotal('달러(노출)');
  const fxRate = num(state.usdKrwRate) || 1380;
  const totalUSD = total / fxRate;

  // 미국 CPI + M2 자동 fetch (실패 시 마지막 캐시값 사용)
  // YoY (전년 동월 대비)도 같은 API 응답에서 함께 추출 → 사용자 이력 짧아도 작동
  let cpiIndex = null, cpiLabel = null, cpiYoYPct = null;
  let m2Value = null, m2Label = null, m2YoYPct = null;
  try {
    const cpi = await fetchUSCPI();
    cpiIndex = cpi.index;
    cpiLabel = cpi.label;
    cpiYoYPct = cpi.yoyPct;
    state.lastCPI = { index: cpiIndex, label: cpiLabel, yoyPct: cpiYoYPct, fetchedAt: new Date().toISOString() };
  } catch (e) {
    console.warn('CPI fetch 실패, 마지막 캐시 사용:', e.message);
    if (state.lastCPI) {
      cpiIndex = state.lastCPI.index;
      cpiLabel = state.lastCPI.label;
      cpiYoYPct = state.lastCPI.yoyPct ?? null;
    }
  }
  try {
    const m2 = await fetchM2();
    m2Value = m2.value;
    m2Label = m2.label;
    m2YoYPct = m2.yoyPct;
    state.lastM2 = { value: m2Value, label: m2Label, yoyPct: m2YoYPct, fetchedAt: new Date().toISOString() };
  } catch (e) {
    console.warn('M2 fetch 실패, 마지막 캐시 사용:', e.message);
    if (state.lastM2) {
      m2Value = state.lastM2.value;
      m2Label = state.lastM2.label;
      m2YoYPct = state.lastM2.yoyPct ?? null;
    }
  }

  // 같은 날짜가 있으면 덮어쓰기
  state.history = state.history.filter(h => h.date !== date);
  const liquidKRW = liquidityTotal('liquid');
  const lockedKRW = liquidityTotal('locked');
  state.history.push({
    id: uid(), date, total, totalUSD, fxRate,
    debt: debtTotal(), // 부채 총액 — total 은 자산 기준이므로 순자산은 total - debt
    cpiIndex, cpiLabel, cpiYoYPct,
    m2: m2Value, m2Label, m2YoYPct,
    krw, usd, usdTotal: usd,
    liquid: liquidKRW, locked: lockedKRW,
    liquidUSD: fxRate ? liquidKRW / fxRate : null,
    lockedUSD: fxRate ? lockedKRW / fxRate : null,
    byAssetType: Object.fromEntries(ASSET_TYPES.map(t => [t, assetTypeTotal(t)])),
    byCategory: Object.fromEntries(CATEGORIES.map(c => [c.key, categoryTotal(c.key)]))
  });
  saveState(); // 이력 변경 영속화 — 자동 저장 예약 (기존엔 누락돼 있던 저장 지점)
  render();
  const cpiNote = cpiIndex ? ` · CPI ${cpiIndex.toFixed(2)}` : '';
  const m2Note = m2Value ? ` · M2 ${(m2Value/1000).toFixed(1)}T` : '';
  toast(`📸 ${auto ? '오늘 스냅샷 자동 기록 · ' : ''}${date} ${fmtUSD(totalUSD)}${cpiNote}${m2Note}`);
  // 벤치마크 지수(S&P500/나스닥)를 방금 스냅샷과 과거 누락분에 채워 넣는다 (fetch.js).
  // CPI/M2 처럼 스냅샷에 저장되며, 시세 갱신 없이 수동 스냅샷만 찍어도 여기서 함께 기록된다.
  await applyBenchmarksToHistory();
  render();
}

// 확인(confirm) 후 모든 데이터(자산·이력·설정)를 defaultState()로 초기화하고 저장·재렌더한다.
// 자동 저장 체제라 초기화도 서버 저장본을 빈 상태로 덮어쓴다 — confirm 문구에 명시.
// 백업(JSON 파일·서버 날짜별 버전 90일) 없이는 되돌릴 수 없다.
function resetAll() {
  if (!confirm('정말 모든 데이터를 초기화하시겠습니까?\n저장된 이력과 입력값이 모두 사라지고, 서버 저장본도 빈 상태로 덮어써집니다.')) return;
  state = defaultState();
  saveState();
  render();
  toast('🔄 초기화 완료');
}

// 화면 하단 토스트(#toast)에 메시지를 2.2초간 표시한다.
// 파일 전반의 작업 완료·실패 알림이 공유하는 공통 출구로, fetch.js에서도 사용한다.
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2200);
}

