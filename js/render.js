// 화면 렌더링 — 탭·포맷터·대시보드/분석/이력/설정 탭 그리기.
//
// 이 파일은 자산 포트폴리오 앱의 UI 렌더링 전담 계층이다. state 전역 객체(state.js)를
// 읽어 DOM(innerHTML)을 다시 그리고, 계산은 전부 calc.js의 함수(num/holdingValue/
// categoryTotal/grandTotal/holdingPnL/computeTaxByCategory 등)에 위임한다.
// 주요 함수 그룹 — (1) 탭 전환(switchTab/initTabs), (2) 금액·% 포맷터(fmtKRW 계열),
// (3) 전체 재렌더 총괄 render()와 대시보드(KPI/리밸런싱 카드), (4) 자산 입력 테이블
// (renderHoldings + 입력 핸들러/partialUpdate), (5) 목표 비중 테이블, (6) 분석 탭 세후
// 평가(renderTaxAnalysis), (7) 이력 탭(renderHistory), (8) 설정 탭(renderSettings).
// 로드 순서는 index.html 기준 constants→state→calc→render→charts→data-io→fetch→sync→main.
// 앞의 constants(CATEGORIES/EXPOSURES 등)·state·calc를 사용하고, 여기서 정의한 render()/
// 포맷터를 뒤의 charts/data-io/fetch/sync/main이 호출한다(캔버스 차트 렌더 자체는 charts.js 담당).
// ==================== 탭 네비게이션 ====================
// 탭 전환 — 버튼/패널의 active 클래스 토글로 표시 패널을 바꾸고 URL 해시를 동기화.
// state.activeTab에 저장(saveState 호출)해 새로고침 후에도 같은 탭으로 복귀하게 한다.
// initTabs의 클릭 리스너 외에 main.js가 window.switchTab으로 노출해 인라인 onclick에서도 호출됨.
// Chart.js는 hidden 요소에 그리지 못하므로 탭 표시 후 renderCharts()(charts.js)를 지연 재호출.
function switchTab(tabName) {
  if (!tabName) return;
  document.querySelectorAll('.tab-btn').forEach(b => {
    b.classList.toggle('active', b.getAttribute('data-tab') === tabName);
  });
  document.querySelectorAll('.tab-panel').forEach(p => {
    p.classList.toggle('active', p.getAttribute('data-panel') === tabName);
  });
  state.activeTab = tabName;
  // URL 해시 동기화 (히스토리는 쌓지 않음)
  if (location.hash !== '#' + tabName) {
    history.replaceState(null, '', '#' + tabName);
  }
  saveState();
  // 탭 전환 시 차트가 0px로 보이는 경우 방지: Chart.js는 hidden 요소에 그리지 못함
  // 따라서 탭 전환 후 차트만 다시 그려서 정확한 크기로 그려지도록
  setTimeout(() => { try { renderCharts(); } catch (_) {} }, 50);
}

// 탭 클릭/해시 변경 리스너 등록 및 초기 탭 결정 (URL 해시 > 저장된 state > dashboard 순).
// main.js의 boot()에서 앱 시작 시 딱 한 번 호출된다. 초기 탭 결정도 switchTab을 거치므로
// 첫 화면부터 해시·state 동기화와 차트 재렌더가 동일한 경로로 처리된다.
// 뒤로가기 등 브라우저 해시 변경(hashchange)도 유효한 탭 이름일 때만 반영한다.
function initTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.getAttribute('data-tab')));
  });
  // 초기 탭: URL 해시 > state.activeTab > 'dashboard'
  const validTabs = ['dashboard', 'holdings', 'analysis', 'history', 'settings'];
  const fromHash = (location.hash || '').slice(1);
  const initial = validTabs.includes(fromHash) ? fromHash
    : (validTabs.includes(state.activeTab) ? state.activeTab : 'dashboard');
  switchTab(initial);
  window.addEventListener('hashchange', () => {
    const t = (location.hash || '').slice(1);
    if (validTabs.includes(t)) switchTab(t);
  });
}

// ==================== 포맷팅 ====================
// 아래 포맷터 4종은 render.js뿐 아니라 charts.js(툴팁·축 라벨)에서도 두루 쓰인다.
// USD 포맷(fmtUSD)과 인풋용 콤마 포맷(fmtNumInput)은 calc.js에 있음에 유의.
// 원화 전체 자릿수 포맷 (₩1,234,567). 입력은 KRW 금액, 반올림 후 콤마 구분.
// NaN/Infinity 등 비정상 값은 ₩0으로 안전 처리해 화면 깨짐을 막는다.
function fmtKRW(n) {
  if (!isFinite(n) || n === 0) return '₩0';
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(Math.round(n));
  return sign + '₩' + abs.toLocaleString('ko-KR');
}

// 원화 축약 포맷 — KRW 금액을 억/만 단위로 줄여 카드·칩 등 좁은 공간용.
// 1억 이상은 소수 1자리 '억', 1만 이상은 정수 '만', 그 미만은 원 단위 그대로.
// 리밸런싱 카드의 매수/매도 금액, P&L 셀 등 공간이 좁은 곳에서 fmtKRW 대신 사용.
function fmtKRWshort(n) {
  if (!isFinite(n)) return '0';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1e8) return sign + (abs / 1e8).toFixed(1) + '억';
  if (abs >= 1e4) return sign + Math.round(abs / 1e4).toLocaleString('ko-KR') + '만';
  return sign + Math.round(abs).toLocaleString('ko-KR');
}

// 비율(0~1)을 소수 1자리 % 문자열로 변환. 예: 0.153 → '15.3%'.
// KPI 비중 표시 등 부호가 필요 없는 곳용. 증감 표시는 fmtSignedPct를 쓴다.
function fmtPct(p) {
  if (!isFinite(p)) return '0.0%';
  return (p * 100).toFixed(1) + '%';
}

// 부호(+/-) 붙은 % 포맷 — 수익률·증감률 표시용. 입력은 비율(0~1), 소수 1자리.
// null/NaN 등 계산 불가 값은 '—'(em dash)로 표시해 0%와 구분한다. 이력 탭에서 다용.
function fmtSignedPct(p) {
  if (!isFinite(p)) return '—';
  const v = (p * 100).toFixed(1);
  return (p >= 0 ? '+' : '') + v + '%';
}

// ==================== 렌더링 ====================
// 전체 화면 재렌더 총괄 — 상태 저장 후 KPI/입력테이블/목표/리밸런싱/세후/이력/설정/차트를 순서대로 갱신.
// 부수효과 — saveState()로 localStorage 저장이 항상 동반되므로 "state 변경 후 render()" 한 줄이면
// 저장과 화면 반영이 동시에 끝난다. 마지막의 renderCharts()는 charts.js 소관.
// 호출처 — main.js boot(), 필드 변경(onFieldChange), 행 추가/삭제, 시세 갱신(fetch.js),
// JSON 가져오기/더미 생성(data-io.js) 등 데이터가 바뀌는 거의 모든 지점.
// 입력 도중에는 포커스 유실을 피하려고 이 함수 대신 partialUpdate()를 쓴다.
function render() {
  // 진행 중인 debounce 큐가 있으면 취소 (어차피 전체 갱신할 거니까)
  _debouncedChartRefresh.cancel();
  saveState();
  syncScopeToggleUI();
  renderKPIs();
  renderHoldings();
  renderAssetTypeTargets();
  renderExpTargets();
  renderRebalancing();
  renderRebalancingExposure();
  renderTaxAnalysis();
  renderHistory();
  renderSettings();
  renderCharts();
}

// ==================== 리밸런싱 카드 (대시보드) ====================
// 자산타입 5개(현금/주식/금/원자재/암호화폐) 단위로 현재-목표 차이를 금액으로 표시.
// ±2%p 이상 차이는 카드 색상으로 강조. 채권/부동산은 리밸런싱 대상에서 제외한 목록이다.
const REBAL_CORE_TYPES = ['현금', '주식', '금', '원자재', '암호화폐'];
const REBAL_THRESHOLD = 0.02;  // 2%p

// 자산타입 리밸런싱 카드 렌더 — 현재/목표 비중 차이를 금액(KRW)·%p로 표시, 뷰 스코프(유동/전체) 반영.
// 현재값은 calc.js의 assetTypeTotal(유동 모드면 scopedAssetTypeTotal), 목표는 state.assetTypeTargets에서 읽음.
// diff 양수는 매수 필요, 음수는 매도 필요. ±0.5%p 미만은 '적정', ±2%p(REBAL_THRESHOLD) 이상은 경고 색상.
// #rebal-grid에 카드들, #rebal-summary에 요약 칩(총액·경고 개수·조정 필요 총액)을 innerHTML로 채운다.
function renderRebalancing() {
  const grid = document.getElementById('rebal-grid');
  const summary = document.getElementById('rebal-summary');
  if (!grid || !summary) return;
  const scoped = isLiquidScope();
  const total = scoped ? scopedTotal() : grandTotal();
  if (total <= 0) {
    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;color:var(--text-muted);padding:24px;">${scoped ? '💧 유동 자산이 없습니다. "전체 자산" 모드로 전환하거나 자산 입력에서 💧 토글을 확인하세요.' : '자산을 입력하면 리밸런싱 제안이 표시됩니다'}</div>`;
    summary.innerHTML = '';
    return;
  }
  let alertCount = 0;
  let totalGap = 0;
  const cards = REBAL_CORE_TYPES.map(t => {
    const cur = scoped ? scopedAssetTypeTotal(t) : assetTypeTotal(t);
    const curPct = cur / total;
    const tgt = state.assetTypeTargets[t] || 0;
    const tgtAmt = total * tgt;
    const diff = tgtAmt - cur;  // 양수: 매수 필요, 음수: 매도 필요
    const diffPct = curPct - tgt;  // 양수: 초과, 음수: 부족
    const isAlert = Math.abs(diffPct) >= REBAL_THRESHOLD;
    if (isAlert) alertCount++;
    totalGap += Math.abs(diff);

    let cls, action;
    if (Math.abs(diffPct) < 0.005) {
      cls = 'ok';
      action = `✓ 적정 (목표 도달)`;
    } else if (diff > 0) {
      cls = isAlert ? 'alert-buy' : '';
      action = `🟢 ${fmtKRWshort(diff)} 매수`;
    } else {
      cls = isAlert ? 'alert-sell' : '';
      action = `🔴 ${fmtKRWshort(-diff)} 매도`;
    }
    const atCls = ASSET_TYPE_CLS[t] || 'asset-stock';
    return `
      <div class="rebal-card ${cls}">
        <div class="rebal-head">
          <span class="name">${t}</span>
          <span class="asset-chip ${atCls}" style="cursor:default">${(tgt*100).toFixed(1)}% 목표</span>
        </div>
        <div class="rebal-pct-row">
          <span class="cur">${(curPct*100).toFixed(1)}%</span>
          <span>현재 (${fmtKRWshort(cur)})</span>
        </div>
        <div class="rebal-pct-row" style="font-size:11px">
          <span>목표 ${fmtKRWshort(tgtAmt)} · 차이 ${(diffPct >= 0 ? '+' : '')}${(diffPct*100).toFixed(1)}%p</span>
        </div>
        <div class="rebal-action">${action}</div>
      </div>
    `;
  }).join('');
  grid.innerHTML = cards;
  const scopeLabel = scoped ? '💧 유동 자산' : '총 자산';
  summary.innerHTML = `
    <span class="chip" style="${scoped ? 'background:#ecfeff;color:#0e7490;border-color:#67e8f9;' : ''}">${scopeLabel} ${fmtKRWshort(total)}</span>
    <span class="chip">${alertCount > 0 ? `⚠️ ${alertCount}개 자산타입이 ±${(REBAL_THRESHOLD*100).toFixed(0)}%p 초과` : '✓ 모든 자산타입이 ±2%p 이내'}</span>
    <span class="chip">총 조정 필요 금액 (절대값 합) ${fmtKRWshort(totalGap)}</span>
  `;
}

