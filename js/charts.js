// Chart.js 차트와 종목별 트리맵 렌더링 담당 모듈.
// - 대시보드: 자산타입/통화노출 도넛 2종 (viewScope 유동/전체 반영, 값 단위 KRW).
// - 분석 탭: 현재 vs 목표 가로 막대 2종(% 단위), 종목별 트리맵(drill-down·flat·손익 히트맵).
// - 이력 탭: 총자산 라인 차트 (명목/실질 USD·CPI·M2 기준선·환율, 절대값/정규화 2모드).
// 로드 순서: constants → state → calc → render → [charts] → data-io → fetch → sync → main.
//   클래식 스크립트라 모듈 시스템 없이 전역 스코프를 공유한다.
// 의존: CDN 전역 Chart(Chart.js 4)와 chartjs-chart-treemap 플러그인(type:'treemap' 등록).
//   state.js 의 state 전역·saveState()·getHoldingMemo(), calc.js 의 합계·환산 함수(grandTotal 등),
//   render.js 의 포맷터(fmtKRWshort·fmtSignedPct·escapeHtml 등)를 그대로 호출한다.
// 호출부: render.js 의 렌더 함수들과 calc.js·fetch.js 가 renderCharts() 를 불러 전체 차트를 다시 그린다.
// ==================== 차트 ====================
// 생성된 Chart 인스턴스를 이름별로 보관하는 전역 맵 (assetType/exp/assetTypeBar/expBar/treemap/hist).
// Chart.js 는 같은 canvas 에 인스턴스를 중복 생성하면 에러가 나므로, 재렌더 전 반드시 여기서 destroy 한다.
let charts = {};

