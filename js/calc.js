// 금액 계산 — 합계·검산·View Scope·P&L·세금 추정
// ==================== 계산 함수 ====================
function num(v) {
  if (v === null || v === undefined || v === '') return 0;
  const cleaned = String(v).replace(/,/g, '').trim();
  const n = Number(cleaned);
  return isFinite(n) ? n : 0;
}

function fmtNumInput(v) {
  // Format number with commas for input display, preserving decimals
  if (v === '' || v === null || v === undefined) return '';
  const cleaned = String(v).replace(/,/g, '').trim();
  if (cleaned === '' || cleaned === '-') return cleaned;
  const n = Number(cleaned);
  if (!isFinite(n)) return String(v);
  // Preserve decimal portion if user typed it
  const dotIdx = cleaned.indexOf('.');
  if (dotIdx >= 0) {
    const intPart = cleaned.slice(0, dotIdx).replace(/^-/, '');
    const decPart = cleaned.slice(dotIdx);
    const sign = cleaned.startsWith('-') ? '-' : '';
    return sign + Number(intPart).toLocaleString('en-US') + decPart;
  }
  return n.toLocaleString('en-US');
}

function holdingValue(h) {
  const cat = CATEGORY_MAP[h.category];
  if (cat && cat.amountOnly) {
    // amount-only: price field = 직접 입력 금액
    // 통화노출이 '달러(노출)'면 USD 금액으로 간주 → 환율 적용해 KRW 환산
    const amount = num(h.price);
    if (h.exposure === '달러(노출)') {
      return amount * num(state.usdKrwRate || 0);
    }
    return amount;
  }
  // 해외주식: priceUSD 우선 (입력되어 있으면)
  if (cat && cat.isUSD && num(h.priceUSD) > 0) {
    const rate = num(state.usdKrwRate || 0);
    return num(h.quantity) * num(h.priceUSD) * rate;
  }
  return num(h.quantity) * num(h.price);
}

// USD 기준 평가금액 (해외주식 표시용)
function holdingValueUSD(h) {
  const cat = CATEGORY_MAP[h.category];
  if (cat && cat.isUSD) {
    return num(h.quantity) * num(h.priceUSD);
  }
  return 0;
}

// 카테고리 USD 합계 (해외주식 같은 isUSD 카테고리용)
function categoryTotalUSD(catKey) {
  return state.holdings
    .filter(h => h.category === catKey)
    .reduce((sum, h) => sum + holdingValueUSD(h), 0);
}