// 통화노출 리밸런싱 카드 — 원화/달러(노출)/달러헤지(EXPOSURES, constants.js) 대상, 목표는 state.expTargets.
// renderRebalancing과 같은 계산·표시 구조를 통화노출 축으로 반복한 것. 현재값은 exposureTotal/
// scopedExposureTotal(calc.js)에서 오고, #rebal-exp-grid와 #rebal-exp-summary를 innerHTML로 채운다.
// 자산과 달리 직접 매매 단위가 아니므로 조치 문구는 '매수/매도' 대신 '확대/축소 필요'로 표기.
function renderRebalancingExposure() {
  const grid = document.getElementById('rebal-exp-grid');
  const summary = document.getElementById('rebal-exp-summary');
  if (!grid || !summary) return;
  const scoped = isLiquidScope();
  const total = scoped ? scopedTotal() : grandTotal();
  if (total <= 0) {
    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;color:var(--text-muted);padding:24px;">자산을 입력하면 통화노출 리밸런싱이 표시됩니다</div>`;
    summary.innerHTML = '';
    return;
  }
  // 통화노출별 스타일 매핑
  const EXP_STYLE = {
    '원화':      { emoji: '🇰🇷', bg: '#dcfce7', color: '#166534', border: '#16a34a' },
    '달러(노출)':{ emoji: '🇺🇸', bg: '#dbeafe', color: '#1e40af', border: '#2563eb' },
    '달러헤지':  { emoji: '🥇', bg: '#fef9c3', color: '#854d0e', border: '#eab308' },
  };
  let alertCount = 0;
  let totalGap = 0;
  const cards = EXPOSURES.map(e => {
    const cur = scoped ? scopedExposureTotal(e) : exposureTotal(e);
    const curPct = cur / total;
    const tgt = state.expTargets[e] || 0;
    const tgtAmt = total * tgt;
    const diff = tgtAmt - cur;
    const diffPct = curPct - tgt;
    const isAlert = Math.abs(diffPct) >= REBAL_THRESHOLD;
    if (isAlert) alertCount++;
    totalGap += Math.abs(diff);

    let cls, action;
    if (Math.abs(diffPct) < 0.005) {
      cls = 'ok';
      action = `✓ 적정 (목표 도달)`;
    } else if (diff > 0) {
      cls = isAlert ? 'alert-buy' : '';
      action = `🟢 ${fmtKRWshort(diff)} 확대 필요`;
    } else {
      cls = isAlert ? 'alert-sell' : '';
      action = `🔴 ${fmtKRWshort(-diff)} 축소 필요`;
    }
    const s = EXP_STYLE[e] || {};
    return `
      <div class="rebal-card ${cls}">
        <div class="rebal-head">
          <span class="name">${s.emoji || ''} ${e}</span>
          <span class="asset-chip" style="cursor:default;background:${s.bg};color:${s.color};border-color:${s.border};">${(tgt*100).toFixed(1)}% 목표</span>
        </div>
        <div class="rebal-pct-row">
          <span class="cur">${(curPct*100).toFixed(1)}%</span>
          <span>현재 (${fmtKRWshort(cur)})</span>
        </div>
        <div class="rebal-pct-row" style="font-size:11px">
          <span>목표 ${fmtKRWshort(tgtAmt)} · 차이 ${(diffPct >= 0 ? '+' : '')}${(diffPct*100).toFixed(1)}%p</span>
        </div>
        <div class="rebal-action">${action}</div>
      </div>
    `;
  }).join('');
  grid.innerHTML = cards;
  const scopeLabel = scoped ? '💧 유동 자산' : '총 자산';
  summary.innerHTML = `
    <span class="chip" style="${scoped ? 'background:#ecfeff;color:#0e7490;border-color:#67e8f9;' : ''}">${scopeLabel} ${fmtKRWshort(total)}</span>
    <span class="chip">${alertCount > 0 ? `⚠️ ${alertCount}개 통화노출이 ±${(REBAL_THRESHOLD*100).toFixed(0)}%p 초과` : '✓ 모든 통화노출이 ±2%p 이내'}</span>
    <span class="chip">총 조정 필요 금액 (절대값 합) ${fmtKRWshort(totalGap)}</span>
  `;
}