// 모든 차트를 destroy 후 재생성하는 메인 렌더 진입점 (도넛 2종·막대 2종·트리맵·이력 라인).
// 부분 업데이트 없이 항상 전체를 다시 만드는 단순 전략 — state 가 바뀔 때마다 render.js/calc.js/fetch.js 에서 호출된다.
// 이력 차트의 legend 가시성만은 renderCharts._histPrevVis 에 라벨 기준으로 저장해 재생성 후 복원 (모드 토글 시 유지 목적).
// 도넛/막대는 대시보드의 viewScope(유동만/전체)에 따라 calc.js 의 scoped* 계열 합계 함수로 전환된다.
function renderCharts() {
  // 이력 차트의 legend 보이기/숨기기 상태를 라벨 기준으로 저장 (모드 토글 시 보존)
  const histPrevVis = {};
  if (charts.hist) {
    charts.hist.data.datasets.forEach((ds, i) => {
      // label에서 ' (USD)' 접미사 제거하여 stable key 생성
      const key = (ds.label || '').replace(/\s*\(USD\)$/, '');
      histPrevVis[key] = charts.hist.isDatasetVisible(i);
    });
  }
  // 기존 인스턴스를 모두 파기해 canvas 를 비운다 (중복 생성 시 Chart.js 가 예외를 던짐).
  Object.values(charts).forEach(c => c?.destroy?.());
  charts = {};
  // 다음 차트 빌드에서 참조할 수 있게 클로저 스코프 변수로 노출
  renderCharts._histPrevVis = histPrevVis;

  const total = grandTotal();
  const scoped = isLiquidScope();
  // 도넛 차트는 viewScope 반영 (대시보드에 있어서). 유동 모드면 묶인 자산(🔒) 제외 합계 함수로 교체.
  const at_total_fn = scoped ? scopedAssetTypeTotal : assetTypeTotal;
  const exp_total_fn = scoped ? scopedExposureTotal : exposureTotal;

  // 자산타입 도넛 차트 — 현금만 원화/달러로 분할 (링 그래프 전용, 리밸런싱/트리맵은 5개 구조 유지)
  const _cashHolds = (scoped ? scopedHoldings() : state.holdings).filter(h => assetTypeOf(h) === '현금');
  let _cashKRW = 0, _cashUSD = 0;
  _cashHolds.forEach(h => {
    const v = holdingValue(h);
    if (h.exposure === '달러(노출)') _cashUSD += v; else _cashKRW += v;
  });
  const atData = [];
  ASSET_TYPES.forEach(t => {
    if (t === '현금') {
      // 최대한 비슷한 초록 계열, 명도만 다르게 하여 구별
      atData.push({ key: '현금(원화)', value: _cashKRW, color: '#16a34a' });
      atData.push({ key: '현금($)',   value: _cashUSD, color: '#2dd4bf' });
    } else {
      atData.push({ key: t, value: at_total_fn(t), color: ASSET_TYPE_COLORS[t] });
    }
  });
  const visibleAt = atData.filter(d => d.value > 0);
  charts.assetType = new Chart(document.getElementById('assetTypeChart'), {
    type: 'doughnut',
    data: {
      labels: visibleAt.length ? visibleAt.map(d => d.key) : ['데이터 없음'],
      datasets: [{
        data: visibleAt.length ? visibleAt.map(d => d.value) : [1],
        backgroundColor: visibleAt.length ? visibleAt.map(d => d.color) : ['#e2e8f0'],
        borderWidth: 2, borderColor: '#fff',
      }]
    },
    options: doughnutOpts(visibleAt.length > 0)
  });

  // 통화노출 도넛 차트 (3분할)
  const expData = EXPOSURES.map(e => ({ key: e, value: exp_total_fn(e), color: EXPOSURE_COLORS[e] }));
  const visibleExp = expData.filter(d => d.value > 0);
  charts.exp = new Chart(document.getElementById('exposureChart'), {
    type: 'doughnut',
    data: {
      labels: visibleExp.length ? visibleExp.map(d => d.key) : ['데이터 없음'],
      datasets: [{
        data: visibleExp.length ? visibleExp.map(d => d.value) : [1],
        backgroundColor: visibleExp.length ? visibleExp.map(d => d.color) : ['#e2e8f0'],
        borderWidth: 2, borderColor: '#fff',
      }]
    },
    options: doughnutOpts(visibleExp.length > 0)
  });

  // 자산타입 현재 vs 목표 막대 차트 (분석탭 - scope 반영)
  const barBase = scoped ? scopedTotal() : total;
  charts.assetTypeBar = new Chart(document.getElementById('assetTypeBarChart'), {
    type: 'bar',
    data: {
      labels: ASSET_TYPES,
      datasets: [
        {
          label: '현재 비중' + (scoped ? ' (유동)' : ''),
          data: ASSET_TYPES.map(t => barBase ? (at_total_fn(t) / barBase * 100) : 0),
          backgroundColor: '#2563eb', borderRadius: 4,
        },
        {
          label: '목표 비중',
          data: ASSET_TYPES.map(t => (state.assetTypeTargets[t] || 0) * 100),
          backgroundColor: '#cbd5e1', borderRadius: 4,
        }
      ]
    },
    options: barOpts()
  });

  // 통화노출 현재 vs 목표 막대 차트 (분석탭 - scope 반영)
  charts.expBar = new Chart(document.getElementById('expBarChart'), {
    type: 'bar',
    data: {
      labels: EXPOSURES,
      datasets: [
        {
          label: '현재 비중' + (scoped ? ' (유동)' : ''),
          data: EXPOSURES.map(e => barBase ? (exp_total_fn(e) / barBase * 100) : 0),
          backgroundColor: '#2563eb', borderRadius: 4,
        },
        {
          label: '목표 비중',
          data: EXPOSURES.map(e => (state.expTargets[e] || 0) * 100),
          backgroundColor: '#cbd5e1', borderRadius: 4,
        }
      ]
    },
    options: barOpts()
  });

  // 종목별 트리맵 (분석 탭)
  renderTreemap();

  // ==== 이력 라인 차트 (이력 탭) — state.history 스냅샷 배열 기반, 값 단위는 USD (환율 라인만 KRW/USD) ====
  const ctx6 = document.getElementById('historyChart');
  // 차트 모드 버튼 상태 동기화 (state 기준)
  {
    const mode0 = state.historyChartMode || 'absolute';
    const absBtn = document.getElementById('chartModeAbsBtn');
    const normBtn = document.getElementById('chartModeNormBtn');
    if (absBtn && normBtn) {
      absBtn.classList.toggle('primary', mode0 === 'absolute');
      normBtn.classList.toggle('primary', mode0 === 'normalized');
    }
  }
  const sorted = [...state.history].sort((a, b) => a.date.localeCompare(b.date));
  // 기준선 계산: 첫 스냅샷 totalUSD 에 CPI 또는 M2 증가율 적용.
  // cpiIndex/m2 는 fetch.js 가 스냅샷 저장 시 함께 기록한 지표. 없으면 연 CPI 추정치(state.usCpiAnnual, 기본 3.5%)로 대체.
  const first = sorted[0];
  const baseCPI = first?.cpiIndex || null;
  const baseM2 = first?.m2 || null;
  const baseFX = first?.fxRate || null;
  const baseUSD = first?.totalUSD || 0;
  const fallbackRate = num(state.usCpiAnnual) || 0.035;

  // 원본 절대값 라인 데이터 (전부 USD) ---
  // totalLine=명목 총자산, inflationLine=첫 스냅샷 금액을 CPI 만큼 불린 기준선(이걸 못 이기면 실질 손실),
  // m2Line=M2 통화량 증가 기준선, realUSDLine=명목 총자산을 CPI 로 디플레이트한 실질 구매력.
  const totalLine = sorted.map(s => s.totalUSD || null);
  const inflationLine = sorted.map(s => {
    if (baseCPI && s.cpiIndex && baseUSD) {
      return baseUSD * (s.cpiIndex / baseCPI);
    }
    if (!first || !baseUSD) return 0;
    const elapsedYears = (new Date(s.date) - new Date(first.date)) / (365.25 * 86400000);
    return baseUSD * Math.pow(1 + fallbackRate, elapsedYears);
  });
  const m2Line = sorted.map(s => {
    if (baseM2 && s.m2 && baseUSD) {
      return baseUSD * (s.m2 / baseM2);
    }
    return null;
  });
  const realUSDLine = sorted.map(s => {
    const sUSD = s.totalUSD || 0;
    if (!sUSD) return null;
    if (baseCPI && s.cpiIndex) {
      return sUSD * (baseCPI / s.cpiIndex);
    }
    if (!first) return sUSD;
    const elapsedYears = (new Date(s.date) - new Date(first.date)) / (365.25 * 86400000);
    return sUSD / Math.pow(1 + fallbackRate, elapsedYears);
  });
  // 환율 라인 (절대값)
  const fxLineAbs = sorted.map(s => s.fxRate || null);

  // 정규화 도우미: 첫 유효값 = 0% 기준으로 % 변화율 배열로 변환 ---
  // 단위가 다른 라인(USD vs KRW/USD 환율)을 한 축에서 성과 비교할 수 있게 하는 장치.
  const mode = state.historyChartMode || 'absolute';
  const toPct = (arr) => {
    const firstVal = arr.find(v => v !== null && v !== undefined && v > 0);
    if (!firstVal) return arr.map(() => null);
    return arr.map(v => (v === null || v === undefined) ? null : (v / firstVal - 1) * 100);
  };

  // 모드별 데이터 ---
  const isNorm = mode === 'normalized';
  const dataTotal     = isNorm ? toPct(totalLine)      : totalLine;
  const dataReal      = isNorm ? toPct(realUSDLine)    : realUSDLine;
  const dataInflation = isNorm ? toPct(inflationLine)  : inflationLine;
  const dataM2        = isNorm ? toPct(m2Line)         : m2Line;
  const dataFX        = isNorm ? toPct(fxLineAbs)      : fxLineAbs;  // 환율은 정규화 모드에서만 노출

  // 원본 절대값을 툴팁에서 보여주기 위해 보관 ---
  // 정규화 모드에서도 툴팁에 실제 금액(USD)/환율을 병기하려고 라벨 → {abs 배열, 단위} 맵을 옵션 빌더에 넘긴다.
  // _memos: 스냅샷별 메모 배열 (차트 툴팁 footer에서 사용)
  const snapMemos = sorted.map(s => s.memo || '');
  const rawMap = {
    '총자산 (명목 USD)': { abs: totalLine, unit: 'usd' },
    '실질 자산 (CPI 보정, 첫 스냅샷 구매력 기준)': { abs: realUSDLine, unit: 'usd' },
    '인플레이션 기준선 (CPI)': { abs: inflationLine, unit: 'usd' },
    'M2 통화공급 기준선': { abs: m2Line, unit: 'usd' },
    'USD/KRW 환율': { abs: fxLineAbs, unit: 'fx' },
    _memos: snapMemos,
  };

  // 이전 차트의 legend 상태 복원용 헬퍼 (라벨 ' (USD)' 접미사 제거하여 매칭)
  const prevVis = renderCharts._histPrevVis || {};
  const visFor = (label, defaultHidden) => {
    const key = label.replace(/\s*\(USD\)$/, '');
    if (Object.prototype.hasOwnProperty.call(prevVis, key)) {
      return !prevVis[key];  // 이전 상태 복원 (visible=true → hidden=false)
    }
    return defaultHidden;
  };

  const datasets = [
    {
      label: '총자산 (명목 USD)',
      data: dataTotal,
      borderColor: '#0f172a', backgroundColor: isNorm ? 'transparent' : 'rgba(15,23,42,0.06)',
      tension: 0.25, borderWidth: 3, fill: !isNorm,
      pointBackgroundColor: '#0f172a', pointRadius: 5,
      spanGaps: true,
      hidden: visFor('총자산 (명목 USD)', false),
    },
    {
      label: '실질 자산 (CPI 보정, 첫 스냅샷 구매력 기준)',
      data: dataReal,
      borderColor: '#14b8a6', backgroundColor: 'rgba(20,184,166,0.06)',
      tension: 0.25, borderWidth: 2, fill: false,
      pointBackgroundColor: '#14b8a6', pointRadius: 3,
      spanGaps: true,
      hidden: visFor('실질 자산 (CPI 보정, 첫 스냅샷 구매력 기준)', false),
    },
    {
      label: '인플레이션 기준선 (CPI)',
      data: dataInflation,
      borderColor: '#dc2626', backgroundColor: 'transparent',
      tension: 0.25, borderWidth: 2, borderDash: [6, 4], pointRadius: 3,
      pointBackgroundColor: '#dc2626',
      spanGaps: true,
      hidden: visFor('인플레이션 기준선 (CPI)', false),
    },
    {
      label: 'M2 통화공급 기준선',
      data: dataM2,
      borderColor: '#9333ea', backgroundColor: 'transparent',
      tension: 0.25, borderWidth: 2, borderDash: [3, 6], pointRadius: 3,
      pointBackgroundColor: '#9333ea',
      spanGaps: true,
      hidden: visFor('M2 통화공급 기준선', false),
    },
    {
      label: 'USD/KRW 환율',
      data: dataFX,
      borderColor: '#f97316', backgroundColor: 'transparent',
      tension: 0.25, borderWidth: 2, borderDash: [2, 4], pointRadius: 3,
      pointBackgroundColor: '#f97316',
      spanGaps: true,
      // 절대값 모드는 항상 숨김 (단위 불일치). 정규화 모드는 이전 상태 보존, 기본 visible
      hidden: !isNorm ? true : visFor('USD/KRW 환율', false),
    },
  ];

  // 이력 차트 생성. 옵션은 모드에 따라 정규화(%축)/절대값($축) 빌더를 선택한다.
  charts.hist = new Chart(ctx6, {
    type: 'line',
    data: { labels: sorted.map(s => s.date), datasets },
    options: isNorm ? normLineOpts(rawMap) : usdLineOpts(rawMap)
  });
}

