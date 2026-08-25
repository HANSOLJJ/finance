// 화면 렌더링 — 탭·포맷터·대시보드/분석/이력/설정 탭 그리기
// ==================== 탭 네비게이션 ====================
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
function fmtKRW(n) {
  if (!isFinite(n) || n === 0) return '₩0';
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(Math.round(n));
  return sign + '₩' + abs.toLocaleString('ko-KR');
}

function fmtKRWshort(n) {
  if (!isFinite(n)) return '0';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1e8) return sign + (abs / 1e8).toFixed(1) + '억';
  if (abs >= 1e4) return sign + Math.round(abs / 1e4).toLocaleString('ko-KR') + '만';
  return sign + Math.round(abs).toLocaleString('ko-KR');
}

function fmtPct(p) {
  if (!isFinite(p)) return '0.0%';
  return (p * 100).toFixed(1) + '%';
}

function fmtSignedPct(p) {
  if (!isFinite(p)) return '—';
  const v = (p * 100).toFixed(1);
  return (p >= 0 ? '+' : '') + v + '%';
}

// ==================== 렌더링 ====================
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
// 자산타입 5개(현금/주식/금/원자재/암호화폐) 단위로 현재-목표 차이를 금액으로 표시
// ±2%p 이상 차이는 강조
const REBAL_CORE_TYPES = ['현금', '주식', '금', '원자재', '암호화폐'];
const REBAL_THRESHOLD = 0.02;  // 2%p

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

// 통화노출 리밸런싱 카드 — 원화/달러(노출)/달러헤지 대상, 목표는 state.expTargets
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
// 매수 시점이 종목마다 다르고 입출금 추적 없으면 정확한 측정 불가능 → 제거
// 인플레 비교는 대시보드 KPI 카드 + 자산 이력 차트(실질 자산 라인)로 대체
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

  // 자산타입별 P&L 집계 (holdingPnL 사용 - 평단가 기반)
  const aggregate = {};  // { atype: { cost, current, count, withPnL } }
  state.holdings.forEach(h => {
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
function renderTaxAnalysis() {
  const summaryEl = document.getElementById('tax-summary');
  const tbody = document.querySelector('#taxTable tbody');
  if (!summaryEl || !tbody) return;
  const rows = computeTaxByCategory();

  // 합계
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
  // 합계 행
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

// ==================== 설정 탭 (백업 메타 + 환율/CPI 인풋) ====================
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
  const rateEl = document.getElementById('rateInput');
  if (rateEl && document.activeElement !== rateEl) {
    rateEl.value = num(state.usdKrwRate).toFixed(2);
    rateEl.onchange = (e) => {
      state.usdKrwRate = num(e.target.value);
      state.rateUpdatedAt = new Date().toISOString();
      state.rateSource = 'manual';
      saveState();
      render();
      updateFxBadge();
      toast(`💱 환율 수동 설정: ${state.usdKrwRate.toFixed(2)}`);
    };
  }
  const rateMeta = document.getElementById('rateMeta');
  if (rateMeta) {
    if (state.rateUpdatedAt) {
      const dt = new Date(state.rateUpdatedAt);
      rateMeta.textContent = `${dt.toLocaleString('ko-KR')} ${state.rateSource ? '(' + state.rateSource + ')' : ''}`;
    } else { rateMeta.textContent = '갱신 이력 없음'; }
  }
  const cpiEl = document.getElementById('cpiAnnualInput');
  if (cpiEl && document.activeElement !== cpiEl) {
    cpiEl.value = (num(state.usCpiAnnual) * 100).toFixed(1);
    cpiEl.onchange = (e) => {
      state.usCpiAnnual = num(e.target.value) / 100;
      saveState();
      render();
      toast(`CPI 연율 ${(state.usCpiAnnual*100).toFixed(1)}% 적용`);
    };
  }
}

function renderKPIs() {
  // 총자산 / 유동 / 묶임 카드는 항상 전체 기준 (사용자가 자기 총 자산을 항상 알아야 함)
  const total = grandTotal();
  const fxRate = num(state.usdKrwRate) || 1380;
  document.getElementById('kpi-total').textContent = fmtKRW(total);
  document.getElementById('kpi-total-usd').textContent = fmtUSD(total / fxRate);
  const totalHoldings = state.holdings.filter(h => holdingValue(h) > 0).length;
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

// 대시보드: 인플레 대비 실질 자산 KPI 카드
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

function renderHoldings() {
  const container = document.getElementById('holdingsContainer');
  container.innerHTML = '';

  CATEGORIES.forEach(c => {
    const sect = document.createElement('div');
    sect.className = 'cat-section' + (state.collapsed[c.key] ? ' collapsed' : '');

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

      // P&L 셀 빌더 (검색형/금 카테고리에서 공통 사용)
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

  container.querySelectorAll('input[data-field], select[data-field]').forEach(el => {
    el.addEventListener('input', onFieldChange);
    el.addEventListener('change', onFieldChange);
    if (el.getAttribute('data-numeric')) {
      el.addEventListener('blur', onNumericBlur);
      el.addEventListener('focus', onNumericFocus);
    }
  });
  container.querySelectorAll('[data-delete]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = e.target.getAttribute('data-delete');
      state.holdings = state.holdings.filter(h => h.id !== id);
      render();
    });
  });
  container.querySelectorAll('[data-refresh]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = e.currentTarget.getAttribute('data-refresh');
      await refreshHolding(id);
    });
  });
  container.querySelectorAll('[data-holding-memo]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      const name = btn.getAttribute('data-holding-memo');
      if (!name) return;
      openMemoModal('holding', name, name);
    });
  });
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
  // 검색 입력 핸들러 (IME 조합 중 검색 발사 방지)
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