// ==================== 자산타입별 인플레 헤지 성과 (분석 탭) - 제거됨 ====================
// 매수 시점이 종목마다 다르고 입출금 추적 없으면 정확한 측정 불가능 → 기능 제거.
// 인플레 비교는 대시보드 KPI 카드(renderInflationKPI) + 자산 이력 차트(실질 자산 라인)로 대체.
// 아래 함수는 어디서도 호출되지 않는 보존용 죽은 코드다. 대상 테이블(#hedgeTable)도 HTML에서
// 제거되어 실행돼도 첫 가드에서 조기 반환된다. 로직 참고용으로만 남겨둔 것.
function _removed_renderHedgePerformance() {
  const tbody = document.querySelector('#hedgeTable tbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  // CPI 누적: 첫 스냅샷 ~ 현재 (대략의 보유 기간 proxy)
  // 평단가 기준 매수 시점이 종목마다 다르지만, 트래커 시작 시점 = 사용자 자산 추적 시작 시점이라 합리적 근사
  const sorted = [...state.history].sort((a, b) => a.date.localeCompare(b.date));
  let cpiCum = null;
  let cpiPeriodLabel = '';
  if (sorted.length >= 2) {
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    if (first.cpiIndex && last.cpiIndex) {
      cpiCum = (last.cpiIndex / first.cpiIndex) - 1;
      cpiPeriodLabel = `${first.date} ~ ${last.date}`;
    } else {
      const fallback = num(state.usCpiAnnual) || 0.035;
      const elapsed = (new Date(last.date) - new Date(first.date)) / (365.25 * 86400000);
      cpiCum = Math.pow(1 + fallback, elapsed) - 1;
      cpiPeriodLabel = `${first.date} ~ ${last.date} (CPI 추정)`;
    }
  }

  // 자산타입별 P&L 집계 (holdingPnL 사용 - 평단가 기반, 부채 제외)
  const aggregate = {};  // { atype: { cost, current, count, withPnL } }
  assetHoldings().forEach(h => {
    const atype = assetTypeOf(h);
    if (!aggregate[atype]) aggregate[atype] = { cost: 0, current: 0, count: 0, withPnL: 0 };
    aggregate[atype].count += 1;
    const p = holdingPnL(h);
    if (p) {
      aggregate[atype].cost += p.costKRW;
      aggregate[atype].current += p.curKRW;
      aggregate[atype].withPnL += 1;
    }
  });

  // 표시할 행 만들기
  const ROWS = [];
  ASSET_TYPES.forEach(t => {
    const agg = aggregate[t];
    if (!agg || agg.count === 0) return;
    if (agg.withPnL === 0) {
      // 평단가 미입력 (현금/부동산 또는 사용자가 안 적은 경우)
      ROWS.push({ type: t, cost: 0, current: 0, pnlPct: null, vsCpi: null,
        note: agg.count + '개 보유 (평단가 미입력)', evalText: '평단가 필요', evalCls: 'dash' });
      return;
    }
    const pnlPct = agg.cost > 0 ? (agg.current - agg.cost) / agg.cost : null;
    const vsCpi = (pnlPct !== null && cpiCum !== null) ? pnlPct - cpiCum : null;

    let evalText, evalCls;
    if (vsCpi === null) {
      evalText = '이력 부족'; evalCls = 'dash';
    } else if (vsCpi > 0.10) {
      evalText = '🟢 매우 우수'; evalCls = 'buy';
    } else if (vsCpi > 0) {
      evalText = '🟢 우수'; evalCls = 'buy';
    } else if (vsCpi > -0.05) {
      evalText = '🟡 그저 그럼'; evalCls = 'dash';
    } else {
      evalText = '🔴 잠식'; evalCls = 'sell';
    }

    const partial = agg.withPnL < agg.count
      ? ` (${agg.withPnL}/${agg.count}종목)` : '';
    ROWS.push({ type: t, cost: agg.cost, current: agg.current, pnlPct, vsCpi,
      note: partial, evalText, evalCls });
  });

  if (ROWS.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:20px;">자산을 입력하면 표시됩니다</td></tr>`;
    return;
  }

  // 정렬: vs CPI 큰 순 (null은 마지막)
  ROWS.sort((a, b) => {
    if (a.vsCpi === null) return 1;
    if (b.vsCpi === null) return -1;
    return b.vsCpi - a.vsCpi;
  });

  ROWS.forEach(r => {
    const tr = document.createElement('tr');
    const pnlCell = r.pnlPct !== null
      ? `<span style="color:${r.pnlPct >= 0 ? 'var(--success)' : 'var(--danger)'}">${r.pnlPct >= 0 ? '+' : ''}${(r.pnlPct*100).toFixed(1)}%</span>`
      : '<span style="color:var(--text-muted)">—</span>';
    const vsCpiCell = r.vsCpi !== null
      ? `<span style="color:${r.vsCpi > 0 ? 'var(--success)' : (r.vsCpi < 0 ? 'var(--danger)' : 'var(--text-muted)')};font-weight:600">${r.vsCpi >= 0 ? '+' : ''}${(r.vsCpi*100).toFixed(1)}%p</span>`
      : '<span style="color:var(--text-muted)">—</span>';
    tr.innerHTML = `
      <td><span class="asset-chip ${ASSET_TYPE_CLS[r.type] || 'asset-stock'}" style="cursor:default">${r.type}</span><span style="font-size:11px;color:var(--text-muted);margin-left:6px;">${r.note}</span></td>
      <td class="right">${r.cost > 0 ? fmtKRWshort(r.cost) : '—'}</td>
      <td class="right">${r.current > 0 ? fmtKRWshort(r.current) : '—'}</td>
      <td class="right">${pnlCell}</td>
      <td class="right">${vsCpiCell}</td>
      <td class="center"><span class="pill ${r.evalCls}">${r.evalText}</span></td>
    `;
    tbody.appendChild(tr);
  });

  // 합계 행 (평단가 입력된 종목들 합산)
  let totalCost = 0, totalCurrent = 0;
  ROWS.forEach(r => { totalCost += r.cost; totalCurrent += r.current; });
  if (totalCost > 0) {
    const totalPnL = (totalCurrent - totalCost) / totalCost;
    const totalVsCpi = cpiCum !== null ? totalPnL - cpiCum : null;
    const sumRow = document.createElement('tr');
    sumRow.style.background = '#f8fafc';
    sumRow.style.fontWeight = '600';
    sumRow.innerHTML = `
      <td>합계 (평단가 입력 분만)</td>
      <td class="right">${fmtKRWshort(totalCost)}</td>
      <td class="right">${fmtKRWshort(totalCurrent)}</td>
      <td class="right" style="color:${totalPnL >= 0 ? 'var(--success)' : 'var(--danger)'}">${totalPnL >= 0 ? '+' : ''}${(totalPnL*100).toFixed(1)}%</td>
      <td class="right" style="color:${totalVsCpi !== null && totalVsCpi > 0 ? 'var(--success)' : (totalVsCpi !== null && totalVsCpi < 0 ? 'var(--danger)' : 'var(--text-muted)')}">${totalVsCpi !== null ? (totalVsCpi >= 0 ? '+' : '') + (totalVsCpi*100).toFixed(1) + '%p' : '—'}</td>
      <td class="center" style="font-size:11px;color:var(--text-muted)">${cpiCum !== null ? 'CPI ' + (cpiCum >= 0 ? '+' : '') + (cpiCum*100).toFixed(1) + '%' : '이력 필요'}</td>
    `;
    tbody.appendChild(sumRow);
  }
}

// ==================== 세후 평가 (분석 탭) ====================
// 카테고리별 예상 양도세·세후 평가금액 요약 카드와 상세 표 렌더 (즉시 매도 가정).
// 세금 계산 자체는 calc.js의 computeTaxByCategory()(TAX_RULES 기반, 현금/부동산 제외)가 담당하고
// 여기서는 그 결과를 합산해 #tax-summary 카드 4장과 #taxTable tbody(행+합계 행)만 그린다.
// 손익·세금은 평단가가 입력된 종목만 계산 대상이며, 미입력분은 표에 '평단가 미입력'으로 표시.
// 금액은 전부 KRW, 손익률은 투자원금(매수원가) 대비 %.
function renderTaxAnalysis() {
  const summaryEl = document.getElementById('tax-summary');
  const tbody = document.querySelector('#taxTable tbody');
  if (!summaryEl || !tbody) return;
  const rows = computeTaxByCategory();

  // 1단계 — 카테고리 행들을 합산해 상단 요약 카드용 합계(KRW)를 만든다.
  // hasPnL(평단가 입력) 행만 손익·원금 합계에 포함해 손익률 왜곡을 방지.
  let totalValue = 0, totalPnL = 0, totalCost = 0, totalEvalForPnL = 0, totalDed = 0, totalBase = 0, totalTax = 0;
  rows.forEach(r => {
    totalValue += r.value;
    if (r.hasPnL) { totalPnL += r.pnl; totalCost += r.cost || 0; totalEvalForPnL += r.evalForPnL || 0; }
    totalDed += r.deduction;
    totalBase += r.taxableBase;
    totalTax += r.tax;
  });
  const afterTaxTotal = totalValue - totalTax;
  // 평가 손익률 = 평가손익 / 투자원금(매수원가)
  const pnlRate = totalCost > 0 ? totalPnL / totalCost : null;
  const pnlSign = totalPnL >= 0 ? '+' : '';

  // 2단계 — 요약 카드 4장(세전/세후/예상 세금/평가 손익)을 innerHTML로 교체.
  summaryEl.innerHTML = `
    <div class="tax-card pretax">
      <div class="tax-lbl">세전 평가금액 (분석 대상)</div>
      <div class="tax-val">${fmtKRW(totalValue)}</div>
      <div class="tax-sub">현금/부동산 제외, ${rows.length}개 카테고리</div>
    </div>
    <div class="tax-card posttax">
      <div class="tax-lbl">세후 평가금액 (즉시 매도 가정)</div>
      <div class="tax-val">${fmtKRW(afterTaxTotal)}</div>
      <div class="tax-sub">평단가 입력된 종목만 손익 계산</div>
    </div>
    <div class="tax-card tax-amt">
      <div class="tax-lbl">예상 세금 (양도소득세)</div>
      <div class="tax-val">${fmtKRW(totalTax)}</div>
      <div class="tax-sub">평가손익 ${pnlSign}${fmtKRWshort(totalPnL)} · 공제 ${fmtKRWshort(totalDed)}</div>
    </div>
    <div class="tax-card pnl-rate" style="background: linear-gradient(135deg, ${totalPnL >= 0 ? '#f0fdf4 0%, #dcfce7' : '#fef2f2 0%, #fee2e2'} 100%); border-color: ${totalPnL >= 0 ? '#86efac' : '#fca5a5'};">
      <div class="tax-lbl">평가 손익</div>
      <div class="tax-val" style="color: ${totalPnL >= 0 ? 'var(--success)' : 'var(--danger)'}">${pnlRate !== null ? pnlSign + fmtKRWshort(totalPnL) : '—'}</div>
      <div style="font-size: 16px; font-weight: 600; color: ${totalPnL >= 0 ? 'var(--success)' : 'var(--danger)'}; margin-top: 4px; font-variant-numeric: tabular-nums; letter-spacing: -0.3px;">${pnlRate !== null ? pnlSign + (pnlRate*100).toFixed(2) + '%' : '평단가 입력 필요'}</div>
      <div class="tax-sub">투자원금 ${fmtKRWshort(totalCost)} → 평가 ${fmtKRWshort(totalEvalForPnL)}<span style="color:var(--text-muted);font-size:11px;"> (평단가 입력분 기준)</span></div>
    </div>
  `;

  tbody.innerHTML = '';
  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:20px;">분석 대상 자산이 없습니다</td></tr>`;
    return;
  }
  // 3단계 — 카테고리별 상세 행 생성 (과세 규칙 라벨·손익·공제·과세표준·세금·세후 금액).
  rows.forEach(r => {
    const pnlCls = r.pnl > 0 ? 'tax-pos' : (r.pnl < 0 ? 'tax-neg' : '');
    const pnlSign = r.pnl > 0 ? '+' : '';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><span class="badge ${r.cls}">${r.category}</span> <span style="font-size:11px;color:var(--text-muted);margin-left:6px;">${r.rule.label}</span></td>
      <td class="right">${fmtKRW(r.value)}</td>
      <td class="right ${pnlCls}">${r.hasPnL ? pnlSign + fmtKRWshort(r.pnl) : '<span style="color:var(--text-muted)">평단가 미입력</span>'}</td>
      <td class="right" style="color:var(--text-muted)">${r.rule.deduction > 0 ? fmtKRWshort(r.rule.deduction) : '—'}</td>
      <td class="right">${r.taxableBase > 0 ? fmtKRWshort(r.taxableBase) : '<span style="color:var(--success)">0 (비과세)</span>'}</td>
      <td class="right" style="color:${r.tax > 0 ? 'var(--danger)' : 'var(--text-muted)'}">${r.tax > 0 ? fmtKRW(r.tax) : '—'}</td>
      <td class="right" style="font-weight:600">${fmtKRW(r.afterTax)}</td>
    `;
    tbody.appendChild(tr);
  });
  // 4단계 — 합계 행을 표 맨 아래에 추가 (1단계에서 만든 합산값 재사용).
  const sumRow = document.createElement('tr');
  sumRow.style.background = '#f8fafc';
  sumRow.style.fontWeight = '600';
  const totalSign = totalPnL > 0 ? '+' : '';
  const totalCls = totalPnL > 0 ? 'tax-pos' : (totalPnL < 0 ? 'tax-neg' : '');
  sumRow.innerHTML = `
    <td>합계</td>
    <td class="right">${fmtKRW(totalValue)}</td>
    <td class="right ${totalCls}">${totalSign}${fmtKRWshort(totalPnL)}</td>
    <td class="right">${fmtKRWshort(totalDed)}</td>
    <td class="right">${fmtKRWshort(totalBase)}</td>
    <td class="right" style="color:var(--danger)">${fmtKRW(totalTax)}</td>
    <td class="right">${fmtKRW(afterTaxTotal)}</td>
  `;
  tbody.appendChild(sumRow);
}

// ==================== 설정 탭 (백업 메타) ====================
// 설정 탭 렌더 — 마지막 JSON 백업 시각(state.lastBackupAt)이 14일 이상 지났으면
// 빨간 경고를 띄운다. 환율/CPI 수동 입력 카드는 3차 개편에서 제거됨 —
// 환율은 헤더 배지의 자동/클릭 갱신으로, CPI 폴백은 기본값 3.5%로 동작한다.
function renderSettings() {
  const meta = document.getElementById('backupMeta');
  if (meta) {
    if (state.lastBackupAt) {
      const dt = new Date(state.lastBackupAt);
      const yy = dt.getFullYear();
      const mm = String(dt.getMonth() + 1).padStart(2, '0');
      const dd = String(dt.getDate()).padStart(2, '0');
      const hh = String(dt.getHours()).padStart(2, '0');
      const mi = String(dt.getMinutes()).padStart(2, '0');
      const ageDays = Math.floor((Date.now() - dt.getTime()) / 86400000);
      const ageWarn = ageDays >= 14 ? ` <span style="color:#dc2626;font-weight:600">⚠️ ${ageDays}일 경과 - 백업 권장</span>` : ` (${ageDays}일 전)`;
      meta.innerHTML = `📁 마지막 JSON 백업: ${yy}-${mm}-${dd} ${hh}:${mi}${ageWarn}`;
    } else {
      meta.innerHTML = `📁 <span style="color:#dc2626;font-weight:600">⚠️ 백업 이력 없음 - 지금 한번 다운로드해 두세요</span>`;
    }
  }
}

// 대시보드 KPI 카드 갱신 — 총자산은 항상 전체 기준, 통화노출/유동성 비중은 뷰 스코프 반영.
// 값은 calc.js(grandTotal/exposureTotal/liquidityTotal 등)에서 계산해 kpi-*, m-* 요소의
// textContent만 바꾼다(DOM 구조 재생성 없음). USD 환산은 state.usdKrwRate(KRW/USD) 사용.
// render() 외에 입력 중 partialUpdate()에서도 매번 호출되므로 가볍게 유지해야 한다.
// 마지막에 renderInflationKPI()를 호출해 인플레 카드까지 함께 갱신.
function renderKPIs() {
  // 총자산 / 유동 / 묶임 카드는 항상 전체 기준 (사용자가 자기 총 자산을 항상 알아야 함)
  // 부채가 있으면 카드의 큰 숫자를 순자산(자산−부채)으로 바꾸고 자산·부채 내역 줄을 노출한다.
  const total = grandTotal();
  const debt = debtTotal();
  const net = total - debt;
  const fxRate = num(state.usdKrwRate) || 1380;
  const labelEl = document.getElementById('kpi-total-label');
  if (labelEl) labelEl.textContent = debt > 0 ? '순 자산' : '총 자산';
  document.getElementById('kpi-total').textContent = fmtKRW(net);
  document.getElementById('kpi-total-usd').textContent = fmtUSD(net / fxRate);
  const debtLine = document.getElementById('kpi-debt-line');
  if (debtLine) {
    debtLine.style.display = debt > 0 ? '' : 'none';
    if (debt > 0) debtLine.textContent = `자산 ${fmtKRW(total)} − 부채 ${fmtKRW(debt)}`;
  }
  const totalHoldings = assetHoldings().filter(h => holdingValue(h) > 0).length;
  document.getElementById('kpi-updated').textContent = `총 ${totalHoldings}개 종목 · 마지막 업데이트 ${state.lastUpdated}`;

  // 원화/달러/달러헤지 비중은 viewScope 반영
  const scoped = isLiquidScope();
  const scopeBase = scoped ? scopedTotal() : total;
  const krw = scoped ? scopedExposureTotal('원화') : exposureTotal('원화');
  const usd = scoped ? scopedExposureTotal('달러(노출)') : exposureTotal('달러(노출)');
  const hedge = scoped ? scopedExposureTotal('달러헤지') : exposureTotal('달러헤지');

  document.getElementById('kpi-krw').textContent = scopeBase ? fmtPct(krw / scopeBase) : '0.0%';
  document.getElementById('kpi-krw-amt').textContent = fmtKRW(krw) + (scoped ? ' (유동)' : '');

  document.getElementById('kpi-usd').textContent = scopeBase ? fmtPct(usd / scopeBase) : '0.0%';
  document.getElementById('kpi-usd-amt').textContent = fmtKRW(usd) + (scoped ? ' (유동)' : '');

  const hedgeEl = document.getElementById('kpi-hedge');
  const hedgeAmtEl = document.getElementById('kpi-hedge-amt');
  if (hedgeEl) hedgeEl.textContent = scopeBase ? fmtPct(hedge / scopeBase) : '0.0%';
  if (hedgeAmtEl) hedgeAmtEl.textContent = fmtKRW(hedge) + (scoped ? ' (유동)' : '');

  document.getElementById('m-krw').textContent = scopeBase ? fmtPct(krw / scopeBase) : '0.0%';
  document.getElementById('m-usd').textContent = scopeBase ? fmtPct(usd / scopeBase) : '0.0%';
  const mHedgeEl = document.getElementById('m-hedge');
  if (mHedgeEl) mHedgeEl.textContent = scopeBase ? fmtPct(hedge / scopeBase) : '0.0%';

  // 유동성 KPI
  const liquidAmt = liquidityTotal('liquid');
  const lockedAmt = liquidityTotal('locked');
  const liqEl = document.getElementById('kpi-liquid');
  const liqPctEl = document.getElementById('kpi-liquid-pct');
  const lockedEl = document.getElementById('kpi-locked-amt');
  if (liqEl) liqEl.textContent = fmtKRW(liquidAmt);
  if (liqPctEl) liqPctEl.textContent = total ? fmtPct(liquidAmt / total) + ' / 총자산' : '0.0%';
  if (lockedEl) lockedEl.textContent = `🔒 묶임 ${fmtKRWshort(lockedAmt)} (${total ? fmtPct(lockedAmt / total) : '0.0%'})`;

  renderInflationKPI();
}

// 대시보드 인플레 대비 실질 자산 KPI 카드 — renderKPIs() 말미에서만 호출된다.
// state.history의 첫/마지막 스냅샷을 비교해 명목 USD 수익률에서 CPI 누적 상승률을 뺀
// 실질 갭(%p)을 계산하고, 카드 클래스(win/lose/flat)로 색상 상태를 표현한다.
// 스냅샷이 2개 미만이거나 기준 USD가 없으면 '대기' 상태로 안내 문구만 표시.
// CPI 지수가 스냅샷에 없으면 state.usCpiAnnual(기본 3.5%) 연율로 경과 기간만큼 근사.
function renderInflationKPI() {
  const card = document.getElementById('kpi-inflation');
  const gapEl = document.getElementById('kpi-inflation-gap');
  const stateEl = document.getElementById('kpi-inflation-state');
  const breakdownEl = document.getElementById('kpi-inflation-breakdown');
  if (!card) return;

  // reset classes
  card.classList.remove('win', 'lose', 'flat');

  const sorted = [...state.history].sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.length < 2) {
    card.classList.add('flat');
    stateEl.textContent = '대기';
    gapEl.textContent = '—';
    breakdownEl.innerHTML = sorted.length === 0
      ? '<span>이력 탭에서 첫 스냅샷 찍으면 자동 계산</span>'
      : '<span>다음 스냅샷부터 비교 시작</span>';
    return;
  }

  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const baseUSD = first.totalUSD || 0;
  const lastUSD = last.totalUSD || 0;
  if (baseUSD <= 0) {
    card.classList.add('flat');
    stateEl.textContent = '대기';
    gapEl.textContent = '—';
    breakdownEl.innerHTML = '<span>첫 스냅샷에 자산 데이터 부족</span>';
    return;
  }

  // 명목 USD 수익률
  const nominalRet = (lastUSD - baseUSD) / baseUSD;
  // CPI 누적 인플레 (없으면 fallback annual rate 사용)
  let cpiRet;
  if (first.cpiIndex && last.cpiIndex) {
    cpiRet = (last.cpiIndex / first.cpiIndex) - 1;
  } else {
    const fallback = num(state.usCpiAnnual) || 0.035;
    const elapsed = (new Date(last.date) - new Date(first.date)) / (365.25 * 86400000);
    cpiRet = Math.pow(1 + fallback, elapsed) - 1;
  }
  // 실질 갭 (명목 - CPI)
  const gap = nominalRet - cpiRet;

  // 상태 분류
  let stateClass, stateLabel;
  if (gap > 0.005) {
    stateClass = 'win';
    stateLabel = '🟢 이기는 중';
  } else if (gap < -0.005) {
    stateClass = 'lose';
    stateLabel = '🔴 잠식 중';
  } else {
    stateClass = 'flat';
    stateLabel = '⚪ 보합';
  }
  card.classList.add(stateClass);
  stateEl.textContent = stateLabel;
  gapEl.textContent = (gap >= 0 ? '+' : '') + (gap * 100).toFixed(1) + '%p';
  breakdownEl.innerHTML = `
    <span>총 자산 ${nominalRet >= 0 ? '+' : ''}${(nominalRet * 100).toFixed(1)}% (입출금 포함)</span>
    <span>CPI 인플레 ${cpiRet >= 0 ? '+' : ''}${(cpiRet * 100).toFixed(1)}%</span>
  `;
}

// 자산 입력 테이블 전체 렌더 — 카테고리 섹션별 헤더/행/추가버튼을 새로 만들고 이벤트를 다시 바인딩.
// 이 파일에서 가장 큰 함수. #holdingsContainer를 통째로 비우고 constants.js의 CATEGORIES 순서대로
// 섹션을 재구성하므로, 입력 중에 부르면 포커스가 날아간다(그래서 입력 중엔 partialUpdate 사용).
// 카테고리 성격(검색형 hasTicker/금액직접입력형 amountOnly/일반형 금)에 따라 행 구성이 다르지만,
// 컬럼 정렬을 맞추기 위해 11-column grid로 통일. 행 이벤트는 data-* 속성으로 식별해 렌더 후 일괄 바인딩.
// 접힘 상태(state.collapsed)·거래소 선택(state.cryptoExchange) 변경은 saveState()로 즉시 저장된다.
function renderHoldings() {
  const container = document.getElementById('holdingsContainer');
  container.innerHTML = '';

  // 1단계 — 카테고리별 섹션 생성 (헤더 + 컬럼 헤더 행 + 보유 행들 + 추가 버튼).
  CATEGORIES.forEach(c => {
    const sect = document.createElement('div');
    sect.className = 'cat-section' + (state.collapsed[c.key] ? ' collapsed' : '');

    // 섹션 헤더 — 카테고리 배지·보유 수·합계(KRW, USD 카테고리는 USD 병기)·전체대비 %.
    // 헤더 클릭으로 접기/펼치기 토글. 암호화폐는 시세 출처 드롭다운, 금은 시세 갱신 버튼이 추가로 붙는다.
    const total = categoryTotal(c.key);
    const grand = grandTotal();
    const pctOfGrand = grand > 0 ? (total / grand * 100) : 0;
    const header = document.createElement('div');
    header.className = 'cat-header';
    const exchangeSelector = c.isCrypto ? `
      <span style="font-size:11px;color:var(--text-muted);margin-left:8px;">시세:</span>
      <select class="crypto-exchange-select" data-stop-collapse="1" style="font-size:11px;padding:2px 6px;border-radius:4px;border:1px solid var(--border);background:white;cursor:pointer;">
        <option value="bithumb" ${state.cryptoExchange === 'bithumb' ? 'selected' : ''}>Bithumb</option>
        <option value="upbit" ${state.cryptoExchange === 'upbit' ? 'selected' : ''}>Upbit</option>
        <option value="coingecko" ${state.cryptoExchange === 'coingecko' ? 'selected' : ''}>CoinGecko</option>
      </select>
    ` : '';
    const goldRefreshBtn = c.key === '금' ? `
      <button class="gold-refresh-btn" data-stop-collapse="1" style="font-size:11px;padding:3px 9px;border-radius:6px;border:1px solid #e0a800;background:linear-gradient(135deg,#fef3c7,#fde68a);color:#78350f;cursor:pointer;margin-left:8px;font-weight:500;">
        🥇 시세 자동 갱신
      </button>
    ` : '';
    header.innerHTML = `
      <div class="left">
        <span class="badge ${c.cls}">${c.key}</span>
        <span style="color:var(--text-muted);font-size:12px;">
          ${state.holdings.filter(h => h.category === c.key && holdingValue(h) > 0).length}개 보유
        </span>
        ${exchangeSelector}
        ${goldRefreshBtn}
      </div>
      <div style="display:flex;align-items:center;gap:12px;">
        ${c.isUSD ? `<span style="font-size:12px;color:var(--c-usd);font-weight:500;font-variant-numeric:tabular-nums;">${fmtUSD(categoryTotalUSD(c.key))}</span>` : ''}
        <span class="total">${fmtKRW(total)}</span>
        <span class="total-pct" style="font-size:12px;color:var(--text-muted);font-variant-numeric:tabular-nums;">${grand > 0 ? '(' + pctOfGrand.toFixed(1) + '%)' : ''}</span>
        <span class="arrow"></span>
      </div>
    `;
    header.onclick = (ev) => {
      // 드롭다운 등 내부 컨트롤 클릭 시 collapse 안 함
      if (ev.target.closest('[data-stop-collapse]') || ev.target.tagName === 'OPTION') return;
      state.collapsed[c.key] = !state.collapsed[c.key];
      sect.classList.toggle('collapsed');
      saveState();
    };
    if (c.isCrypto) {
      header.querySelector('.crypto-exchange-select').addEventListener('change', (ev) => {
        ev.stopPropagation();
        state.cryptoExchange = ev.target.value;
        saveState();
        toast(`암호화폐 시세 출처: ${ev.target.options[ev.target.selectedIndex].text}`);
      });
      header.querySelector('.crypto-exchange-select').addEventListener('click', (ev) => {
        ev.stopPropagation();
      });
    }
    if (c.key === '금') {
      // 금 시세 자동 갱신 버튼 — fetch.js의 fetchAndApplyGoldPrice가 시세 조회 후 render()까지 수행.
      header.querySelector('.gold-refresh-btn').addEventListener('click', async (ev) => {
        ev.stopPropagation();
        await fetchAndApplyGoldPrice(ev.currentTarget);
      });
    }

    const body = document.createElement('div');
    body.className = 'cat-body';

    // 통일된 11-column 헤더 (P&L 컬럼 추가): 모든 카테고리에서 컬럼 정렬 일치
    // .pnl 클래스를 추가해 P&L 컬럼 포함 grid 적용
    const headRow = document.createElement('div');
    headRow.className = 'row pnl head' + (c.hasTicker ? ' has-ticker' : '');
    if (c.hasTicker) {
      headRow.innerHTML = `
        <div style="grid-column: 1 / 3">종목명/티커 검색</div>
        <div style="text-align:right">수량</div>
        <div style="text-align:right" title="평단가 (매수 평균 단가)">평단가</div>
        <div style="text-align:right">${c.isUSD ? '현재가 (USD/KRW)' : '현재가'}</div>
        <div style="text-align:right">평가금액</div>
        <div style="text-align:right" title="평단가 입력 시 자동 계산">평가손익</div>
        <div style="text-align:center">통화노출</div>
        <div style="text-align:center">타입</div>
        <div>메모</div>
        <div title="시세 갱신">🔄</div>
        <div></div>
      `;
    } else {
      const isAmount = c.amountOnly;
      const col1Label = c.key === '현금' ? '계좌명' : (c.key === '금' ? '명칭' : (c.key === '부동산' ? '단지/명칭' : '종목명'));
      const col2Label = c.key === '현금' ? '은행' : (c.key === '금' ? '보관처' : '계좌/거래소');
      const skipAcc = c.skipAccount;
      headRow.innerHTML = `
        ${skipAcc
          ? `<div style="grid-column: 1 / 3">${col1Label}</div>`
          : `<div>${col1Label}</div><div>${col2Label}</div>`}
        <div style="text-align:right">${isAmount ? '' : (c.key === '금' ? '그램(g)' : '수량')}</div>
        <div style="text-align:right">${isAmount ? '' : '평단가'}</div>
        <div style="text-align:right">${isAmount ? '평가금액' : (c.key === '금' ? '시세(원/g)' : '현재가')}</div>
        <div style="text-align:right">${isAmount ? '' : '평가금액'}</div>
        <div style="text-align:right">${isAmount ? '' : '평가손익'}</div>
        <div style="text-align:center">통화노출</div>
        <div style="text-align:center">타입</div>
        <div>메모</div>
        <div></div>
        <div></div>
      `;
    }
    body.appendChild(headRow);

    // 2단계 — 이 카테고리에 속한 보유 종목 행 생성. 행마다 자산타입 칩·유동성 칩·
    // 통화노출 셀렉트·메모 셀·삭제 버튼을 공통으로 만들고, 카테고리 유형별로 본문을 조립.
    state.holdings.filter(h => h.category === c.key).forEach(h => {
      const row = document.createElement('div');
      // .pnl 클래스 추가: 11-column grid 적용
      row.className = 'row pnl' + (c.hasTicker ? ' has-ticker' : '') + (holdingLiquidity(h) === 'locked' ? ' is-locked' : '');
      const at = assetTypeOf(h);
      const atCls = ASSET_TYPE_CLS[at] || 'asset-stock';
      // 선택 가능한 자산타입 — 부동산/암호화폐는 카테고리 잠금이 따로 있어서 제외
      const SELECTABLE_ATYPES = ['주식', '채권', '현금', '금', '원자재'];
      const assetChip = c.assetTypeFixed
        ? `<span class="asset-chip locked ${atCls}" title="${c.assetTypeFixed} (자동 분류)">${c.assetTypeFixed}</span>`
        : `<select class="asset-chip asset-chip-select ${atCls}" data-field="assetType" data-id="${h.id}" title="자산타입 선택 (도넛/리밸런싱은 이걸 기준으로 계산)">
            ${SELECTABLE_ATYPES.map(t => `<option value="${t}" ${t === at ? 'selected' : ''}>${t}</option>`).join('')}
          </select>`;
      const liq = holdingLiquidity(h);
      const liqChip = `<button class="liq-chip ${liq === 'locked' ? 'liq-locked' : 'liq-liquid'}" data-toggle-liq="${h.id}" title="${liq === 'locked' ? '🔒 묶임 — 즉시 매도/인출 어려움 (클릭해서 유동으로 변경)' : '💧 유동 — 즉시 매도/인출 가능 (클릭해서 묶임으로 변경)'}">${liq === 'locked' ? '🔒' : '💧'}</button>`;
      const exposureSelect = `<select class="inp center" data-field="exposure" data-id="${h.id}">
        ${EXPOSURES.map(e => `<option value="${e}" ${e === h.exposure ? 'selected' : ''}>${e}</option>`).join('')}
      </select>`;
      // 종목 메모(멀티라인) 인디케이터 — 이름이 있을 때만 동작.
      // h.memo(짧은 라벨, 현재 행 한정)와 별개로 종목명 기준으로 공유되는 longMemo.
      const longMemo = h.name ? getHoldingMemo(h.name) : '';
      const longMemoBtn = `<button class="memo-dot ${longMemo ? 'has-memo' : ''}" ${h.name ? `data-holding-memo="${escapeHtml(h.name)}"` : ''} data-memo="${escapeHtml(longMemo)}" title="${h.name ? (longMemo ? '종목 메모 보기/편집' : '종목 메모 추가') : '먼저 종목명을 입력하세요'}" ${h.name ? '' : 'disabled'}>${longMemo ? '📝' : '＋'}</button>`;
      // 메모 컬럼: long memo 있으면 첫 줄 미리보기(클릭=모달), 없으면 기존 짧은 라벨 input
      const memoBody = longMemo
        ? `<div class="memo-preview" ${h.name ? `data-holding-memo="${escapeHtml(h.name)}"` : ''} title="클릭해서 보기/편집">${escapeHtml(memoFirstLine(longMemo, 30))}${longMemo.split(/\r?\n/).length > 1 ? ' ...' : ''}</div>`
        : `<input class="inp" placeholder="—" value="${escapeHtml(h.memo)}" data-field="memo" data-id="${h.id}" />`;
      const memoInput = `<div class="memo-cell">${memoBody}${longMemoBtn}</div>`;
      const deleteBtn = `<button class="icon-btn" data-delete="${h.id}" title="삭제">×</button>`;
      const chipCellWrap = `<div class="chip-cell">${assetChip}${liqChip}</div>`;

      // P&L 셀 빌더 (검색형/금 카테고리에서 공통 사용).
      // calc.js의 holdingPnL(평단가 기반)이 null이면 '—', 아니면 손익 금액(KRW 축약)+%를 색상 클래스와 함께 출력.
      function pnlCellHTML(h) {
        const p = holdingPnL(h);
        if (!p) return `<div class="pnl-cell zero">—</div>`;
        const cls = p.pnl > 0 ? 'pos' : (p.pnl < 0 ? 'neg' : 'zero');
        const sign = p.pnl > 0 ? '+' : '';
        return `<div class="pnl-cell ${cls}">
          <div class="amt">${sign}${fmtKRWshort(p.pnl)}</div>
          <div class="pct">${sign}${(p.pct*100).toFixed(2)}%</div>
        </div>`;
      }

      if (c.hasTicker) {
        // === 검색형 (국내주식, 해외주식, 암호화폐, 연금저축, 퇴직연금, ISA) ===
        // 종목명 검색 인풋(fetch.js onSearchInput 연동) + 수량/평단가/현재가 입력.
        // isUSD 카테고리는 현재가·평단가를 USD로 받고 KRW 환산액을 병기한다.
        const priceCell = c.isUSD
          ? `<div class="dual-price">
               <div class="usd">$<input class="" placeholder="0" value="${fmtNumInput(h.priceUSD)}" data-field="priceUSD" data-id="${h.id}" data-numeric="1" /></div>
               <div class="krw">${num(h.priceUSD) > 0 ? fmtKRW(num(h.priceUSD) * num(state.usdKrwRate)) : '—'}</div>
             </div>`
          : `<input class="inp right" placeholder="0" value="${fmtNumInput(h.price)}" data-field="price" data-id="${h.id}" data-numeric="1" />`;
        // 평단가 셀: 해외주식은 USD, 그 외 KRW
        const avgPriceCell = c.isUSD
          ? `<input class="inp right target" placeholder="$0" value="${fmtNumInput(h.avgPriceUSD)}" data-field="avgPriceUSD" data-id="${h.id}" data-numeric="1" title="매수 평단가 (USD). 비우면 손익 계산 안 함" />`
          : `<input class="inp right target" placeholder="0" value="${fmtNumInput(h.avgPrice)}" data-field="avgPrice" data-id="${h.id}" data-numeric="1" title="매수 평단가. 비우면 손익 계산 안 함" />`;
        const searchPlaceholder = c.isCrypto
          ? '비트코인, BTC 검색...'
          : (c.isUSD ? 'Apple, AAPL 검색...' : '삼성전자, 005930 검색...');
        const tickerInfo = h.ticker
          ? `<div class="ticker-info"><span class="sym">${escapeHtml(h.ticker)}</span>${h.symbol && h.symbol !== h.ticker ? ' · ' + escapeHtml(h.symbol) : ''}</div>`
          : '';
        row.innerHTML = `
          <div class="search-cell">
            <input class="search-input" placeholder="${searchPlaceholder}" value="${escapeHtml(h.name)}" data-search="${h.id}" data-id="${h.id}" autocomplete="off" />
            ${tickerInfo}
            <div class="search-dropdown" data-dropdown="${h.id}"></div>
          </div>
          <input class="inp right" placeholder="0" value="${h.quantity}" data-field="quantity" data-id="${h.id}" />
          ${avgPriceCell}
          ${priceCell}
          <div class="computed">${fmtKRW(holdingValue(h))}</div>
          ${pnlCellHTML(h)}
          ${exposureSelect}
          ${chipCellWrap}
          ${memoInput}
          <button class="refresh-btn" data-refresh="${h.id}" title="시세 갱신">🔄</button>
          ${deleteBtn}
        `;
      } else if (c.amountOnly) {
        // === 평가금액 직접입력형 (현금, 부동산) - 평단가/손익 컬럼은 빈 셀 ===
        // 수량 개념 없이 price 필드에 평가금액을 직접 입력받는다(quantity는 1 고정).
        // 통화노출이 '달러(노출)'인 현금은 USD로 입력받아 KRW 환산액을 병기.
        const isDollarCash = h.exposure === '달러(노출)';
        const amountCell = isDollarCash
          ? `<div class="dual-price">
               <div class="usd">$<input class="" placeholder="0" value="${fmtNumInput(h.price)}" data-field="price" data-id="${h.id}" data-numeric="1" data-amount-only="1" /></div>
               <div class="krw">${num(h.price) > 0 ? fmtKRW(num(h.price) * num(state.usdKrwRate)) : '—'}</div>
             </div>`
          : `<input class="inp right" placeholder="0" value="${fmtNumInput(h.price)}" data-field="price" data-id="${h.id}" data-numeric="1" data-amount-only="1" />`;
        const computedDisplay = isDollarCash ? fmtKRW(holdingValue(h)) : '';
        const namePh = c.key === '부동산' ? '예: 잠실엘스 84A' : '예: 신한 CMA';
        // 부동산: 명칭이 col 1-2 spanning, account 입력 생략
        const nameAndAccountCells = c.skipAccount
          ? `<input class="inp" style="grid-column: 1 / 3" placeholder="${namePh}" value="${escapeHtml(h.name)}" data-field="name" data-id="${h.id}" />`
          : `<input class="inp" placeholder="${namePh}" value="${escapeHtml(h.name)}" data-field="name" data-id="${h.id}" />
             <input class="inp" placeholder="—" value="${escapeHtml(h.account)}" data-field="account" data-id="${h.id}" />`;
        row.innerHTML = `
          ${nameAndAccountCells}
          <div class="col-empty"></div>
          <div class="col-empty"></div>
          ${amountCell}
          <div class="computed">${computedDisplay}</div>
          <div class="pnl-cell zero">—</div>
          ${exposureSelect}
          ${chipCellWrap}
          ${memoInput}
          <div class="col-empty"></div>
          ${deleteBtn}
        `;
      } else {
        // === 일반형 (금) - 평단가 컬럼 추가 (g당 평단) ===
        // 수량은 그램(g), 시세·평단가는 원/g 단위. 검색 없이 명칭·보관처를 직접 입력한다.
        const avgPriceCell = `<input class="inp right target" placeholder="0" value="${fmtNumInput(h.avgPrice)}" data-field="avgPrice" data-id="${h.id}" data-numeric="1" title="g당 매수 평단가. 비우면 손익 계산 안 함" />`;
        row.innerHTML = `
          <input class="inp" placeholder="예: KRX 금현물 / 골드바" value="${escapeHtml(h.name)}" data-field="name" data-id="${h.id}" />
          <input class="inp" placeholder="한국투자증권/금고 등" value="${escapeHtml(h.account)}" data-field="account" data-id="${h.id}" />
          <input class="inp right" placeholder="g" value="${h.quantity}" data-field="quantity" data-id="${h.id}" />
          ${avgPriceCell}
          <input class="inp right" placeholder="0" value="${fmtNumInput(h.price)}" data-field="price" data-id="${h.id}" data-numeric="1" />
          <div class="computed">${fmtKRW(holdingValue(h))}</div>
          ${pnlCellHTML(h)}
          ${exposureSelect}
          ${chipCellWrap}
          ${memoInput}
          <div class="col-empty"></div>
          ${deleteBtn}
        `;
      }
      body.appendChild(row);
    });

    // 3단계 — 종목 추가 버튼. 클릭 시 카테고리 기본값(통화노출/자산타입/유동성, constants.js)으로
    // 빈 보유 항목을 state.holdings에 push하고 render()로 전체 재렌더.
    const addBtn = document.createElement('button');
    addBtn.className = 'add-row';
    addBtn.textContent = `+ ${c.key} ${c.amountOnly ? '항목' : '종목'} 추가`;
    addBtn.onclick = (e) => {
      e.stopPropagation();
      state.holdings.push({
        id: uid(), category: c.key, name: '', account: '', ticker: '', symbol: '',
        quantity: c.amountOnly ? '1' : '', price: '', priceUSD: '',
        avgPrice: '', avgPriceUSD: '',
        exposure: DEFAULT_EXPOSURE_BY_CAT[c.key], memo: '',
        assetType: c.assetTypeFixed || '주식',
        liquidity: DEFAULT_LIQUIDITY_BY_CAT[c.key] || 'liquid',
        lastFetched: ''
      });
      render();
    };
    body.appendChild(addBtn);

    sect.appendChild(header);
    sect.appendChild(body);
    container.appendChild(sect);
  });

  // 4단계 — 렌더가 끝난 뒤 data-* 속성 기준으로 이벤트를 일괄 바인딩.
  // 필드 입력/변경 → onFieldChange, 숫자 필드는 포커스/블러 시 콤마 제거·복원 핸들러 추가.
  container.querySelectorAll('input[data-field], select[data-field]').forEach(el => {
    el.addEventListener('input', onFieldChange);
    el.addEventListener('change', onFieldChange);
    if (el.getAttribute('data-numeric')) {
      el.addEventListener('blur', onNumericBlur);
      el.addEventListener('focus', onNumericFocus);
    }
  });
  // 행 삭제 버튼 — 확인 없이 즉시 제거 후 전체 재렌더(저장은 render 내부 saveState가 수행).
  container.querySelectorAll('[data-delete]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = e.target.getAttribute('data-delete');
      state.holdings = state.holdings.filter(h => h.id !== id);
      render();
    });
  });
  // 행별 시세 갱신 버튼 — fetch.js의 refreshHolding이 API 조회·가격 반영·render()까지 수행.
  container.querySelectorAll('[data-refresh]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = e.currentTarget.getAttribute('data-refresh');
      await refreshHolding(id);
    });
  });
  // 종목 메모 버튼/미리보기 — state.js의 openMemoModal로 멀티라인 메모 편집 모달을 연다.
  container.querySelectorAll('[data-holding-memo]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      const name = btn.getAttribute('data-holding-memo');
      if (!name) return;
      openMemoModal('holding', name, name);
    });
  });
  // 자산타입 순환 토글(레거시 칩 버튼용) — 현재 행 템플릿은 select를 쓰므로 사실상 매칭 대상이 없다.
  container.querySelectorAll('[data-toggle-asset]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = e.currentTarget.getAttribute('data-toggle-asset');
      const h = state.holdings.find(x => x.id === id);
      if (!h) return;
      // 주식 → 채권 → 금 → 원자재 → 현금 → 주식 순환
      const TOGGLABLE = ['주식', '채권', '금', '원자재', '현금'];
      const idx = TOGGLABLE.indexOf(h.assetType);
      h.assetType = TOGGLABLE[(idx + 1) % TOGGLABLE.length] || '주식';
      saveState();
      render();
    });
  });
  // 유동성 칩(💧/🔒) 클릭 토글 — h.liquidity를 liquid↔locked로 뒤집고 저장 후 전체 재렌더.
  container.querySelectorAll('[data-toggle-liq]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = e.currentTarget.getAttribute('data-toggle-liq');
      const h = state.holdings.find(x => x.id === id);
      if (!h) return;
      const cur = holdingLiquidity(h);
      h.liquidity = (cur === 'locked') ? 'liquid' : 'locked';
      saveState();
      render();
    });
  });
  // 검색 입력 핸들러 (IME 조합 중 검색 발사 방지).
  // 한글은 compositionend(조합 확정) 시점에만, 영문 등은 input 즉시 fetch.js의 onSearchInput으로 넘긴다.
  // 포커스/블러 시 드롭다운 표시·숨김도 fetch.js(onSearchFocus/onSearchBlur)가 담당.
  container.querySelectorAll('input[data-search]').forEach(input => {
    let composing = false;
    input.addEventListener('compositionstart', () => { composing = true; });
    input.addEventListener('compositionend', (e) => {
      composing = false;
      // 조합 완료 시점에 검색 발사
      onSearchInput({ target: e.target });
    });
    input.addEventListener('input', (e) => {
      // 한글 조합 중에는 무시. 영문 등은 즉시 검색.
      if (composing || e.isComposing) return;
      onSearchInput(e);
    });
    input.addEventListener('focus', onSearchFocus);
    input.addEventListener('blur', onSearchBlur);
  });
}

// 숫자 인풋 포커스 핸들러 — 콤마를 제거한 raw 값으로 바꿔 편집을 편하게 함.
// data-numeric="1" 인풋(가격/평단가류)에만 renderHoldings에서 바인딩된다.
// setTimeout(0)으로 브라우저 기본 전체선택 이후에 커서를 끝으로 옮긴다.
function onNumericFocus(e) {
  // 편집 시 콤마 제거해서 raw 숫자만 보여주기
  const raw = String(e.target.value).replace(/,/g, '');
  e.target.value = raw;
  // 커서를 끝에 두기
  setTimeout(() => {
    try { e.target.setSelectionRange(raw.length, raw.length); } catch (_) {}
  }, 0);
}

// 숫자 인풋 블러 핸들러 — 편집이 끝나면 calc.js의 fmtNumInput으로 콤마 포맷을 복원.
// onNumericFocus와 짝을 이뤄 "편집 중 raw 숫자, 평소엔 콤마 표시"를 구현한다.
function onNumericBlur(e) {
  // 포커스 나가면 콤마 자동 포맷
  const formatted = fmtNumInput(e.target.value);
  e.target.value = formatted;
}

// 보유 행 필드 변경 핸들러 — 필드 종류에 따라 전체 재렌더/부분 갱신을 선택.
// data-id로 state.holdings에서 해당 항목을 찾아 값을 반영하고 즉시 saveState()로 저장.
// exposure/assetType(select)은 차트 색·리밸런싱에 바로 영향 → 무조건 render().
// 숫자 필드는 입력 중 포커스 유지를 위해 input 이벤트엔 partialUpdate만, blur(change) 시에만 전체 재렌더.
// name/account/memo 같은 텍스트 필드는 저장만 하고 재렌더하지 않는다(입력 흐름 유지).
function onFieldChange(e) {
  const id = e.target.getAttribute('data-id');
  const field = e.target.getAttribute('data-field');
  const h = state.holdings.find(x => x.id === id);
  if (!h) return;
  h[field] = e.target.value;
  saveState();

  // exposure/assetType (select) 변경 시는 전체 재렌더 OK
  // assetType은 도넛/리밸런싱/트리맵 색상에 즉시 영향 → 반드시 render()
  if (field === 'exposure' || field === 'assetType') {
    render();
    return;
  }

  // 숫자 입력(price, priceUSD, quantity, avgPrice, avgPriceUSD)은 input 이벤트마다 부분 갱신만
  if (['quantity', 'price', 'priceUSD', 'avgPrice', 'avgPriceUSD'].includes(field)) {
    if (e.type === 'change') {
      // blur 시 전체 재렌더 → 콤마 포맷 적용
      render();
    } else {
      partialUpdate(h);
    }
  }
}

// 입력 중 부분 갱신 — 입력 행 DOM은 건드리지 않고(포커스 유지) KPI·계산 셀·합계만 갱신, 무거운 차트는 debounce.
// onFieldChange의 숫자 필드 input 이벤트에서만 호출된다. 해당 행의 평가금액·P&L 셀과
// 카테고리 헤더 합계는 textContent/innerHTML 직접 교체, KPI·목표 테이블은 개별 render 함수 재호출.
// 차트는 calc.js의 _debouncedChartRefresh(200ms)로 미뤄 타이핑마다 다시 그리는 비용을 줄인다.
function partialUpdate(h) {
  // 입력 중 포커스를 잃지 않도록 입력 행 자체는 건드리지 않고
  // KPI, 합계, 차트, 목표 테이블만 갱신
  renderKPIs();

  // 해당 행의 평가금액 셀 업데이트 (amount-only 카테고리는 셀이 없음)
  const inputEl = document.querySelector(`input[data-id="${h.id}"]`);
  const row = inputEl?.closest('.row');
  const computedCell = row?.querySelector('.computed');
  if (computedCell) computedCell.textContent = fmtKRW(holdingValue(h));

  // P&L 셀 업데이트
  const pnlEl = row?.querySelector('.pnl-cell');
  if (pnlEl) {
    const p = holdingPnL(h);
    if (!p) {
      pnlEl.className = 'pnl-cell zero';
      pnlEl.innerHTML = '—';
    } else {
      const cls = p.pnl > 0 ? 'pos' : (p.pnl < 0 ? 'neg' : 'zero');
      const sign = p.pnl > 0 ? '+' : '';
      pnlEl.className = 'pnl-cell ' + cls;
      pnlEl.innerHTML = `<div class="amt">${sign}${fmtKRWshort(p.pnl)}</div><div class="pct">${sign}${(p.pct*100).toFixed(2)}%</div>`;
    }
  }

  // 카테고리 헤더 합계 업데이트
  const catSection = row?.closest('.cat-section');
  if (catSection) {
    const totalEl = catSection.querySelector('.cat-header .total');
    if (totalEl) totalEl.textContent = fmtKRW(categoryTotal(h.category));
    // 카테고리 헤더의 전체대비 % 도 갱신
    const total = grandTotal();
    const pctEl = catSection.querySelector('.cat-header .total-pct');
    if (pctEl) pctEl.textContent = total > 0 ? '(' + (categoryTotal(h.category) / total * 100).toFixed(1) + '%)' : '';
  }

  // 가벼운 갱신은 즉시
  renderAssetTypeTargets();
  renderExpTargets();
  // 무거운 차트는 debounce (입력 끝난 후 200ms)
  _debouncedChartRefresh();
}

// HTML 특수문자 이스케이프 — 사용자 입력(종목명/메모 등)을 innerHTML 템플릿에 넣을 때 XSS/마크업 깨짐 방지.
// null/undefined도 빈 문자열로 안전 처리. renderHoldings·renderHistory의 템플릿 전반에서 사용.
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[m]));
}

// 자산타입별 목표 비중 테이블 렌더 — ASSET_TYPES 전체(부동산 포함)를 행으로, 목표는 % 인풋으로 편집.
// 현재 금액(KRW)·비중은 calc.js의 assetTypeTotal/grandTotal, 목표는 state.assetTypeTargets에서 읽는다.
// 목표 인풋 change 시 state에 저장하고 render()로 전체 반영. 합계 행은 목표 합이 100%인지 검증 표시.
// '금' 목표 입력 시 통화노출 '달러헤지' 목표(state.expTargets)와 자동 동기화(현재 매핑상 둘이 같아야 함).
function renderAssetTypeTargets() {
  const total = grandTotal();
  const tbody = document.querySelector('#assetTypeTargetsTable tbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  let sumTarget = 0;
  ASSET_TYPES.forEach(t => {
    const cur = assetTypeTotal(t);
    const curPct = total ? cur / total : 0;
    const tgt = state.assetTypeTargets[t] ?? 0;
    sumTarget += tgt;
    const tgtAmt = total * tgt;
    const diff = tgtAmt - cur;
    const signal = !total ? { txt: '—', cls: 'dash' }
      : Math.abs(curPct - tgt) < 0.01 ? { txt: '적정', cls: 'ok' }
      : curPct < tgt ? { txt: '매수 필요', cls: 'buy' }
      : { txt: '매도 필요', cls: 'sell' };

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><span class="asset-chip ${ASSET_TYPE_CLS[t]}" style="cursor:default">${t}</span></td>
      <td class="right">${fmtKRW(cur)}</td>
      <td class="right">${fmtPct(curPct)}</td>
      <td class="right">
        <input class="inp right target" type="number" step="0.1" min="0" max="100"
               value="${(tgt * 100).toFixed(1)}" data-asset-target="${t}" style="width:70px;display:inline-block;" />%
      </td>
      <td class="right">${fmtKRW(tgtAmt)}</td>
      <td class="right" style="color:${diff > 0 ? 'var(--success)' : (diff < 0 ? 'var(--danger)' : 'var(--text-muted)')}">${diff !== 0 ? fmtKRW(diff) : '—'}</td>
      <td class="center"><span class="pill ${signal.cls}">${signal.txt}</span></td>
    `;
    tbody.appendChild(tr);
  });

  const sumRow = document.createElement('tr');
  sumRow.style.background = '#f8fafc';
  sumRow.style.fontWeight = '600';
  const sumOk = Math.abs(sumTarget - 1) < 0.001;
  sumRow.innerHTML = `
    <td>합계</td>
    <td class="right">${fmtKRW(total)}</td>
    <td class="right">100.0%</td>
    <td class="right" style="color:${sumOk ? 'var(--success)' : 'var(--danger)'}">${fmtPct(sumTarget)}</td>
    <td class="right">${fmtKRW(total)}</td>
    <td class="right">—</td>
    <td class="center"><span class="pill ${sumOk ? 'ok' : 'sell'}">${sumOk ? '✓ OK' : '100% 아님'}</span></td>
  `;
  tbody.appendChild(sumRow);

  tbody.querySelectorAll('[data-asset-target]').forEach(el => {
    el.addEventListener('change', e => {
      const t = e.target.getAttribute('data-asset-target');
      const v = num(e.target.value) / 100;
      state.assetTypeTargets[t] = v;
      // 자산타입 '금' ↔ 통화노출 '달러헤지' 자동 연동
      // 지금 달러헤지에 매핑되는 자산타입이 금뿐이라 값이 같아야 자연스러움
      if (t === '금') state.expTargets['달러헤지'] = v;
      render();
    });
  });
}