// 이력 차트 모드 토글 ('absolute'=절대값 USD / 'normalized'=첫 스냅샷 대비 % 변화).
// index.html 의 모드 버튼 onclick 에서 호출된다. state 에 저장(saveState → 저장소 반영) 후
// 버튼 강조 클래스를 바꾸고 renderCharts() 로 전체 차트를 재생성한다 (이력 차트만 갱신하는 API 없음).
function setChartMode(mode) {
  state.historyChartMode = mode;
  saveState();
  // 버튼 스타일 토글
  const absBtn = document.getElementById('chartModeAbsBtn');
  const normBtn = document.getElementById('chartModeNormBtn');
  if (absBtn && normBtn) {
    absBtn.classList.toggle('primary', mode === 'absolute');
    normBtn.classList.toggle('primary', mode === 'normalized');
  }
  renderCharts();
}

// 절대값 모드 이력 라인 차트 옵션 (Y축 $ 축약 표시, 1000 이상은 k 단위).
// rawMap: 라벨 → {abs 배열, unit} 맵. 툴팁 label 에서 단위 분기(fx=KRW/USD, 그 외 USD)에,
// footer 에서 스냅샷 메모(_memos) 표시에 쓰인다. renderCharts 에서만 호출.
function usdLineOpts(rawMap) {
  return {
    responsive: true, maintainAspectRatio: false,
    plugins: {
      legend: { position: 'top', labels: { boxWidth: 12, font: { size: 11 } } },
      tooltip: {
        callbacks: {
          label: ctx => {
            const label = ctx.dataset.label;
            const val = ctx.parsed.y;
            const info = rawMap && rawMap[label];
            // 환율인 경우(현재는 절대값 모드에서 숨김이라 호출될 일 적음)
            if (info && info.unit === 'fx') {
              return label + ': ' + (val != null ? val.toFixed(2) + ' KRW/USD' : '—');
            }
            return label + ': ' + fmtUSD(val);
          },
          footer: ctx => {
            try {
              const idx = ctx && ctx[0] ? ctx[0].dataIndex : null;
              const memos = rawMap && rawMap._memos;
              const memo = (memos && idx != null) ? memos[idx] : '';
              if (!memo) return '';
              // 멀티라인은 array로 반환 (Chart.js가 줄별로 그려줌)
              return ['📝 ' + (memo.split(/\r?\n/)[0])].concat(memo.split(/\r?\n/).slice(1));
            } catch (e) { return ''; }
          }
        }
      }
    },
    scales: {
      y: {
        beginAtZero: false,
        ticks: {
          callback: v => '$' + (v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v.toFixed(0)),
          font: { size: 10 }
        },
        grid: { color: '#f1f5f9' }
      },
      x: {
        ticks: { font: { size: 10 } },
        grid: { display: false }
      }
    }
  };
}

// 정규화 모드 이력 라인 차트 옵션 (Y축 ± % 표시, 0% 그리드라인만 진하게 강조).
// 데이터는 이미 % 변화율로 변환돼 있으므로 툴팁에서 rawMap 의 abs 배열을 찾아
// 실제 금액(USD) 또는 환율(KRW/USD)을 괄호로 병기한다. footer 는 스냅샷 메모 표시. renderCharts 에서만 호출.
function normLineOpts(rawMap) {
  return {
    responsive: true, maintainAspectRatio: false,
    plugins: {
      legend: { position: 'top', labels: { boxWidth: 12, font: { size: 11 } } },
      tooltip: {
        callbacks: {
          label: ctx => {
            const label = ctx.dataset.label;
            const pct = ctx.parsed.y;
            const idx = ctx.dataIndex;
            const info = rawMap && rawMap[label];
            const abs = info && info.abs ? info.abs[idx] : null;
            const sign = pct >= 0 ? '+' : '';
            const pctStr = pct != null ? `${sign}${pct.toFixed(2)}%` : '—';
            if (info && info.unit === 'fx') {
              return `${label}: ${abs != null ? abs.toFixed(2) : '—'} KRW/USD (${pctStr})`;
            }
            if (abs != null) {
              return `${label}: ${pctStr} (${fmtUSD(abs)})`;
            }
            return `${label}: ${pctStr}`;
          },
          footer: ctx => {
            try {
              const idx = ctx && ctx[0] ? ctx[0].dataIndex : null;
              const memos = rawMap && rawMap._memos;
              const memo = (memos && idx != null) ? memos[idx] : '';
              if (!memo) return '';
              // 멀티라인은 array로 반환 (Chart.js가 줄별로 그려줌)
              return ['📝 ' + (memo.split(/\r?\n/)[0])].concat(memo.split(/\r?\n/).slice(1));
            } catch (e) { return ''; }
          }
        }
      },
      annotation: undefined
    },
    scales: {
      y: {
        beginAtZero: false,
        ticks: {
          callback: v => (v >= 0 ? '+' : '') + v.toFixed(1) + '%',
          font: { size: 10 }
        },
        grid: {
          color: (ctx) => ctx.tick.value === 0 ? '#94a3b8' : '#f1f5f9',
          lineWidth: (ctx) => ctx.tick.value === 0 ? 1.5 : 1
        }
      },
      x: {
        ticks: { font: { size: 10 } },
        grid: { display: false }
      }
    }
  };
}

// 도넛 차트 공통 옵션 빌더 (자산타입/통화노출 도넛이 공유).
// useTooltip=false 는 '데이터 없음' placeholder(회색 1조각) 렌더 시 툴팁 차단용,
// percentage=true 면 데이터 값을 비율(0~1)로 간주해 %만 표시 (합산 비중 계산 생략).
// 기본 툴팁은 KRW 축약 금액(fmtKRWshort) + 전체 대비 비중 % 를 함께 보여준다.
function doughnutOpts(useTooltip = true, percentage = false) {
  return {
    responsive: true, maintainAspectRatio: false,
    cutout: '62%',
    plugins: {
      legend: { position: 'bottom', labels: { boxWidth: 10, padding: 10, font: { size: 11 } } },
      tooltip: useTooltip ? {
        callbacks: {
          label: ctx => {
            if (percentage) {
              return ctx.label + ': ' + (ctx.parsed * 100).toFixed(1) + '%';
            }
            const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
            const pct = total ? (ctx.parsed / total * 100).toFixed(1) : 0;
            return ctx.label + ': ' + fmtKRWshort(ctx.parsed) + ' (' + pct + '%)';
          }
        }
      } : { enabled: false }
    }
  };
}

// 현재 vs 목표 비중 비교용 가로 막대 차트 공통 옵션 (indexAxis:'y' 로 눕힘, X축 % 단위).
// 분석 탭의 자산타입/통화노출 막대 차트 2개가 공유. 데이터가 이미 % 값이라 툴팁도 % 로만 표기.
function barOpts() {
  return {
    responsive: true, maintainAspectRatio: false,
    indexAxis: 'y',
    plugins: {
      legend: { position: 'top', labels: { boxWidth: 12, font: { size: 11 } } },
      tooltip: {
        callbacks: { label: ctx => ctx.dataset.label + ': ' + ctx.parsed.x.toFixed(1) + '%' }
      }
    },
    scales: {
      x: {
        beginAtZero: true,
        ticks: { callback: v => v + '%', font: { size: 10 } },
        grid: { color: '#f1f5f9' }
      },
      y: {
        ticks: { font: { size: 11 } },
        grid: { display: false }
      }
    }
  };
}