function onNumericFocus(e) {
  // 편집 시 콤마 제거해서 raw 숫자만 보여주기
  const raw = String(e.target.value).replace(/,/g, '');
  e.target.value = raw;
  // 커서를 끝에 두기
  setTimeout(() => {
    try { e.target.setSelectionRange(raw.length, raw.length); } catch (_) {}
  }, 0);
}

function onNumericBlur(e) {
  // 포커스 나가면 콤마 자동 포맷
  const formatted = fmtNumInput(e.target.value);
  e.target.value = formatted;
}

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

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[m]));
}

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

function renderHistory() {
  const tbody = document.getElementById('historyTbody');
  tbody.innerHTML = '';
  const box = document.getElementById('realReturnBox');

  if (state.history.length === 0) {
    tbody.innerHTML = `
      <tr><td colspan="10" style="text-align:center;color:var(--text-muted);padding:24px;">
        아직 저장된 이력이 없습니다.<br />
        <button class="btn" style="margin-top:10px;" onclick="snapshot()">📸 지금 첫 스냅샷 찍기</button>
        <button class="btn" style="margin-top:10px;margin-left:6px;background:#fef3c7;border-color:#f59e0b;color:#78350f;" onclick="generateDummyHistory()">🧪 데모용 더미 데이터 (자산 + 12개월)</button>
      </td></tr>`;
    if (box) box.style.display = 'none';
    return;
  }

  const sorted = [...state.history].sort((a, b) => a.date.localeCompare(b.date));
  const first = sorted[0];
  const baseUSD = first.totalUSD || 0;
  const baseCPI = first.cpiIndex || null;
  const fallbackRate = num(state.usCpiAnnual) || 0.035;

  const baseM2Val = first.m2 || null;
  const baseFX = first.fxRate || null;

  // ±10일 허용 범위로 30일 전에 가장 가까운 스냅샷 찾기
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

  function fmtSignedPctSmall(p, label) {
    if (p === null || !isFinite(p)) return '—';
    const sign = p >= 0 ? '+' : '';
    const color = p > 0.0001 ? '#16a34a' : (p < -0.0001 ? '#dc2626' : 'var(--text-muted)');
    return `<span style="color:${color}">${sign}${(p*100).toFixed(2)}%</span>${label ? `<span style="color:var(--text-muted)">(${label})</span>` : ''}`;
  }

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
    // CPI 기준선
    let cpiBaseline;
    if (baseCPI && s.cpiIndex && baseUSD) {
      cpiBaseline = baseUSD * (s.cpiIndex / baseCPI);
    } else if (baseUSD) {
      const elapsed = (new Date(s.date) - new Date(first.date)) / (365.25 * 86400000);
      cpiBaseline = baseUSD * Math.pow(1 + fallbackRate, elapsed);
    } else {
      cpiBaseline = 0;
    }
    // M2 기준선
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
    tr.innerHTML = `
      <td style="white-space:nowrap">${s.date}${memoDotHtml}</td>
      <td class="right">${usdCellContent}</td>
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

  // 상단 KPI: 명목/CPI/M2/실질
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
    box.style.display = 'grid';
    box.style.gridTemplateColumns = 'repeat(5, 1fr)';
  }

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

