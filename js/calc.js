// calc.js — 금액 계산 엔진. 보유 항목(state.holdings)의 KRW/USD 평가액 산출과
// 축별(카테고리·자산타입·통화노출·유동성) 합계, 합계 교차 검산, View Scope(전체/유동만) 필터,
// 평가손익(P&L) 계산, 한국 세법 기준 양도세 추정까지 모든 수치 계산을 담당한다.
// 주요 함수 그룹 — 파싱/포맷(num·fmtNumInput·fmtUSD), 평가액(holdingValue·holdingValueUSD),
// 축별 합계(categoryTotal·exposureTotal·assetTypeTotal·liquidityTotal·grandTotal),
// 검산(verifyTotals·renderVerifyResult), View Scope(scoped 계열·setViewScope),
// P&L(holdingPnL), 세금(TAX_RULES·computeTaxByCategory), debounce 헬퍼.
// 로드 순서 constants→state→calc→render→charts→data-io→fetch→sync→main 중 3번째.
// constants.js(CATEGORY_MAP·CATEGORIES 등)와 state.js(state·saveState)에 의존하고,
// render.js·charts.js·data-io.js·fetch.js가 이 파일의 집계 함수를 두루 호출한다.
// ==================== 계산 함수 ====================
// 콤마·공백 섞인 사용자 입력 문자열을 숫자로 변환한다.
// 빈값·null·파싱 실패를 전부 0으로 수렴시켜 이후 합산 로직이 NaN 없이 돌게 하는 안전판.
// 이 파일의 모든 집계 함수와 fetch.js의 시세 파싱이 공유하는 기본 파서.
function num(v) {
  if (v === null || v === undefined || v === '') return 0;
  const cleaned = String(v).replace(/,/g, '').trim();
  const n = Number(cleaned);
  return isFinite(n) ? n : 0;
}

// 입력창 표시용 천단위 콤마 포맷. num()의 역방향으로, 저장된 숫자 문자열을
// 사람이 읽기 좋은 "1,234,567.89" 형태로 되돌려 input 요소에 표시할 때 쓴다.
// 사용자가 타이핑 중인 소수점("1234.")도 그대로 보존해 입력 흐름을 끊지 않는다.
function fmtNumInput(v) {
  // 빈값이나 "-" 단독 입력은 아직 타이핑 중인 상태이므로 훼손하지 않고 그대로 돌려준다.
  if (v === '' || v === null || v === undefined) return '';
  const cleaned = String(v).replace(/,/g, '').trim();
  if (cleaned === '' || cleaned === '-') return cleaned;
  const n = Number(cleaned);
  if (!isFinite(n)) return String(v);
  // 소수점이 있으면 정수부만 콤마 포맷하고 소수부는 입력한 그대로 이어붙인다.
  const dotIdx = cleaned.indexOf('.');
  if (dotIdx >= 0) {
    const intPart = cleaned.slice(0, dotIdx).replace(/^-/, '');
    const decPart = cleaned.slice(dotIdx);
    const sign = cleaned.startsWith('-') ? '-' : '';
    return sign + Number(intPart).toLocaleString('en-US') + decPart;
  }
  return n.toLocaleString('en-US');
}

// 보유 항목 1건의 KRW 평가액을 계산하는 단일 기준 함수. 모든 합계·차트·검산이 이 함수를 거친다.
// amountOnly 카테고리(현금·부동산 등)는 price 필드를 금액 그 자체로 해석하고,
// 통화노출이 '달러(노출)'면 그 금액을 USD로 보아 state.usdKrwRate를 곱해 KRW로 환산한다.
// isUSD 카테고리(해외주식)는 priceUSD가 있으면 수량×USD단가×환율, 그 외에는 수량×KRW단가.
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

// USD 기준 평가금액(수량×priceUSD). 해외주식 행·카테고리 헤더에 달러 금액을 병기할 때 쓴다.
// isUSD 카테고리가 아니면 0을 반환해 USD 합산에 영향을 주지 않는다.
function holdingValueUSD(h) {
  const cat = CATEGORY_MAP[h.category];
  if (cat && cat.isUSD) {
    return num(h.quantity) * num(h.priceUSD);
  }
  return 0;
}

// 특정 카테고리의 USD 평가액 합계. 해외주식처럼 isUSD인 카테고리의
// 섹션 헤더에 달러 합계를 병기하기 위해 render.js에서 호출한다.
function categoryTotalUSD(catKey) {
  return state.holdings
    .filter(h => h.category === catKey)
    .reduce((sum, h) => sum + holdingValueUSD(h), 0);
}