// KRW 기준 일반 라인 차트 공통 옵션 (Y축 원화 축약 표시) — USD/정규화 이력 차트는 별도 옵션 사용.
// 현재 호출처 없음 (이력 차트가 KRW 기준이던 시절의 잔재). 새 KRW 라인 차트 추가 시 재사용 가능해 유지.
function lineOpts() {
  return {
    responsive: true, maintainAspectRatio: false,
    plugins: {
      legend: { position: 'top', labels: { boxWidth: 12, font: { size: 11 } } },
      tooltip: {
        callbacks: { label: ctx => ctx.dataset.label + ': ' + fmtKRW(ctx.parsed.y) }
      }
    },
    scales: {
      y: {
        beginAtZero: false,
        ticks: { callback: v => fmtKRWshort(v), font: { size: 10 } },
        grid: { color: '#f1f5f9' }
      },
      x: {
        ticks: { font: { size: 10 } },
        grid: { display: false }
      }
    }
  };
}

// ==================== 종목별 트리맵 (drill-down 지원) ====================
// chartjs-chart-treemap 플러그인 사용
// _treemapDrill: null(전체 그룹 모드) 또는 '주식'/'암호화폐'/... (특정 자산타입 펼침)
// _treemapFlat: true이면 자산타입 그룹 없이 모든 종목 flat 표시 (drill보다 우선순위 낮음)
// _treemapHidden: 사용자가 레전드에서 토글로 숨긴 자산타입 Set
let _treemapDrill = null;
let _treemapFlat = false;
let _treemapHidden = new Set();
// _treemapHeat: true면 색상 = 손익률 히트맵 (Finviz 스타일). 모든 뷰 모드(테마별/flat/drill)에 적용.
// 같은 종목이 여러 계좌(카테고리)에 흩어져 있으면 _mergedPnL(Σ손익/Σ원금)의 통합 수익률 사용.
let _treemapHeat = false;

// 같은 종목(같은 ticker, 같은 자산타입)을 하나로 합치기 — 여러 계좌(연금/ISA/일반 등)에
// 흩어진 동일 종목을 트리맵에서 한 타일로 보여주기 위한 전처리.
// ticker 가 없으면 (현금/금/부동산 등) name + assetType 으로 매칭.
// 합치면서 통합 손익(_mergedPnL = Σ손익/Σ원금, KRW)과 표시용 이름들(_displayName/_shortName/_displayTicker)을 계산해 붙인다.
function mergeHoldingItems(rawItems) {
  const groups = new Map();
  for (const it of rawItems) {
    const key = ((it.ticker || it.symbol || it.name || '').trim().toLowerCase() || '__empty__')
      + '|' + it._atype;
    if (!groups.has(key)) {
      groups.set(key, {
        ...it,
        _value: 0,
        _mergedCount: 0,
        _mergedFrom: [],  // [{category, value, pnl, ...}]
      });
    }
    const g = groups.get(key);
    g._value += it._value;
    g._mergedCount += 1;
    const pnl = holdingPnL(it);
    g._mergedFrom.push({
      category: it.category,
      value: it._value,
      pnl: pnl ? pnl.pnl : null,
      cost: pnl ? pnl.costKRW : null,
    });
  }
  // 합쳐진 P&L 계산 (각 구성요소 손익 합산, 평단가 없는 건 제외).
  // 전부 평단가가 없으면 _mergedPnL=null → 히트맵에서 '평단가 없음' 회색으로 처리된다.
  for (const g of groups.values()) {
    let mergedPnL = 0, mergedCost = 0, hasAnyPnL = false;
    for (const f of g._mergedFrom) {
      if (f.pnl !== null && f.cost !== null) {
        mergedPnL += f.pnl;
        mergedCost += f.cost;
        hasAnyPnL = true;
      }
    }
    g._mergedPnL = hasAnyPnL ? { pnl: mergedPnL, cost: mergedCost, pct: mergedCost > 0 ? mergedPnL / mergedCost : 0 } : null;
    // 표시 티커:
    //   - 암호화폐: symbol (BTC, ETH 등) → 의미 있음
    //   - 해외주식: ticker (AAPL, MSFT 등) → 의미 있음
    //   - 국내주식/한국 ETF (연금/퇴직/ISA): 6자리 숫자라 헷갈리므로 표시 안 함
    const cat = CATEGORY_MAP[g.category];
    let dispTicker = '';
    if (cat?.isCrypto) {
      dispTicker = (g.symbol || g.ticker || '').toUpperCase();
    } else {
      const raw = (g.ticker || g.symbol || '').replace(/\.(KS|KQ)$/i, '');
      // 순수 숫자(국내 종목코드/ETF코드)는 숨김
      if (raw && !/^\d+$/.test(raw)) {
        dispTicker = raw;
      }
    }
    g._displayTicker = dispTicker;
    // 표시명: 종목명 + (티커, N계좌)
    const parts = [];
    if (dispTicker && dispTicker.toLowerCase() !== g._name.toLowerCase()) {
      parts.push(dispTicker);
    }
    if (g._mergedCount > 1) parts.push(g._mergedCount + '계좌');
    g._displayName = parts.length > 0 ? g._name + ' (' + parts.join(', ') + ')' : g._name;
    // 짧은 이름 (작은 사각형/flat 모드용):
    //   - 티커 있으면 티커 우선 (AAPL, BTC 등)
    //   - 한국 ETF처럼 티커 없으면 운용사 prefix 제거 후 핵심 지수명만
    //     예: "TIGER 미국나스닥100" → "미국나스닥100", "KODEX MSCI Korea TR" → "MSCI Korea TR"
    g._shortName = dispTicker || stripBrokerPrefix(g._name);
  }
  return [...groups.values()];
}

// 한국 ETF 종목명에서 운용사 prefix를 제거 → 핵심 지수명만 남김
// "TIGER 미국나스닥100" → "미국나스닥100"
// 운용사 정보 없으면 원본 그대로
function stripBrokerPrefix(name) {
  if (!name) return '';
  // 한국 주요 ETF 운용사 brand prefix (대소문자 무시)
  const re = /^(TIGER|KODEX|HANARO|SOL|ARIRANG|KBSTAR|ACE|PLUS|RISE|KOSEF|WOORI|HK\s+S&P|FOCUS|KIWOOM|SMART|HANSARANG)\s*/i;
  const stripped = name.replace(re, '').trim();
  // 다 제거되면 원본 사용 (운용사명만 입력된 케이스 방지)
  return stripped.length > 0 ? stripped : name;
}

// HSL → hex 변환 (h: 0~360도, s/l: 0~100%).
// drill 팔레트 생성 전용 내부 유틸 — hue 회전 계산은 HSL 공간에서 하고 Chart.js 에는 hex 로 넘기기 위함.
function _hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const k = n => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = n => {
    const v = l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return Math.round(v * 255).toString(16).padStart(2, '0');
  };
  return '#' + f(0) + f(8) + f(4);
}