function fmtUSD(n) {
  if (!isFinite(n) || n === 0) return '$0';
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  return sign + '$' + abs.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function categoryTotal(cat) {
  return state.holdings
    .filter(h => h.category === cat)
    .reduce((sum, h) => sum + holdingValue(h), 0);
}

function exposureTotal(exp) {
  return state.holdings
    .filter(h => h.exposure === exp)
    .reduce((sum, h) => sum + holdingValue(h), 0);
}

// 자산타입 결정 (단일 기준): 사용자 지정 우선 → 카테고리 고정타입 → 주식
// 모든 자산타입 집계(도넛/리밸런싱/트리맵/검산)가 이 함수를 공유해 화면 간 수치 불일치 방지
function assetTypeOf(h) {
  return h.assetType || CATEGORY_MAP[h.category]?.assetTypeFixed || '주식';
}

// 자산타입(주식/원자재) 기준 합계
function assetTypeTotal(type) {
  return state.holdings
    .filter(h => assetTypeOf(h) === type)
    .reduce((sum, h) => sum + holdingValue(h), 0);
}

function grandTotal() {
  return state.holdings.reduce((sum, h) => sum + holdingValue(h), 0);
}

// 유동성 기준 합계
function liquidityTotal(kind /* 'liquid' | 'locked' */) {
  return state.holdings
    .filter(h => (h.liquidity || DEFAULT_LIQUIDITY_BY_CAT[h.category] || 'liquid') === kind)
    .reduce((sum, h) => sum + holdingValue(h), 0);
}
function holdingLiquidity(h) {
  return h.liquidity || DEFAULT_LIQUIDITY_BY_CAT[h.category] || 'liquid';
}

// ==================== 합계 검산 (중복·누락 체크) ====================
// 자산타입 합계·통화노출 합계·유동성 합계가 총자산과 일치하는지, 어디에도 안 잡히는 orphan이 있는지 확인
function verifyTotals() {
  const total = grandTotal();
  const r = {
    total,
    assetType: {}, assetTypeSum: 0,
    exposure: {}, exposureSum: 0,
    liquid: liquidityTotal('liquid'),
    locked: liquidityTotal('locked'),
    liquiditySum: 0,
    orphans: [],   // 어느 축에서도 안 잡히는 홀딩
    warnings: [],  // 정합성 경고
  };
  ASSET_TYPES.forEach(t => { const v = assetTypeTotal(t); r.assetType[t] = v; r.assetTypeSum += v; });
  EXPOSURES.forEach(e => { const v = exposureTotal(e); r.exposure[e] = v; r.exposureSum += v; });
  r.liquiditySum = r.liquid + r.locked;

  // orphan 검사: 각 홀딩이 정의된 그룹에 실제로 매칭되는지
  state.holdings.forEach(h => {
    const v = holdingValue(h);
    if (v <= 0) return;
    const at = assetTypeOf(h);
    const missingAT = !ASSET_TYPES.includes(at);
    const missingExp = !EXPOSURES.includes(h.exposure);
    if (missingAT || missingExp) {
      r.orphans.push({
        id: h.id, name: h.name || '(무명)', value: v,
        assetType: at, missingAT,
        exposure: h.exposure || '(빈값)', missingExp,
      });
    }
  });

  // 소수점 오차 허용 임계값 1원
  const eps = 1;
  if (Math.abs(total - r.assetTypeSum) > eps) r.warnings.push(`자산타입 합계 차이: ${Math.round(total - r.assetTypeSum).toLocaleString()}원`);
  if (Math.abs(total - r.exposureSum) > eps) r.warnings.push(`통화노출 합계 차이: ${Math.round(total - r.exposureSum).toLocaleString()}원`);
  if (Math.abs(total - r.liquiditySum) > eps) r.warnings.push(`유동성 합계 차이: ${Math.round(total - r.liquiditySum).toLocaleString()}원`);
  r.ok = r.orphans.length === 0 && r.warnings.length === 0;
  return r;
}
function renderVerifyResult() {
  const box = document.getElementById('verifyResult');
  if (!box) return;
  const r = verifyTotals();
  const rows = [];
  rows.push(`<div style="font-weight:600;margin-bottom:6px;">총 자산: ${fmtKRW(r.total)}</div>`);

  // 자산타입 breakdown
  const atRows = ASSET_TYPES.map(t => {
    const v = r.assetType[t];
    if (v === 0) return null;
    return `<tr><td>${t}</td><td class="right">${fmtKRW(v)}</td><td class="right" style="color:var(--text-muted)">${r.total ? ((v/r.total)*100).toFixed(1) : '0.0'}%</td></tr>`;
  }).filter(Boolean).join('');
  const atDiff = r.total - r.assetTypeSum;
  const atSumCls = Math.abs(atDiff) <= 1 ? 'color:var(--success)' : 'color:var(--danger)';
  rows.push(`
    <table style="width:100%;margin-bottom:8px;font-size:12px;">
      <thead><tr style="background:#f8fafc;"><th style="text-align:left;padding:4px 8px;">자산타입</th><th class="right" style="padding:4px 8px;">금액</th><th class="right" style="padding:4px 8px;">비중</th></tr></thead>
      <tbody>${atRows}
        <tr style="background:#f8fafc;font-weight:600;"><td>합계</td><td class="right">${fmtKRW(r.assetTypeSum)}</td><td class="right" style="${atSumCls}">${Math.abs(atDiff) <= 1 ? '✓ 일치' : '차이 ' + fmtKRW(atDiff)}</td></tr>
      </tbody>
    </table>
  `);

  // 통화노출 breakdown
  const expRows = EXPOSURES.map(e => {
    const v = r.exposure[e];
    if (v === 0) return null;
    return `<tr><td>${e}</td><td class="right">${fmtKRW(v)}</td><td class="right" style="color:var(--text-muted)">${r.total ? ((v/r.total)*100).toFixed(1) : '0.0'}%</td></tr>`;
  }).filter(Boolean).join('');
  const expDiff = r.total - r.exposureSum;
  const expSumCls = Math.abs(expDiff) <= 1 ? 'color:var(--success)' : 'color:var(--danger)';
  rows.push(`
    <table style="width:100%;margin-bottom:8px;font-size:12px;">
      <thead><tr style="background:#f8fafc;"><th style="text-align:left;padding:4px 8px;">통화노출</th><th class="right" style="padding:4px 8px;">금액</th><th class="right" style="padding:4px 8px;">비중</th></tr></thead>
      <tbody>${expRows}
        <tr style="background:#f8fafc;font-weight:600;"><td>합계</td><td class="right">${fmtKRW(r.exposureSum)}</td><td class="right" style="${expSumCls}">${Math.abs(expDiff) <= 1 ? '✓ 일치' : '차이 ' + fmtKRW(expDiff)}</td></tr>
      </tbody>
    </table>
  `);

  // 유동성 breakdown
  const liqDiff = r.total - r.liquiditySum;
  const liqSumCls = Math.abs(liqDiff) <= 1 ? 'color:var(--success)' : 'color:var(--danger)';
  rows.push(`
    <table style="width:100%;margin-bottom:8px;font-size:12px;">
      <thead><tr style="background:#f8fafc;"><th style="text-align:left;padding:4px 8px;">유동성</th><th class="right" style="padding:4px 8px;">금액</th><th class="right" style="padding:4px 8px;">비중</th></tr></thead>
      <tbody>
        <tr><td>💧 유동</td><td class="right">${fmtKRW(r.liquid)}</td><td class="right" style="color:var(--text-muted)">${r.total ? ((r.liquid/r.total)*100).toFixed(1) : '0.0'}%</td></tr>
        <tr><td>🔒 묶임</td><td class="right">${fmtKRW(r.locked)}</td><td class="right" style="color:var(--text-muted)">${r.total ? ((r.locked/r.total)*100).toFixed(1) : '0.0'}%</td></tr>
        <tr style="background:#f8fafc;font-weight:600;"><td>합계</td><td class="right">${fmtKRW(r.liquiditySum)}</td><td class="right" style="${liqSumCls}">${Math.abs(liqDiff) <= 1 ? '✓ 일치' : '차이 ' + fmtKRW(liqDiff)}</td></tr>
      </tbody>
    </table>
  `);

  // orphans / warnings
  if (r.orphans.length > 0) {
    const orphanRows = r.orphans.map(o => `<tr>
      <td>${escapeHtml(o.name)}</td>
      <td class="right">${fmtKRW(o.value)}</td>
      <td>${o.missingAT ? `<span style="color:var(--danger)">자산타입 '${escapeHtml(o.assetType)}' 미등록</span>` : o.assetType}</td>
      <td>${o.missingExp ? `<span style="color:var(--danger)">통화노출 '${escapeHtml(o.exposure)}' 미등록</span>` : o.exposure}</td>
    </tr>`).join('');
    rows.push(`
      <div style="margin-top:12px;padding:10px;background:#fef2f2;border:1px solid #fca5a5;border-radius:8px;">
        <div style="color:#dc2626;font-weight:600;margin-bottom:6px;">⚠️ 어느 축에도 안 잡히는 홀딩 ${r.orphans.length}개</div>
        <table style="width:100%;font-size:12px;">
          <thead><tr><th style="text-align:left;">이름</th><th class="right">금액</th><th>자산타입</th><th>통화노출</th></tr></thead>
          <tbody>${orphanRows}</tbody>
        </table>
      </div>
    `);
  }
  if (r.warnings.length > 0) {
    rows.push(`<div style="margin-top:8px;padding:10px;background:#fef2f2;border:1px solid #fca5a5;border-radius:8px;color:#dc2626;">
      ${r.warnings.map(w => `⚠️ ${w}`).join('<br/>')}
    </div>`);
  }
  if (r.ok) {
    rows.push(`<div style="margin-top:8px;padding:10px;background:#f0fdf4;border:1px solid #86efac;border-radius:8px;color:#166534;">
      ✓ 모든 축에서 합계 일치. 중복·누락 없음.
    </div>`);
  }
  box.innerHTML = rows.join('');
}

// ==================== View Scope (전체 vs 유동만) ====================
// state.viewScope에 따라 계산 대상 holdings 필터링
function scopedHoldings() {
  if ((state.viewScope || 'all') === 'liquid') {
    return state.holdings.filter(h => holdingLiquidity(h) === 'liquid');
  }
  return state.holdings;
}
function scopedTotal() {
  return scopedHoldings().reduce((sum, h) => sum + holdingValue(h), 0);
}
function scopedExposureTotal(exp) {
  return scopedHoldings().filter(h => h.exposure === exp).reduce((sum, h) => sum + holdingValue(h), 0);
}
function scopedAssetTypeTotal(type) {
  return scopedHoldings().filter(h => assetTypeOf(h) === type).reduce((sum, h) => sum + holdingValue(h), 0);
}
function scopedCategoryTotal(cat) {
  return scopedHoldings().filter(h => h.category === cat).reduce((sum, h) => sum + holdingValue(h), 0);
}
function isLiquidScope() {
  return (state.viewScope || 'all') === 'liquid';
}

// 토글 핸들러 — 대시보드/분석 탭 두 군데 버튼 모두 동기화
function setViewScope(scope) {
  if (scope !== 'all' && scope !== 'liquid') scope = 'all';
  state.viewScope = scope;
  saveState();
  syncScopeToggleUI();
  render();
}
function syncScopeToggleUI() {
  const scope = state.viewScope || 'all';
  ['scopeAllBtn', 'scopeAllBtn2'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('primary', scope === 'all');
  });
  ['scopeLiquidBtn', 'scopeLiquidBtn2'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('primary', scope === 'liquid');
  });
  const hintText = scope === 'liquid'
    ? '💧 유동 자산만 — 즉시 매매·리밸런싱 가능한 자산 기준 (목표 비중도 유동 기준으로 해석)'
    : '전체 자산 기준 — 부동산·연금·청약 등 묶인 자산 모두 포함';
  ['scopeHint', 'scopeHint2'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = hintText;
  });
}