// USD 금액 표시 포맷. "$1,234.56" 형태(천단위 콤마·소수 최대 2자리)로 만들고,
// 음수는 "-$" 접두, 0이나 비정상값은 '$0'으로 통일해 표시 흔들림을 막는다.
function fmtUSD(n) {
  if (!isFinite(n) || n === 0) return '$0';
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  return sign + '$' + abs.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

// ==================== 부채(대출) 구분 ====================
// 부채는 자산이 아니므로 총자산·비중·검산 등 모든 자산 축 집계에서 제외하고,
// "순 자산 = 자산 − 부채" 표시(KPI)에만 쓴다. 잔액은 양수로 입력·저장된다.
// 부채 카테고리 항목인지 판정.
function isDebt(h) {
  return !!CATEGORY_MAP[h.category]?.isDebt;
}
// 부채를 제외한 자산 항목만 — 자산 축 집계(총자산·통화노출·자산타입·유동성·검산·트리맵)의 공통 모집단.
function assetHoldings() {
  return state.holdings.filter(h => !isDebt(h));
}
// 부채 총액 (양수 KRW). 순자산 계산과 KPI 부채 표시에 사용.
function debtTotal() {
  return state.holdings.filter(isDebt).reduce((sum, h) => sum + holdingValue(h), 0);
}

// 특정 카테고리(국내주식·현금 등)에 속한 보유분의 KRW 평가액 합계.
// 카테고리 섹션 헤더·카테고리 도넛 등 카테고리 축 집계가 모두 이 함수를 쓴다.
// 카테고리를 명시해 조회하므로 '부채'를 넘기면 부채 합계가 나온다 (자산 축 아님).
function categoryTotal(cat) {
  return state.holdings
    .filter(h => h.category === cat)
    .reduce((sum, h) => sum + holdingValue(h), 0);
}

// 통화노출('원화'/'달러(노출)')별 KRW 평가액 합계. 환노출 리밸런싱 계산과
// 스냅샷 기록(krw/usd 필드)의 원천 데이터가 된다.
function exposureTotal(exp) {
  return assetHoldings()
    .filter(h => h.exposure === exp)
    .reduce((sum, h) => sum + holdingValue(h), 0);
}

// 자산타입 결정 (단일 기준): 사용자 지정 우선 → 카테고리 고정타입 → 주식
// 모든 자산타입 집계(도넛/리밸런싱/트리맵/검산)가 이 함수를 공유해 화면 간 수치 불일치 방지
function assetTypeOf(h) {
  return h.assetType || CATEGORY_MAP[h.category]?.assetTypeFixed || '주식';
}

// 자산타입(주식·금·부동산 등) 기준 KRW 합계. 타입 판정을 assetTypeOf에 위임해
// 도넛·리밸런싱·트리맵·검산이 전부 같은 분류 기준을 공유하게 한다.
function assetTypeTotal(type) {
  return assetHoldings()
    .filter(h => assetTypeOf(h) === type)
    .reduce((sum, h) => sum + holdingValue(h), 0);
}

// 전체 보유 자산의 KRW 총합 (부채 제외). KPI 카드·스냅샷의 total 필드·검산 기준값으로 쓰이는 최상위 합계.
function grandTotal() {
  return assetHoldings().reduce((sum, h) => sum + holdingValue(h), 0);
}

// 유동성('liquid' 즉시 현금화 가능 / 'locked' 연금·청약 등 묶임) 기준 KRW 합계.
// 항목에 유동성 미지정 시 카테고리 기본값(DEFAULT_LIQUIDITY_BY_CAT)으로 판정한다.
function liquidityTotal(kind /* 'liquid' | 'locked' */) {
  return assetHoldings()
    .filter(h => (h.liquidity || DEFAULT_LIQUIDITY_BY_CAT[h.category] || 'liquid') === kind)
    .reduce((sum, h) => sum + holdingValue(h), 0);
}
// 항목 1건의 유동성 값을 확정한다. 사용자 지정 → 카테고리 기본값 → 'liquid' 순 폴백.
function holdingLiquidity(h) {
  return h.liquidity || DEFAULT_LIQUIDITY_BY_CAT[h.category] || 'liquid';
}

// ==================== 합계 검산 (중복·누락 체크) ====================
// 세 축(자산타입·통화노출·유동성)의 부분합이 각각 총자산과 일치하는지 교차 검산한다.
// 반환 객체에는 축별 breakdown과 합계, 미등록 값 때문에 어느 축에도 안 잡히는 orphan 목록,
// 1원(부동소수점 오차 허용치) 초과 차이를 담은 warnings, 최종 판정 ok가 담긴다.
// 순수 계산 함수이며 화면 표시는 renderVerifyResult()가 담당한다.
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

  // orphan 검사: 각 홀딩이 정의된 그룹에 실제로 매칭되는지 (부채는 자산 축 밖이라 제외)
  assetHoldings().forEach(h => {
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
// verifyTotals() 결과를 설정 탭의 #verifyResult 영역에 HTML 표로 렌더링한다.
// 축별 breakdown 표 3개(자산타입·통화노출·유동성)를 그리고, orphan·경고가 있으면
// 빨간 경고 박스, 전부 정상이면 초록 "일치" 박스를 붙인다.
// DOM 갱신만 하는 순수 표시 함수로 state는 변경하지 않는다.
function renderVerifyResult() {
  const box = document.getElementById('verifyResult');
  if (!box) return;
  const r = verifyTotals();
  const rows = [];
  // 부채가 있으면 순자산까지 같이 보여준다 (검산 축들은 전부 자산 기준).
  const _debt = debtTotal();
  rows.push(`<div style="font-weight:600;margin-bottom:6px;">총 자산: ${fmtKRW(r.total)}${_debt > 0 ? ` · 부채 ${fmtKRW(_debt)} · 순자산 ${fmtKRW(r.total - _debt)}` : ''}</div>`);

  // 자산타입 breakdown 표 — 금액 0인 타입은 행 생략, 합계 행은 총자산과의 차이를 색으로 표시.
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

  // 통화노출 breakdown 표 — 구조는 자산타입 표와 동일.
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

  // 유동성 breakdown 표 — 유동/묶임 두 행 고정.
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

  // orphan 홀딩·합계 차이 경고 박스, 이상 없으면 초록 확인 박스.
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
// state.viewScope가 'liquid'면 유동 자산만, 그 외('all')는 전체 holdings를 반환한다.
// 아래 scoped 계열 합계 함수들이 전부 이 필터를 공유해, 스코프 전환 시 대시보드가 일괄 전환된다.
function scopedHoldings() {
  if ((state.viewScope || 'all') === 'liquid') {
    return assetHoldings().filter(h => holdingLiquidity(h) === 'liquid');
  }
  return assetHoldings();
}
// View Scope를 적용한 총자산(KRW). 스코프 전환 시 대시보드 KPI가 이 값을 쓴다.
function scopedTotal() {
  return scopedHoldings().reduce((sum, h) => sum + holdingValue(h), 0);
}
// View Scope를 적용한 통화노출별 KRW 합계. 환노출 리밸런싱 표에서 사용한다.
function scopedExposureTotal(exp) {
  return scopedHoldings().filter(h => h.exposure === exp).reduce((sum, h) => sum + holdingValue(h), 0);
}
// View Scope를 적용한 자산타입별 KRW 합계. 도넛 차트·자산타입 리밸런싱 계산에서 사용한다.
function scopedAssetTypeTotal(type) {
  return scopedHoldings().filter(h => assetTypeOf(h) === type).reduce((sum, h) => sum + holdingValue(h), 0);
}
// View Scope를 적용한 카테고리별 KRW 합계. 스코프를 반영해야 하는 차트·표에서 사용한다.
function scopedCategoryTotal(cat) {
  return scopedHoldings().filter(h => h.category === cat).reduce((sum, h) => sum + holdingValue(h), 0);
}
// 현재 뷰가 '유동만' 모드인지 여부. 렌더 쪽에서 안내 문구·목표 비중 해석을 분기할 때 쓴다.
function isLiquidScope() {
  return (state.viewScope || 'all') === 'liquid';
}

// 스코프 토글 버튼 클릭 핸들러. 잘못된 값은 'all'로 정규화한 뒤
// state 저장(localStorage) → 대시보드·분석 두 탭의 토글 UI 동기화 → 전체 재렌더 순으로 반영한다.
function setViewScope(scope) {
  if (scope !== 'all' && scope !== 'liquid') scope = 'all';
  state.viewScope = scope;
  saveState();
  syncScopeToggleUI();
  render();
}
// 두 탭에 중복 배치된 스코프 토글 버튼의 활성(primary) 클래스와 힌트 문구를
// 현재 state.viewScope에 맞춰 동기화한다. DOM만 갱신하며 저장·재계산은 하지 않는다.
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

// ==================== 입출금(현금흐름) · TWR ====================
// state.cashflows: [{id, date:'YYYY-MM-DD', amount(KRW, 입금 +/출금 -), memo}] — data-io.js 모달이 기록.
// TWR(실투자 수익률)은 "총액 변화에서 내가 넣고 뺀 돈의 효과를 제거한 진짜 투자 성과"다.
// 스냅샷 구간마다 Modified Dietz 수익률을 구해 복리로 잇는다 (KRW·자산(total) 기준).

// (start, end] 구간의 순입금 합계 (KRW). 날짜 문자열 비교라 YYYY-MM-DD 형식 전제.
function netFlowBetween(startExclusive, endInclusive) {
  return (state.cashflows || []).reduce((sum, f) => {
    if (!f || !f.date) return sum;
    if (startExclusive && f.date <= startExclusive) return sum;
    if (f.date > endInclusive) return sum;
    return sum + num(f.amount);
  }, 0);
}

// 스냅샷 이력 기반 TWR 시계열 — [{date, flow, r, cum}] 배열 반환.
// flow: 직전 스냅샷 이후 순입금, r: 구간 수익률, cum: 첫 스냅샷 대비 누적 수익률(소수 비율).
// 구간 수익률 r = (V1 - V0 - F) / (V0 + F/2) — Modified Dietz, 입출금은 구간 중간 발생 가정.
// 분모가 0 이하인 구간(총액 0 등)은 성과 판단이 불가능하므로 r=0 으로 건너뛴다.
// 첫 스냅샷 당일 이전의 입출금은 기준 시점 밖이라 무시된다. 입출금 기록이 없으면
// KRW 명목 수익률과 같아진다 (기록할수록 정확해지는 구조).
function computeTWRSeries() {
  const snaps = [...state.history].sort((a, b) => a.date.localeCompare(b.date));
  if (snaps.length === 0) return [];
  const out = [{ date: snaps[0].date, flow: 0, r: 0, cum: 0 }];
  let acc = 1;
  for (let i = 1; i < snaps.length; i++) {
    const v0 = snaps[i - 1].total || 0;
    const v1 = snaps[i].total || 0;
    const flow = netFlowBetween(snaps[i - 1].date, snaps[i].date);
    const denom = v0 + flow / 2;
    const r = denom > 0 ? (v1 - v0 - flow) / denom : 0;
    acc *= 1 + r;
    out.push({ date: snaps[i].date, flow, r, cum: acc - 1 });
  }
  return out;
}

// ==================== Debounce 헬퍼 ====================
// 무거운 작업(차트 destroy/recreate 등)을 키스트로크마다 실행하지 않고
// 마지막 호출 후 wait ms가 지나야 한 번만 실행되도록 감싸는 범용 debounce.
// 반환 함수에 flush(대기 중 작업 즉시 실행)·cancel(대기 취소)을 붙여
// 탭 전환처럼 즉시 반영이 필요한 순간에도 대응할 수 있게 했다.
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

// 수량·단가 입력 중 무거운 렌더 4종(차트·리밸런싱 2종·세금 분석)의 재생성을 200ms로 묶는다.
// render.js의 입력 핸들러가 키스트로크마다 호출해도 실제 재생성은 입력이 멈춘 뒤 1회만 일어난다.
const _debouncedChartRefresh = debounce(() => {
  renderCharts();
  renderRebalancing();
  renderRebalancingExposure();
  renderTaxAnalysis();
}, 200);

// ==================== P&L (평가손익) 계산 ====================
// 항목 1건의 평가손익. 평단가(avgPrice/avgPriceUSD)가 입력된 종목만 계산하고,
// amountOnly(현금·부동산)이거나 수량·단가가 없으면 null을 반환해 표시 대상에서 제외한다.
// 해외주식은 USD 단가끼리 비교한 뒤 환율(미갱신 시 1380 가정)로 KRW 환산한다.
// 반환값 { pnl: 손익 KRW, pct: 원가 대비 수익률(소수 비율), costKRW: 원가, curKRW: 평가액 }.
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
  '부채':         null,
};

// 카테고리별 평가금액·평가손익을 합산해 전량 매도를 가정한 예상 세금을 추정한다.
// 손익통산 방식 — 같은 카테고리 내 종목들의 손익을 전부 더한 뒤 기본공제를 빼서 과표를 만든다.
// TAX_RULES가 null인 현금·부동산은 건너뛰고, 평가액도 손익도 없는 카테고리는 결과에서 제외.
// 반환 배열의 각 원소는 { value, pnl, cost, deduction, taxableBase, tax, afterTax, rule … } 구조로
// 세금 분석 화면(renderTaxAnalysis)이 표를 그릴 때 그대로 사용한다.
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