// hex → HSL 역변환 ([h(0~360), s(0~100), l(0~100)] 배열 반환, 파싱 실패 시 중립 회색값).
// generateDrillPalette 가 자산타입 base 색상을 HSL 로 풀어 변주할 때 사용.
function _hexToHsl(hex) {
  const m = hex.replace('#', '').match(/.{2}/g);
  if (!m) return [0, 0, 50];
  const [r, g, b] = m.map(x => parseInt(x, 16) / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  let h = 0, s = 0; const l = (mx + mn) / 2;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    if (mx === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return [h, s * 100, l * 100];
}

// 자산타입 base 색상 주위로 다채로운 팔레트 생성 (count개 hex 배열 반환).
// hue 를 ±70도 회전, saturation/lightness 변동 — drill/단일 섹터 flat 뷰에서 같은 자산타입의
// 종목들이 단색으로 뭉개지지 않으면서도 그 자산타입 계열 색으로 읽히게 하려는 목적.
function generateDrillPalette(baseHex, count) {
  const [h0, s0, l0] = _hexToHsl(baseHex);
  if (count <= 1) return [baseHex];
  const palette = [];
  for (let i = 0; i < count; i++) {
    // hue: -70 ~ +70 도 사이 골고루 분산
    const hueOffset = (i / Math.max(1, count - 1) - 0.5) * 140;
    const h = (h0 + hueOffset + 360) % 360;
    // saturation/lightness 살짝 변동
    const sat = Math.max(45, Math.min(85, s0 + (i % 2 === 0 ? 5 : -5)));
    const lit = Math.max(40, Math.min(60, l0 + ((i % 3 - 1) * 4)));
    palette.push(_hslToHex(h, sat, lit));
  }
  return palette;
}

// 손익률 → 히트맵 색상 (Finviz 스타일 diverging: 빨강 ↔ 중립 회색 ↔ 초록)
// 비대칭 스케일: 손실은 -30%에서 최대 빨강 (그 이상 손실은 드묾),
// 수익은 2단계 — 0~+30% 회색→초록, +30%~+100% 초록→밝은 초록 (Finviz 컨벤션: 0%가 어두운 회색이므로 수익률 클수록 밝아짐).
// pct가 null(평단가 없음: 현금/부동산 등)이면 밝은 회색으로 구분.
const HEAT_CLAMP = 0.30;       // 손실 포화점 & 수익 1단계 경계
const HEAT_GREEN_MAX = 1.00;   // 수익 2단계 포화점 (+100% 이상 = 최심 초록)
function heatColor(pct) {
  if (pct === null || pct === undefined || !isFinite(pct)) return '#9ca3af';
  const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
  const neutral = [82, 82, 91];    // #52525b (0% 근처)
  let c;
  if (pct < 0) {
    c = mix(neutral, [185, 28, 28], Math.min(1, -pct / HEAT_CLAMP));   // → #b91c1c (-30% 이하)
  } else {
    const green = [21, 128, 61];   // #15803d (+30%)
    const bright = [34, 197, 94];  // #22c55e (+100% 이상, 밝고 쨍한 초록)
    c = pct <= HEAT_CLAMP
      ? mix(neutral, green, pct / HEAT_CLAMP)
      : mix(green, bright, Math.min(1, (pct - HEAT_CLAMP) / (HEAT_GREEN_MAX - HEAT_CLAMP)));
  }
  return 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')';
}

// 종목별 트리맵 렌더 (Finviz 스타일). 모듈 상태(_treemapDrill/_treemapFlat/_treemapHidden/_treemapHeat)에 따라
// 테마별·flat·drill 3가지 뷰 + 손익 히트맵을 매번 destroy 후 재생성.
// 현금은 음수 계좌(마이너스 통장)를 area로 못 그리므로 통화별 net 2타일로만 표시 (총액을 리밸런싱/목표표와 일치시키기 위함).
// 부수효과: 차트 외에 breadcrumb/legend/제목/설명 DOM 을 innerHTML 로 다시 쓰고 클릭 핸들러를 재바인딩한다.
// renderCharts() 에서 호출되며, 뷰 상태 토글(클릭·버튼) 시에는 자기 자신만 다시 호출한다 (다른 차트는 그대로).
function renderTreemap() {
  const canvas = document.getElementById('treemapChart');
  if (!canvas) return;
  const scoped = isLiquidScope();
  const total = scoped ? scopedTotal() : grandTotal();
  const wrapEl = canvas.parentElement;
  const legendEl = document.getElementById('treemap-legend');
  const breadcrumbEl = document.getElementById('treemap-breadcrumb');
  const titleEl = document.getElementById('treemap-title');
  const descEl = document.getElementById('treemap-desc');

  // 전체 종목 목록 (0원·부채 제외, 유동 모드면 묶임도 제외)
  const sourceHoldings = scoped
    ? assetHoldings().filter(h => holdingLiquidity(h) === 'liquid')
    : assetHoldings();
  // 현금 통화별 net (마이너스 통장 등 음수 포함) — 테마별(default) 뷰에서 통화별 순액 2타일로 표시하는 용도.
  // (리밸런싱/목표표와 총액 일치. area는 음수 표현 불가라 개별 계좌 대신 순액으로.)
  let _cashKRW = 0, _cashUSD = 0;
  sourceHoldings.forEach(h => {
    if (assetTypeOf(h) !== '현금') return;
    const v = holdingValue(h);
    if (h.exposure === '달러(노출)') _cashUSD += v; else _cashKRW += v;
  });
  // 비현금은 개별 종목 leaf. 현금은 아래 통화별 net 2타일로만 표시.
  const CASH_KRW_COLOR = '#16a34a', CASH_USD_COLOR = '#2dd4bf';
  const rawItems = sourceHoldings
    .filter(h => assetTypeOf(h) !== '현금')
    .map(h => ({
      ...h,
      _value: holdingValue(h),
      _name: h.name || (CATEGORY_MAP[h.category]?.key || '미명') + ' #' + h.id.slice(0, 4),
      _atype: assetTypeOf(h),
    }))
    .filter(h => h._value > 0);
  // 현금 = 통화별 net(마이너스 통장 등 음수 포함) 2타일. 모든 모드에서 합 = 8.27억(리밸런싱/목표표 일치).
  //   개별 계좌를 다 펼치면 음수(마통)를 area로 못 그려 합이 부풀려지므로(→8.5억, 말 안 됨) 의도적으로 net 2타일 유지.
  //   개별 계좌 잔액은 "자산 입력" 목록에서 확인. 둘 다 _atype='현금'이라 같은 블록에 원화/달러 인접, 색만 구분.
  //   name 각각 지정 (mergeHoldingItems가 name+_atype로 키를 만들어서 없으면 둘이 합쳐짐).
  if (_cashKRW > 0) rawItems.push({ id: '__cash_krw', category: '현금', exposure: '원화',      _value: _cashKRW, name: '현금(원화)', _name: '현금(원화)', _atype: '현금', _leafColor: CASH_KRW_COLOR });
  if (_cashUSD > 0) rawItems.push({ id: '__cash_usd', category: '현금', exposure: '달러(노출)', _value: _cashUSD, name: '현금($)',   _name: '현금($)',   _atype: '현금', _leafColor: CASH_USD_COLOR });

  // 같은 종목(ticker) + 같은 자산타입은 합치기
  const allItemsUnfiltered = mergeHoldingItems(rawItems);

  // 자산타입 필터 적용 (사용자가 레전드 토글로 숨긴 것 제외)
  // 단, 숨긴 자산타입에 보유 종목이 더 이상 없으면 자동 제거 (cleanup)
  const presentTypes = new Set(allItemsUnfiltered.map(i => i._atype));
  for (const t of [..._treemapHidden]) {
    if (!presentTypes.has(t)) _treemapHidden.delete(t);
  }
  const allItems = allItemsUnfiltered.filter(i => !_treemapHidden.has(i._atype));

  // drill 상태가 있는데 그 자산타입이 사라졌거나 숨겨졌으면 reset
  if (_treemapDrill && (!allItems.some(i => i._atype === _treemapDrill) || _treemapHidden.has(_treemapDrill))) {
    _treemapDrill = null;
  }

  // 표시할 items 필터링
  const items = _treemapDrill
    ? allItems.filter(i => i._atype === _treemapDrill)
    : allItems;
  // 현금이 이미 net 2타일로 들어있으므로 모든 모드에서 단순 합 = 정확(8.27억 반영).
  const visibleTotal = items.reduce((s, i) => s + i._value, 0);
  // 비중 계산 기준: 현재 보이는(렌더되는) 타일 합. 그래야 필터/drill 시 비중 합이 100%.
  const baseTotal = visibleTotal;
  const isFiltered = _treemapHidden.size > 0;
  const isFilteredOrDrill = isFiltered || _treemapDrill;

  // 기존 트리맵 destroy
  if (charts.treemap) { charts.treemap.destroy?.(); charts.treemap = null; }

  // 진짜 빈 상태 (자산 자체가 없음)
  if (allItemsUnfiltered.length === 0) {
    canvas.style.display = 'none';
    if (!wrapEl.querySelector('.treemap-empty')) {
      wrapEl.insertAdjacentHTML('beforeend',
        '<div class="treemap-empty" style="text-align:center;padding:40px;color:var(--text-muted);">자산을 입력하면 트리맵이 표시됩니다</div>');
    }
    if (legendEl) legendEl.innerHTML = '';
    if (breadcrumbEl) breadcrumbEl.style.display = 'none';
    return;
  }
  // 필터로 모두 숨겨진 상태: 레전드는 유지해서 다시 켤 수 있게
  if (items.length === 0) {
    canvas.style.display = 'none';
    if (!wrapEl.querySelector('.treemap-empty')) {
      wrapEl.insertAdjacentHTML('beforeend',
        '<div class="treemap-empty" style="text-align:center;padding:40px;color:var(--text-muted);">모든 자산타입이 숨겨져 있어요. 위 레전드에서 다시 켜거나 "전체 보기" 클릭</div>');
    }
    // 레전드는 아래에서 그대로 렌더링됨
  } else {
    canvas.style.display = '';
    const empty = wrapEl.querySelector('.treemap-empty');
    if (empty) empty.remove();
  }

  // === Breadcrumb 표시 (모든 모드에서 일관되게 총합 표시) ===
  const isFilteredView = _treemapHidden.size > 0;
  const visibleAtypeCount = new Set(allItems.map(i => i._atype)).size;

  if (_treemapDrill) {
    // drill 모드: 그 자산타입의 총합 + 종목 수 + 전체 대비 비중
    const drillPctOfWhole = total > 0 ? (visibleTotal / total * 100).toFixed(1) : 0;
    breadcrumbEl.style.display = 'flex';
    breadcrumbEl.innerHTML = `
      <button class="crumb-back" id="treemap-back-btn">← 전체로</button>
      <span style="color:var(--text-muted)">전체</span>
      <span style="color:var(--text-muted)">›</span>
      <span class="crumb-current">${_treemapDrill}</span>
      <span class="crumb-total-label">${_treemapDrill} 총합</span>
      <span class="crumb-total-amt">${fmtKRWshort(visibleTotal)}</span>
      <span class="crumb-extra">${items.length}개 종목 · 전체의 ${drillPctOfWhole}%</span>
    `;
    document.getElementById('treemap-back-btn').onclick = () => {
      _treemapDrill = null;
      renderTreemap();
    };
    if (titleEl) titleEl.textContent = `🗺️ ${_treemapDrill} 종목 비중`;
    if (descEl) descEl.textContent = `${_treemapDrill} 자산타입 내 종목별 비중 · 같은 종목은 여러 계좌 합산 · 종목별 색상`;
  } else if (_treemapFlat) {
    // flat 모드: 보이는 종목들의 총합 + 종목 수 + 필터 상태
    breadcrumbEl.style.display = 'flex';
    const filterNote = isFilteredView ? ` · ${_treemapHidden.size}개 자산타입 숨김` : '';
    const totalLabel = isFilteredView ? '선택 섹터 총합' : '총 자산';
    breadcrumbEl.innerHTML = `
      <button class="crumb-back" id="treemap-back-btn">← 테마별 보기로</button>
      <span class="crumb-current">전체 종목 펼침</span>
      <span class="crumb-total-label">${totalLabel}</span>
      <span class="crumb-total-amt">${fmtKRWshort(visibleTotal)}</span>
      <span class="crumb-extra">${items.length}개 종목${filterNote}</span>
    `;
    document.getElementById('treemap-back-btn').onclick = () => {
      _treemapFlat = false;
      renderTreemap();
    };
    if (titleEl) titleEl.textContent = '🗺️ 전체 종목 (색상 = 자산타입)';
    if (descEl) descEl.textContent = '모든 종목을 한 화면에 표시 · 같은 자산타입끼리 영역으로 뭉침 · 라벨은 티커';
  } else {
    // default 테마별 모드: 항상 breadcrumb 표시 (총합 일관성)
    breadcrumbEl.style.display = 'flex';
    const filterNote = isFilteredView ? ` · ${_treemapHidden.size}개 자산타입 숨김` : '';
    const totalLabel = isFilteredView ? '선택 섹터 총합' : '총 자산';
    breadcrumbEl.innerHTML = `
      <span class="crumb-current">테마별</span>
      <span class="crumb-total-label">${totalLabel}</span>
      <span class="crumb-total-amt">${fmtKRWshort(visibleTotal)}</span>
      <span class="crumb-extra">${visibleAtypeCount}개 자산타입${filterNote}</span>
    `;
    if (titleEl) titleEl.textContent = '🗺️ 자산타입별 비중 (테마)' + (scoped ? ' — 💧 유동만' : '');
    if (descEl) descEl.textContent = '자산타입(테마) 단위 비중 · 클릭하면 그 안의 종목으로 drill in' + (scoped ? ' · 묶인 자산(🔒) 제외' : '');
  }

  // 토글 버튼 상태 갱신
  const toggleBtn = document.getElementById('treemap-toggle-flat');
  if (toggleBtn) {
    if (_treemapDrill) {
      // drill 모드일 때는 토글 버튼 숨김 (브레드크럼의 '← 전체로' 사용)
      toggleBtn.style.display = 'none';
    } else {
      toggleBtn.style.display = '';
      toggleBtn.textContent = _treemapFlat ? '◫ 자산타입 그룹 보기' : '⊟ 전체 종목 펼치기';
      toggleBtn.onclick = () => {
        _treemapFlat = !_treemapFlat;
        renderTreemap();
      };
    }
  }

  // 손익 히트맵 토글 버튼 (모든 뷰 모드에서 사용 가능)
  const heatBtn = document.getElementById('treemap-toggle-heat');
  if (heatBtn) {
    heatBtn.textContent = _treemapHeat ? '🎨 자산타입 색상' : '🌡 손익 색상';
    heatBtn.classList.toggle('primary', _treemapHeat);
    heatBtn.onclick = () => {
      _treemapHeat = !_treemapHeat;
      renderTreemap();
    };
  }
  // 히트맵 모드 안내 문구
  if (_treemapHeat && descEl) {
    descEl.textContent += ' · 🌡 색상 = 손익률 (여러 계좌에 흩어진 같은 종목은 통합 수익률)';
  }

  // === 레전드 ===
  if (_treemapDrill) {
    // drill 모드: 들어간 자산타입 색상 안내 + 종목 수
    const baseColor = ASSET_TYPE_COLORS[_treemapDrill] || '#94a3b8';
    legendEl.innerHTML = `
      <span class="lg-item"><span class="lg-swatch" style="background:${baseColor}"></span>${_treemapDrill} (${items.length}개 종목)</span>
      <span class="lg-item" style="color:var(--text-muted)">종목마다 다른 색상 · 큰 사각형일수록 비중 높음</span>
    `;
  } else {
    // 그룹 모드 / flat 모드: 자산타입별 클릭 가능한 토글 버튼
    // 보유 자산타입 전체 목록 (필터 안 된 원본). 숨겨진 것도 토글로 다시 보이게
    const allTypesPresent = [...new Set(allItemsUnfiltered.map(i => i._atype))];
    const visibleCount = allTypesPresent.length - _treemapHidden.size;
    const buttons = allTypesPresent.map(t => {
      const isHidden = _treemapHidden.has(t);
      const color = ASSET_TYPE_COLORS[t] || '#94a3b8';
      return `<button class="lg-toggle ${isHidden ? 'hidden' : ''}" data-toggle-type="${escapeHtml(t)}" title="${isHidden ? '클릭해 다시 표시' : '클릭해 숨기기'}">
        <span class="lg-swatch" style="background:${color}"></span>
        <span class="lg-name">${escapeHtml(t)}</span>
      </button>`;
    }).join('');
    const reset = _treemapHidden.size > 0
      ? `<button class="lg-reset" id="treemap-filter-reset" title="모든 자산타입 다시 표시">↺ 전체 보기 (${_treemapHidden.size}개 숨김)</button>`
      : '';
    legendEl.innerHTML = buttons + reset;

    // 토글 클릭 핸들러
    legendEl.querySelectorAll('[data-toggle-type]').forEach(btn => {
      btn.addEventListener('click', () => {
        const t = btn.getAttribute('data-toggle-type');
        if (_treemapHidden.has(t)) _treemapHidden.delete(t);
        else _treemapHidden.add(t);
        renderTreemap();
      });
    });
    // 리셋 버튼
    const resetBtn = document.getElementById('treemap-filter-reset');
    if (resetBtn) resetBtn.onclick = () => {
      _treemapHidden.clear();
      renderTreemap();
    };
  }

  // 히트맵 모드: 손실↔수익 색상 스케일 레전드 추가
  if (_treemapHeat && legendEl) {
    legendEl.insertAdjacentHTML('beforeend',
      '<span class="lg-item" style="gap:6px;">손실이 큼' +
      '<span style="display:inline-block;width:140px;height:11px;border-radius:3px;vertical-align:middle;' +
      'background:linear-gradient(90deg,#b91c1c 0%,#52525b 30%,#15803d 55%,#22c55e 100%);"></span>수익이 큼' +
      '<span style="color:var(--text-muted);font-size:11px;">-30% ~ +100% 포화 · 회색 = 평단가 없음</span></span>');
  }

  // === 트리맵 차트 ===
  // 표시 모드 3가지:
  //   - default (테마별): 자산타입 5개 rectangle만 표시 (종목 안 보임). groups: ['_atype']
  //   - flat 모드 (전체 펼침): 모든 종목을 leaf로, 같은 자산타입끼리 색상 클러스터링. groups: ['_atype', '_uid']
  //   - drill 모드: 그룹 없이 한 자산타입의 종목만 (다채로운 팔레트). groups 없음
  const useGroups = !_treemapDrill;
  const drillBaseColor = _treemapDrill ? (ASSET_TYPE_COLORS[_treemapDrill] || '#94a3b8') : null;
  // 그룹 설정: default/flat 모두 2레벨(자산타입 > leaf), drill=없음
  // default에서도 2레벨을 쓰는 이유: 현금 그룹 안에 원화/달러 두 leaf를 인접 배치하기 위함
  const groupsConfig = _treemapDrill ? undefined : ['_atype', '_uid'];

  // 타일 위에서 커서를 pointer 로 (drill 가능함을 알리는 CSS 훅).
  wrapEl.classList.add('clickable');

  // drill 모드: 비중 순 정렬 + 종목별 다채로운 팔레트 색상 부여
  let sortedItems = items;
  // 히트맵용 통합 수익률/손익 추출 (mergeHoldingItems가 여러 계좌 합산해 둔 _mergedPnL 기반)
  const heatOf = (it) => (it._mergedPnL && it._mergedPnL.cost > 0)
    ? { _heatPct: it._mergedPnL.pct, _heatPnl: it._mergedPnL.pnl }
    : { _heatPct: null, _heatPnl: null };
  if (_treemapDrill) {
    sortedItems = [...items].sort((a, b) => b._value - a._value);
    const palette = generateDrillPalette(drillBaseColor, sortedItems.length);
    sortedItems = sortedItems.map((it, idx) => ({ ...it, _drillColor: palette[idx], ...heatOf(it) }));
  } else if (_treemapFlat) {
    // flat 모드: 모든 종목을 leaf로 (각 종목 고유 키)
    sortedItems = items.map((it, idx) => ({ ...it, _uid: 'i' + idx, ...heatOf(it) }));
    // 한 자산타입만 보이는 경우 → 종목별 다채로운 팔레트 (단일 색상이면 구분 안 되니까)
    const visibleAtypes = new Set(items.map(i => i._atype));
    if (visibleAtypes.size === 1) {
      const onlyAtype = [...visibleAtypes][0];
      const baseColor = ASSET_TYPE_COLORS[onlyAtype] || '#94a3b8';
      const sorted = [...sortedItems].sort((a, b) => b._value - a._value);
      const palette = generateDrillPalette(baseColor, sorted.length);
      sortedItems = sorted.map((it, idx) => ({ ...it, _drillColor: palette[idx] }));
    }
  } else {
    // default(테마별) 모드: 비현금은 자산타입당 1 leaf로 합산. 현금(net 2타일)은 개별 유지
    // → 같은 '현금' 그룹 안에서 원화/달러가 인접한 두 타일. 총액은 리밸런싱/목표표와 일치.
    const agg = new Map();
    const cashLeaves = [];
    items.forEach(it => {
      if (it._atype === '현금') { cashLeaves.push(it); return; }
      if (!agg.has(it._atype)) agg.set(it._atype, { _atype: it._atype, _name: it._atype, _value: 0, _mergedCount: 0, _hPnl: 0, _hCost: 0 });
      const g = agg.get(it._atype); g._value += it._value; g._mergedCount += 1;
      // 자산타입 통합 손익 (평단가 있는 종목만 합산)
      if (it._mergedPnL && it._mergedPnL.cost > 0) { g._hPnl += it._mergedPnL.pnl; g._hCost += it._mergedPnL.cost; }
    });
    sortedItems = [...agg.values(), ...cashLeaves].map((it, idx) => ({
      ...it, _uid: 'i' + idx,
      _heatPct: it._hCost > 0 ? it._hPnl / it._hCost : null,
      _heatPnl: it._hCost > 0 ? it._hPnl : null,
    }));
  }

  // 필터로 모든 종목이 숨겨졌으면 차트 생성 안 함 (레전드만 보임)
  if (sortedItems.length === 0) return;

  // 리프 색상 직접 매핑 (_uid → 색). backgroundColor 콜백에서 확실히 적용되도록 (현금 원화/달러 구분).
  const _leafColorByUid = {};
  sortedItems.forEach(it => { if (it._leafColor && it._uid) _leafColorByUid[it._uid] = it._leafColor; });

  // 트리맵 생성. tree 배열을 _value(KRW) 면적 기준으로 타일링하고, groups 유무로 2레벨/무그룹 구조를 결정.
  // 콜백(backgroundColor/labels/tooltip/onClick)들은 위에서 만든 sortedItems·baseTotal 클로저를 참조한다.
  charts.treemap = new Chart(canvas, {
    type: 'treemap',
    data: {
      datasets: [{
        tree: sortedItems,
        key: '_value',
        ...(groupsConfig ? { groups: groupsConfig } : {}),
        // 캡션(자산타입 헤더 띠): default(테마별)에서는 안 그림 (어차피 leaf로 텍스트 표시)
        // flat 모드에서는 캡션 띠 없음 (종목 leaf만 보이도록)
        captions: { display: false },
        spacing: 1,
        borderWidth: 1,
        borderColor: '#fff',
        backgroundColor: (ctx) => {
          if (ctx.type !== 'data') return 'transparent';
          const r = ctx.raw;
          // === 손익 히트맵 모드: 모든 leaf 색상 = 통합 수익률 ===
          if (_treemapHeat) {
            // 그룹 밴드(l=0)는 자산타입 색 유지 (spacing 틈으로 살짝 보이는 정도)
            if (!_treemapDrill && r.l === 0) return ASSET_TYPE_COLORS[r.g] || '#94a3b8';
            let hItem = r._data;
            if ((!hItem || hItem._heatPct === undefined) && r.g) {
              hItem = sortedItems.find(it => it._uid === r.g);
            }
            return heatColor(hItem ? hItem._heatPct : null);
          }
          if (_treemapDrill) {
            // drill: 종목별 팔레트 색상
            return r._data?._drillColor || drillBaseColor || '#94a3b8';
          }
          // default(단일 그룹) 또는 flat(2레벨)
          if (r.l === 0) {
            // l=0: 자산타입 그룹 → r.g = atype 문자열
            return ASSET_TYPE_COLORS[r.g] || '#94a3b8';
          }
          // l>=1 leaf: _uid(=r.g) 직접 매핑 우선 (현금 원화/달러 구분색 확실 적용)
          if (_leafColorByUid[r.g]) return _leafColorByUid[r.g];
          // fallback: _uid로 item lookup
          let item = r._data;
          if ((!item || !item._atype) && r.g) {
            item = sortedItems.find(it => it._uid === r.g);
          }
          // _drillColor 있으면 (flat + 단일 섹터 필터 케이스) 우선 사용
          if (item?._drillColor) return item._drillColor;
          // _leafColor: 현금 원화/달러 구분색
          if (item?._leafColor) return item._leafColor;
          return ASSET_TYPE_COLORS[item?._atype] || '#94a3b8';
        },
        labels: {
          display: true,
          color: '#fff',
          font: { size: _treemapDrill ? 13 : 11, weight: '600' },
          formatter(ctx) {
            if (ctx.type !== 'data') return '';
            const r = ctx.raw;
            // 비중은 항상 보이는 화면 기준 (visible total). 전체 대비 % 보조표시 안 함
            const pctOfBase = ((r.v / baseTotal) * 100).toFixed(1);

            // === 그룹 밴드(l=0): 라벨 숨김 (값은 leaf에 표시) ===
            if (!_treemapDrill && r.l === 0) return '';

            let item = r._data;
            if ((!item || !item._name) && r.g) {
              item = sortedItems.find(it => it._uid === r.g);
            }
            if (!item) return '';
            const sizeRatio = r.v / baseTotal;

            // === 손익 히트맵 모드: 비중 대신 통합 수익률 표시 (비중·금액은 툴팁에) ===
            if (_treemapHeat) {
              const hl = (item._heatPct === null || item._heatPct === undefined) ? null : fmtSignedPct(item._heatPct);
              if (_treemapDrill) {
                if (sizeRatio < 0.005) return hl || '';
                if (sizeRatio < 0.03) return hl ? [item._name, hl] : [item._name];
                const lines = [item._name];
                if (item._displayTicker) lines.push(item._displayTicker);
                lines.push(fmtKRWshort(r.v) + ' · ' + pctOfBase + '%' + (hl ? ' · ' + hl : ''));
                return lines;
              }
              if (_treemapFlat) {
                if (sizeRatio < 0.005) return '';
                return hl ? [item._shortName || item._name, hl] : [item._shortName || item._name];
              }
              // default(테마별)
              if (sizeRatio < 0.004) return hl || '';
              return hl ? [item._name, hl] : [item._name];
            }

            // === default(테마별) 모드: 자산타입 라벨 + % (현금은 현금(원화)/현금($)) ===
            if (!_treemapDrill && !_treemapFlat) {
              if (sizeRatio < 0.004) return pctOfBase + '%';
              return [item._name, pctOfBase + '%'];
            }

            // flat 모드: 0.5% 이상이면 종목명(짧게) + 비중 같이
            if (_treemapFlat) {
              if (sizeRatio < 0.005) return '';
              return [item._shortName || item._name, pctOfBase + '%'];
            }

            // drill 모드: 풀 디스플레이 (이름 + 티커 + 금액·비중)
            if (sizeRatio < 0.005) return pctOfBase + '%';
            if (sizeRatio < 0.03) return [item._name, pctOfBase + '%'];
            const lines = [item._name];
            if (item._displayTicker) {
              lines.push(item._mergedCount > 1
                ? item._displayTicker + ' · ' + item._mergedCount + '계좌'
                : item._displayTicker);
            } else if (item._mergedCount > 1) {
              lines.push(item._mergedCount + '계좌');
            }
            lines.push(fmtKRWshort(r.v) + ' · ' + pctOfBase + '%');
            return lines;
          },
          overflow: 'fit',
        },
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      onClick: (evt, elements, chart) => {
        if (!elements || !elements.length) return;
        const el = elements[0];
        const raw = chart.getDatasetMeta(el.datasetIndex).data[el.index]?.$context?.raw;
        if (!raw || _treemapDrill) return;
        // default 또는 flat 모드: 자산타입 클릭 시 drill in
        let target = null;
        if (raw.l === 0) {
          target = raw.g;  // 자산타입 그룹 직접 클릭
        } else {
          // flat 모드 leaf: 그 leaf의 자산타입으로 drill
          let item = raw._data;
          if ((!item || !item._atype) && raw.g) {
            item = sortedItems.find(it => it._uid === raw.g);
          }
          if (item?._atype) target = item._atype;
        }
        if (target) {
          _treemapDrill = target;
          renderTreemap();
        }
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          displayColors: false,
          // 그룹 밴드(l=0)는 leaf의 부모 컨테이너일 뿐이라 호버 정보 의미 없음 → leaf만 표시
          // (default/flat 모두 2레벨이므로 drill이 아닐 때 l=0 숨김)
          filter: (item) => !(!_treemapDrill && item.raw?.l === 0),
          callbacks: {
            title: ctx => {
              const r = ctx[0].raw;
              // default 모드 (l=0=자산타입) 또는 flat 모드 outer (l=0)
              if (r.l === 0) {
                return r.g + (!_treemapDrill ? ' — 클릭해 펼치기' : '');
              }
              // leaf
              let item = r._data;
              if ((!item || !item._name) && r.g) {
                item = sortedItems.find(it => it._uid === r.g);
              }
              if (!item) return '';
              // drill 모드: 이름 + 티커 같이
              if (_treemapDrill && item._displayTicker
                  && item._displayTicker.toLowerCase() !== (item._name || '').toLowerCase()) {
                return item._name + '  ·  ' + item._displayTicker;
              }
              return item._name;
            },
            label: ctx => {
              const r = ctx.raw;
              const pct = ((r.v / baseTotal) * 100).toFixed(1);
              const lines = [fmtKRWshort(r.v) + '  ·  ' + pct + '%'];
              // 통합 손익 (여러 계좌 합산: Σ손익 / Σ원금). 그룹 밴드(l=0) 제외
              if (r.l !== 0) {
                let item = r._data;
                if ((!item || item._heatPct === undefined) && r.g) {
                  item = sortedItems.find(it => it._uid === r.g);
                }
                if (item && item._heatPct !== null && item._heatPct !== undefined) {
                  const sign = item._heatPnl >= 0 ? '+' : '';
                  lines.push('손익 ' + sign + fmtKRWshort(item._heatPnl) + '  ·  ' + fmtSignedPct(item._heatPct)
                    + (item._mergedFrom && item._mergedCount > 1 ? '  (' + item._mergedCount + '계좌 통합)' : ''));
                }
              }
              return lines;
            },
            afterLabel: ctx => {
              try {
                const r = ctx && ctx.raw;
                if (!r || r.l === 0) return '';  // 자산타입 그룹은 메모 없음
                let item = r._data;
                if ((!item || !item._name) && r.g) {
                  item = sortedItems.find(it => it._uid === r.g);
                }
                const memo = item ? getHoldingMemo(item._name) : '';
                if (!memo) return '';
                // 멀티라인 array 반환 → Chart.js가 줄별로 그려줌
                const lines = memo.split(/\r?\n/);
                return ['', '📝 ' + lines[0]].concat(lines.slice(1));
              } catch (e) { return ''; }
            }
          }
        }
      }
    }
  });
}