// ==================== Debounce 헬퍼 ====================
// 무거운 작업(차트 destroy/recreate 등)을 키스트로크마다 실행하지 않고
// 입력 끝난 뒤 한번만 실행되도록.
function debounce(fn, wait = 200) {
  let t = null;
  const debounced = (...args) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => { t = null; fn(...args); }, wait);
  };
  debounced.flush = () => { if (t) { clearTimeout(t); t = null; fn(); } };
  debounced.cancel = () => { if (t) { clearTimeout(t); t = null; } };
  return debounced;
}

// 입력 중에는 무거운 차트 재생성을 200ms debounce
const _debouncedChartRefresh = debounce(() => {
  renderCharts();
  renderRebalancing();
  renderRebalancingExposure();
  renderTaxAnalysis();
}, 200);

// ==================== P&L (평가손익) 계산 ====================
// 평단가가 입력된 종목만 손익 계산. 계산 불가 시 null 반환.
function holdingPnL(h) {
  const cat = CATEGORY_MAP[h.category];
  if (!cat) return null;
  // 현금/부동산은 손익 계산 제외 (평단가 개념 없음)
  if (cat.amountOnly) return null;
  const qty = num(h.quantity);
  if (qty <= 0) return null;
  const rate = num(state.usdKrwRate || 0) || 1380;

  let curKRW, costKRW;
  if (cat.isUSD) {
    // 해외주식: USD 단위로 평단/현재가 비교 후 KRW 환산
    const cur = num(h.priceUSD);
    const avg = num(h.avgPriceUSD);
    if (cur <= 0 || avg <= 0) return null;
    curKRW = qty * cur * rate;
    costKRW = qty * avg * rate;
  } else {
    const cur = num(h.price);
    const avg = num(h.avgPrice);
    if (cur <= 0 || avg <= 0) return null;
    curKRW = qty * cur;
    costKRW = qty * avg;
  }
  const pnl = curKRW - costKRW;
  const pct = costKRW > 0 ? pnl / costKRW : 0;
  return { pnl, pct, costKRW, curKRW };
}