// 통화노출별 목표 비중 테이블 렌더 — renderAssetTypeTargets와 동일 구조를 통화노출(EXPOSURES) 축으로 반복.
// 현재값은 exposureTotal(calc.js), 목표는 state.expTargets. 목표 인풋 change 시 저장 후 render().
// '달러헤지' 목표 변경 시 자산타입 '금' 목표와 역방향 동기화(renderAssetTypeTargets의 연동과 쌍).
function renderExpTargets() {
  const total = grandTotal();
  const tbody = document.querySelector('#expTargetsTable tbody');
  tbody.innerHTML = '';

  let sumTarget = 0;
  EXPOSURES.forEach(e => {
    const cur = exposureTotal(e);
    const curPct = total ? cur / total : 0;
    const tgt = state.expTargets[e] ?? 0;
    sumTarget += tgt;
    const tgtAmt = total * tgt;
    const diff = tgtAmt - cur;
    const signal = !total ? { txt: '—', cls: 'dash' }
      : Math.abs(curPct - tgt) < 0.01 ? { txt: '적정', cls: 'ok' }
      : curPct < tgt ? { txt: '비중 확대', cls: 'buy' }
      : { txt: '비중 축소', cls: 'sell' };

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><span class="badge ${EXPOSURE_CLS[e]}">${e}</span></td>
      <td class="right">${fmtKRW(cur)}</td>
      <td class="right">${fmtPct(curPct)}</td>
      <td class="right">
        <input class="inp right target" type="number" step="0.1" min="0" max="100"
               value="${(tgt * 100).toFixed(1)}" data-exp-target="${e}" style="width:70px;display:inline-block;" />%
      </td>
      <td class="right">${fmtKRW(tgtAmt)}</td>
      <td class="right" style="color:${diff > 0 ? 'var(--success)' : (diff < 0 ? 'var(--danger)' : 'var(--text-muted)')}">${diff !== 0 ? fmtKRW(diff) : '—'}</td>
      <td class="center"><span class="pill ${signal.cls}">${signal.txt}</span></td>
    `;
    tbody.appendChild(tr);
  });

  const sumRow = document.createElement('tr');
  sumRow.style.background = '#f8fafc';
  sumRow.style.fontWeight = '600';
  const sumOk = Math.abs(sumTarget - 1) < 0.001;
  sumRow.innerHTML = `
    <td>합계</td>
    <td class="right">${fmtKRW(total)}</td>
    <td class="right">100.0%</td>
    <td class="right" style="color:${sumOk ? 'var(--success)' : 'var(--danger)'}">${fmtPct(sumTarget)}</td>
    <td class="right">${fmtKRW(total)}</td>
    <td class="right">—</td>
    <td class="center"><span class="pill ${sumOk ? 'ok' : 'sell'}">${sumOk ? '✓ OK' : '100% 아님'}</span></td>
  `;
  tbody.appendChild(sumRow);

  tbody.querySelectorAll('[data-exp-target]').forEach(el => {
    el.addEventListener('change', ev => {
      const exp = ev.target.getAttribute('data-exp-target');
      const v = num(ev.target.value) / 100;
      state.expTargets[exp] = v;
      // 통화노출 '달러헤지' ↔ 자산타입 '금' 자동 연동 (역방향)
      if (exp === '달러헤지') state.assetTypeTargets['금'] = v;
      render();
    });
  });
}

// 이력 탭 렌더 — state.history의 스냅샷별 USD 자산을 CPI/M2 기준선과 비교해 실질 성과를 표와 상단 KPI로 표시.
// 스냅샷 생성은 data-io.js의 snapshot()(main.js가 window.snapshot으로 노출), 여기는 표시만 담당.
// 첫 스냅샷이 모든 누적 비교의 기준점. CPI 지수가 없으면 state.usCpiAnnual 연율 가정치로 근사.
// 이력이 없으면 빈 상태 안내와 함께 첫 스냅샷 버튼(인라인 onclick → window 노출 함수)을 보여준다.
// 행별 삭제·메모 버튼도 여기서 바인딩되며, 삭제 시 render()로 전체 갱신된다.
function renderHistory() {
  const tbody = document.getElementById('historyTbody');
  tbody.innerHTML = '';
  const box = document.getElementById('realReturnBox');

  // 입출금 기록이 1건 이상일 때만 순입금 컬럼·TWR 지표를 노출한다.
  // 기록이 없으면 이력 탭은 기능 추가 전과 완전히 동일하게 보인다 (💰 버튼만 존재).
  const hasFlows = (state.cashflows || []).length > 0;
  const flowTh = document.getElementById('thNetFlow');
  if (flowTh) flowTh.style.display = hasFlows ? '' : 'none';
  const twrCell = document.getElementById('m-twr-cell');
  if (twrCell) twrCell.style.display = hasFlows ? '' : 'none';

  if (state.history.length === 0) {
    tbody.innerHTML = `
      <tr><td colspan="${hasFlows ? 11 : 10}" style="text-align:center;color:var(--text-muted);padding:24px;">
        아직 저장된 이력이 없습니다. 🔄 전체 시세 갱신을 하면 자동으로 기록됩니다.<br />
        <button class="btn" style="margin-top:10px;" onclick="snapshot()">📸 지금 첫 스냅샷 찍기</button>
      </td></tr>`;
    if (box) box.style.display = 'none';
    return;
  }

  // 1단계 — 날짜순 정렬 후 첫 스냅샷을 기준점(base)으로 고정. 이후 모든 누적 비교의 분모가 된다.
  const sorted = [...state.history].sort((a, b) => a.date.localeCompare(b.date));
  const first = sorted[0];
  const baseUSD = first.totalUSD || 0;
  const baseCPI = first.cpiIndex || null;
  const fallbackRate = num(state.usCpiAnnual) || 0.035;

  const baseM2Val = first.m2 || null;
  const baseFX = first.fxRate || null;

  // 지정 일수(targetDays) 전에 가장 가까운 과거 스냅샷 찾기 (±toleranceDays 허용).
  // 30일 변화율(기본)과 YoY(365일±60일) 계산에 재사용된다. 범위 내 스냅샷이 없으면 null.
  function findClosestSnapshot(currentDate, currentIdx, targetDays = 30, toleranceDays = 10) {
    const currentDt = new Date(currentDate);
    const targetDate = new Date(currentDt.getTime() - targetDays * 86400000);
    let best = null, bestDiff = Infinity;
    for (let j = 0; j < currentIdx; j++) {
      const snapDt = new Date(sorted[j].date);
      const diffFromTarget = Math.abs((snapDt - targetDate) / 86400000);
      if (diffFromTarget < bestDiff && diffFromTarget <= toleranceDays) {
        bestDiff = diffFromTarget;
        const actualDaysAgo = Math.round((currentDt - snapDt) / 86400000);
        best = { snap: sorted[j], actualDaysAgo };
      }
    }
    return best;
  }

  // 이력 표 안의 작은 증감률 표시용 — 색상(양수 초록/음수 빨강) 입힌 부호 % HTML 조각 생성.
  // 전역 fmtSignedPct와 달리 소수 2자리이며 '30일전' 같은 보조 라벨을 붙일 수 있다.
  function fmtSignedPctSmall(p, label) {
    if (p === null || !isFinite(p)) return '—';
    const sign = p >= 0 ? '+' : '';
    const color = p > 0.0001 ? '#16a34a' : (p < -0.0001 ? '#dc2626' : 'var(--text-muted)');
    return `<span style="color:${color}">${sign}${(p*100).toFixed(2)}%</span>${label ? `<span style="color:var(--text-muted)">(${label})</span>` : ''}`;
  }

  // 2단계 — 스냅샷별 표 행 생성. 행마다 USD 자산(직전/30일경/누적 변화율),
  // TWR(실투자 수익률) 시계열 — 입출금(state.cashflows)을 제거한 구간별 성과 (calc.js).
  // 날짜로 바로 찾을 수 있게 맵으로 변환해 행 렌더에서 사용한다.
  const twrSeries = computeTWRSeries();
  const twrByDate = Object.fromEntries(twrSeries.map(t => [t.date, t]));

  // CPI·M2 기준선 대비 실질 갭, CPI/M2 지수(누적·YoY), 환율 변화를 계산해 채운다.
  sorted.forEach((s, i) => {
    const sUSD = s.totalUSD || 0;
    const prev = i > 0 ? sorted[i - 1] : null;
    const close30 = i > 0 ? findClosestSnapshot(s.date, i, 30, 10) : null;

    // USD 자산 변화량 3종
    const prevUSD = prev?.totalUSD || null;
    const usdPrevPct = (prevUSD && sUSD) ? (sUSD - prevUSD) / prevUSD : null;
    const prev30USD = close30?.snap?.totalUSD || null;
    const usd30Pct = (prev30USD && sUSD) ? (sUSD - prev30USD) / prev30USD : null;
    const usdCumPct = (baseUSD && sUSD) ? (sUSD - baseUSD) / baseUSD : null;

    // 환율 변화량
    const fxPrevPct = (prev?.fxRate && s.fxRate) ? (s.fxRate - prev.fxRate) / prev.fxRate : null;
    const fxCumPct = (baseFX && s.fxRate) ? (s.fxRate - baseFX) / baseFX : null;
    // CPI 기준선 — 첫 스냅샷 USD 자산이 물가만큼 불었다면 지금 얼마여야 하는가(USD).
    // 지수 데이터가 없으면 연율 가정치를 경과 연수만큼 복리 적용해 근사.
    let cpiBaseline;
    if (baseCPI && s.cpiIndex && baseUSD) {
      cpiBaseline = baseUSD * (s.cpiIndex / baseCPI);
    } else if (baseUSD) {
      const elapsed = (new Date(s.date) - new Date(first.date)) / (365.25 * 86400000);
      cpiBaseline = baseUSD * Math.pow(1 + fallbackRate, elapsed);
    } else {
      cpiBaseline = 0;
    }
    // M2 기준선 — 같은 논리를 통화공급(M2) 증가율로 적용. 데이터 없으면 null로 '—' 표시.
    let m2Baseline = null;
    if (baseM2Val && s.m2 && baseUSD) {
      m2Baseline = baseUSD * (s.m2 / baseM2Val);
    }
    const realDiffCPI = cpiBaseline > 0 ? (sUSD - cpiBaseline) / cpiBaseline : 0;
    const realDiffM2 = m2Baseline ? (sUSD - m2Baseline) / m2Baseline : null;

    // CPI / M2 누적 변화율 (첫 스냅샷 대비)
    const cpiCumPct = (baseCPI && s.cpiIndex) ? (s.cpiIndex / baseCPI) - 1 : null;
    const m2CumPct = (baseM2Val && s.m2) ? (s.m2 / baseM2Val) - 1 : null;
    // 전년 대비 (YoY)
    // 1순위: 스냅샷에 저장된 cpiYoYPct/m2YoYPct (BLS/FRED API에서 직접 가져온 값)
    //        → 사용자 이력 짧아도 정확
    // 2순위: 1년 전 스냅샷과 비교 (±60일 tolerance) → 1년 이상 이력 있을 때 fallback
    const yoy = i > 0 ? findClosestSnapshot(s.date, i, 365, 60) : null;
    const cpiYoYPct = (s.cpiYoYPct ?? null) !== null ? s.cpiYoYPct
      : ((yoy && yoy.snap.cpiIndex && s.cpiIndex) ? (s.cpiIndex / yoy.snap.cpiIndex) - 1 : null);
    const m2YoYPct = (s.m2YoYPct ?? null) !== null ? s.m2YoYPct
      : ((yoy && yoy.snap.m2 && s.m2) ? (s.m2 / yoy.snap.m2) - 1 : null);

    // USD 자산 셀: 절대값 + 직전/30일경/누적
    const usdCellContent = `
      ${fmtUSD(sUSD)}
      ${i === 0 ? '<div style="font-size:10px;color:var(--text-muted)">기준</div>' : `
        <div style="font-size:10px;line-height:1.4;">
          ${usdPrevPct !== null ? `<div title="직전 스냅샷 대비 USD 자산 변화율">직전 ${fmtSignedPctSmall(usdPrevPct)}</div>` : ''}
          ${usd30Pct !== null ? `<div title="약 30일 전 스냅샷 대비 USD 자산 변화율 (실제 ${close30.actualDaysAgo}일 전 데이터 사용)">30일경 ${fmtSignedPctSmall(usd30Pct, close30.actualDaysAgo+'일전')}</div>` : `<div style="color:#9ca3af" title="±10일 범위에 비교할 스냅샷 없음 (스냅샷이 너무 자주/드물게 찍힘)">30일경 —</div>`}
          ${usdCumPct !== null ? `<div title="첫 스냅샷 대비 누적 USD 자산 변화율">누적 ${fmtSignedPctSmall(usdCumPct)}</div>` : ''}
        </div>`}
    `;

    // 환율 셀: 절대값 + 직전/누적
    const fxCellContent = `
      ${s.fxRate ? s.fxRate.toFixed(2) : '—'}
      ${i === 0 ? '<div style="font-size:10px;color:var(--text-muted)">기준</div>' : `
        <div style="font-size:10px;line-height:1.4;">
          ${fxPrevPct !== null ? `<div title="직전 스냅샷 대비 환율 변화율 (양수=원화 약세)">직전 ${fmtSignedPctSmall(fxPrevPct)}</div>` : ''}
          ${fxCumPct !== null ? `<div title="첫 스냅샷 대비 누적 환율 변화율 (양수=원화 약세)">누적 ${fmtSignedPctSmall(fxCumPct)}</div>` : ''}
        </div>`}
    `;

    const tr = document.createElement('tr');
    const snapMemo = s.memo || '';
    const memoDotAttr = snapMemo
      ? `class="memo-dot has-memo" data-memo="${escapeHtml(snapMemo)}" title="메모 보기/편집"`
      : `class="memo-dot" data-memo="" title="메모 추가"`;
    const memoDotHtml = `<button ${memoDotAttr} data-snap-memo="${s.id}" data-snap-date="${s.date}" style="position:relative">${snapMemo ? '📝' : '+'}</button>`;
    // 순입금 셀 — 직전 스냅샷 이후 기록된 입출금 합계와 그 구간의 TWR(입출금 제거 수익률).
    const twr = twrByDate[s.date];
    const flowCellContent = i === 0
      ? '<span style="font-size:10px;color:var(--text-muted)">기준</span>'
      : `${twr && twr.flow ? `<span style="color:${twr.flow >= 0 ? '#16a34a' : '#dc2626'};font-variant-numeric:tabular-nums;">${twr.flow > 0 ? '+' : ''}${fmtKRWshort(twr.flow)}</span>` : '<span style="color:#9ca3af">—</span>'}
         ${twr ? `<div style="font-size:10px;color:var(--text-muted)" title="이 구간의 실투자 수익률 (입출금 효과 제거, KRW 기준)">TWR ${fmtSignedPctSmall(twr.r)}</div>` : ''}`;

    tr.innerHTML = `
      <td style="white-space:nowrap">${s.date}${memoDotHtml}</td>
      <td class="right">${usdCellContent}</td>
      ${hasFlows ? `<td class="right">${flowCellContent}</td>` : ''}
      <td class="right" style="color:#dc2626">${fmtUSD(cpiBaseline)}</td>
      <td class="right" style="color:#9333ea">${m2Baseline !== null ? fmtUSD(m2Baseline) : '—'}</td>
      <td class="right ${realDiffCPI > 0 ? 'mom-pos' : (realDiffCPI < 0 ? 'mom-neg' : '')}">${cpiBaseline > 0 ? fmtSignedPct(realDiffCPI) : '—'}</td>
      <td class="right ${realDiffM2 !== null && realDiffM2 > 0 ? 'mom-pos' : (realDiffM2 !== null && realDiffM2 < 0 ? 'mom-neg' : '')}">${realDiffM2 !== null ? fmtSignedPct(realDiffM2) : '—'}</td>
      <td class="right">${s.cpiIndex ? s.cpiIndex.toFixed(2) : '—'}${cpiCumPct !== null ? `<div style="font-size:10px;color:#dc2626;font-weight:500">${i === 0 ? '기준' : fmtSignedPct(cpiCumPct)}</div>` : (s.cpiLabel ? `<div style="font-size:10px;color:var(--text-muted)">${s.cpiLabel}</div>` : '')}${cpiYoYPct !== null ? `<div style="font-size:10px;color:#dc2626;opacity:0.8" title="전년 대비 (뉴스에서 보는 인플레이션율). ${yoy ? yoy.actualDaysAgo + '일 전 스냅샷 사용' : ''}">YoY ${fmtSignedPct(cpiYoYPct)}</div>` : ''}</td>
      <td class="right">${s.m2 ? s.m2.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',') : '—'}${m2CumPct !== null ? `<div style="font-size:10px;color:#9333ea;font-weight:500">${i === 0 ? '기준' : fmtSignedPct(m2CumPct)}</div>` : (s.m2Label ? `<div style="font-size:10px;color:var(--text-muted)">${s.m2Label}</div>` : '')}${m2YoYPct !== null ? `<div style="font-size:10px;color:#9333ea;opacity:0.8" title="전년 대비 M2 통화공급 증가율">YoY ${fmtSignedPct(m2YoYPct)}</div>` : ''}</td>
      <td class="right">${fxCellContent}</td>
      <td class="center"><button class="icon-btn" data-del-snap="${s.id}" title="삭제">×</button></td>
    `;
    tbody.appendChild(tr);
  });

  // 3단계 — 상단 KPI 5칸(명목 수익률/CPI 인플레/M2 증가/실질 수익률 CPI·M2 기준) 갱신.
  // 첫↔마지막 스냅샷 비교로 계산하며, 실질 = 명목 - 인플레(단순 차감) 방식의 %p.
  if (box) {
    const last = sorted[sorted.length - 1];
    const lastUSD = last.totalUSD || 0;
    const baseM2Local = first.m2 || null;
    const nominalRet = baseUSD > 0 ? (lastUSD - baseUSD) / baseUSD : 0;
    let inflation;
    if (baseCPI && last.cpiIndex) {
      inflation = (last.cpiIndex / baseCPI) - 1;
    } else {
      const elapsed = (new Date(last.date) - new Date(first.date)) / (365.25 * 86400000);
      inflation = Math.pow(1 + fallbackRate, elapsed) - 1;
    }
    const m2Growth = (baseM2Local && last.m2) ? (last.m2 / baseM2Local) - 1 : null;
    const realRet = nominalRet - inflation;
    const m2Real = m2Growth !== null ? nominalRet - m2Growth : null;

    document.getElementById('m-nominal-return').textContent = fmtSignedPct(nominalRet);
    document.getElementById('m-nominal-return').style.color = nominalRet >= 0 ? 'var(--success)' : 'var(--danger)';
    document.getElementById('m-inflation').textContent = fmtSignedPct(inflation);
    document.getElementById('m-inflation').style.color = '#dc2626';
    document.getElementById('m-m2growth').textContent = m2Growth !== null ? fmtSignedPct(m2Growth) : '—';
    document.getElementById('m-m2growth').style.color = '#9333ea';
    document.getElementById('m-real-return').textContent = fmtSignedPct(realRet);
    document.getElementById('m-real-return').style.color = realRet >= 0 ? 'var(--success)' : 'var(--danger)';
    document.getElementById('m-m2-real').textContent = m2Real !== null ? fmtSignedPct(m2Real) : '—';
    document.getElementById('m-m2-real').style.color = m2Real !== null ? (m2Real >= 0 ? 'var(--success)' : 'var(--danger)') : '#9ca3af';
    // 누적 TWR — 입출금을 제거한 실투자 수익률 (KRW 기준). 스냅샷 2개부터 의미가 있다.
    const twrEl = document.getElementById('m-twr');
    if (twrEl && hasFlows) {
      const twrLast = twrSeries.length >= 2 ? twrSeries[twrSeries.length - 1].cum : null;
      twrEl.textContent = twrLast !== null ? fmtSignedPct(twrLast) : '—';
      twrEl.style.color = twrLast !== null ? (twrLast >= 0 ? 'var(--success)' : 'var(--danger)') : '#9ca3af';
    }
    // MDD·변동성 — 스냅샷 이력만으로 계산되는 참고용 리스크 지표 (calc.js computeRiskStats).
    const risk = computeRiskStats();
    const mddEl = document.getElementById('m-mdd');
    if (mddEl) {
      mddEl.textContent = risk ? '-' + (risk.mdd * 100).toFixed(1) + '%' : '—';
      mddEl.style.color = risk && risk.mdd > 0 ? 'var(--danger)' : '#9ca3af';
    }
    const volEl = document.getElementById('m-vol');
    if (volEl) {
      volEl.textContent = risk && risk.vol !== null ? (risk.vol * 100).toFixed(1) + '%' : '—';
      volEl.style.color = risk && risk.vol !== null ? '#64748b' : '#9ca3af';
    }
    box.style.display = 'grid';
    // 셀 수가 상황에 따라 달라(TWR 숨김 등) 고정 컬럼 수 대신 auto-fit 으로 자연 배치한다.
    box.style.gridTemplateColumns = 'repeat(auto-fit, minmax(130px, 1fr))';
  }

  // 4단계 — 행별 삭제/메모 버튼 바인딩. 삭제는 즉시 state.history에서 제거 후 render().
  // 메모는 state.js의 openMemoModal('snapshot', ...)로 편집 모달을 연다.
  tbody.querySelectorAll('[data-del-snap]').forEach(btn => {
    btn.addEventListener('click', e => {
      const id = e.target.getAttribute('data-del-snap');
      state.history = state.history.filter(h => h.id !== id);
      render();
    });
  });
  tbody.querySelectorAll('[data-snap-memo]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const id = btn.getAttribute('data-snap-memo');
      const date = btn.getAttribute('data-snap-date');
      openMemoModal('snapshot', id, date + ' 스냅샷');
    });
  });
}