// ==================== 세금 (양도세/공제/손익통산) ====================
// 한국 세법 기준 (2026년 시행 개인 양도소득세):
// - 국내주식: 비과세 (대주주 아닌 일반인 / 채권형 ETF 제외)
// - 해외주식: 22% (250만원 기본공제, 손익통산 가능)
// - 암호화폐: 22% (250만원 기본공제)
// - 금 (KRX 금현물 등): 22% (양도소득)
// - ISA: 비과세 (200만원/400만원 한도 내 수익 비과세 가정)
// - 연금저축펀드/퇴직연금: 비과세 (인출 시 연금소득세 별도)
// - 현금/부동산: 분석 제외 (부동산은 별도 양도소득세)

const TAX_RULES = {
  '국내주식':     { rate: 0.00, deduction: 0,         label: '비과세 (일반)' },
  '해외주식':     { rate: 0.22, deduction: 2_500_000, label: '22% (250만 공제)' },
  '암호화폐':     { rate: 0.22, deduction: 2_500_000, label: '22% (250만 공제)' },
  '금':           { rate: 0.00, deduction: 0,         label: '비과세 (KRX 금현물)' },
  'ISA':          { rate: 0.00, deduction: 0,         label: '비과세' },
  '연금저축펀드': { rate: 0.00, deduction: 0,         label: '비과세 (인출 시 별도)' },
  '퇴직연금':     { rate: 0.00, deduction: 0,         label: '비과세 (인출 시 별도)' },
  '현금':         null,
  '부동산':       null,
};

// 카테고리별 평가금액·평가손익을 합산해 세금 계산
// 손익통산: 같은 카테고리 내 종목들의 손익을 모두 더한 뒤 기본공제 적용
function computeTaxByCategory() {
  const result = [];
  CATEGORIES.forEach(cat => {
    const rule = TAX_RULES[cat.key];
    if (!rule) return; // 현금/부동산 제외

    const items = state.holdings.filter(h => h.category === cat.key);
    let totalValue = 0;
    let totalPnL = 0;
    let totalCost = 0;
    let totalEvalForPnL = 0; // 평단가 입력된 종목의 현재 평가액 (원가와 같은 종목 집합)
    let hasPnL = false;
    items.forEach(h => {
      totalValue += holdingValue(h);
      const p = holdingPnL(h);
      if (p) { totalPnL += p.pnl; totalCost += p.costKRW; totalEvalForPnL += p.curKRW; hasPnL = true; }
    });
    if (totalValue <= 0 && !hasPnL) return;

    // 손익통산 후 기본공제 → 과표
    const taxableBase = Math.max(0, totalPnL - rule.deduction);
    const tax = taxableBase * rule.rate;
    const afterTax = totalValue - tax;
    result.push({
      category: cat.key,
      cls: cat.cls,
      value: totalValue,
      pnl: totalPnL,
      cost: totalCost,
      evalForPnL: totalEvalForPnL,
      hasPnL,
      deduction: hasPnL && totalPnL > 0 ? Math.min(rule.deduction, totalPnL) : 0,
      taxableBase,
      tax,
      afterTax,
      rule,
    });
  });
  return result;
}

