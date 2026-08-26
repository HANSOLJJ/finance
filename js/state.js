// ============================================================================
// 상태(state) 관리 — 기본값·마이그레이션·메모 헬퍼.
// 앱의 유일한 데이터 원천인 전역 `state` 객체를 이 파일에서 만들고 소유한다.
// 영속화는 서버(KV) 단일 소스 — 부트 로드는 main.js bootstrap(), 자동 저장 예약은
// sync.js scheduleServerSave() 가 담당하며 localStorage 는 더 이상 쓰지 않는다.
// 주요 필드 구조 (defaultState() 참고).
//  - holdings: 보유 자산 행 배열 (id/category/name/quantity/price/exposure 등).
//  - history: 스냅샷 배열 (총자산 추이, totalUSD 포함).
//  - assetTypeTargets/expTargets: 리밸런싱 목표 비중, usdKrwRate: 환율 캐시.
//  - lastUpdated/lastBackupAt/lastServerSaveAt: 갱신·백업·서버 저장 시각.
// 로드 순서 constants→state→calc→render→charts→data-io→fetch→sync→main 중
// 두 번째 — constants.js 의 상수에 의존하고, 이후 모든 파일이 state 를 읽고 쓴다.
// ============================================================================
// ==================== 상태 관리 ====================
// 최초 실행용 초기 상태 — 카테고리별 빈 행 1개 + 목표비중·환율 등 기본 설정값.
// 여기서 반환하는 객체 모양이 곧 저장 스키마다. 필드를 추가하면 기존 저장본에는
// 그 필드가 없으므로 migrateState()에 기본값 채우기 로직을 반드시 같이 넣을 것.
// main.js bootstrap()이 서버 데이터를 { ...defaultState(), ...data }로 합칠 때도 사용.
function defaultState() {
  return {
    holdings: CATEGORIES.flatMap(c => [{
      id: uid(), category: c.key, name: '', account: '', ticker: '', symbol: '',
      quantity: c.amountOnly ? '1' : '', price: '', priceUSD: '',
      avgPrice: '', avgPriceUSD: '',  // 평단가 (P&L 계산용)
      exposure: DEFAULT_EXPOSURE_BY_CAT[c.key], memo: '',
      assetType: c.assetTypeFixed || '주식',
      liquidity: DEFAULT_LIQUIDITY_BY_CAT[c.key] || 'liquid',
      lastFetched: ''
    }]),
    assetTypeTargets: { ...DEFAULT_ASSET_TYPE_TARGETS },
    expTargets: { ...DEFAULT_EXP_TARGETS },
    history: [],
    collapsed: {},
    usdKrwRate: 1380, // 임시 기본값. 첫 로드시 자동 갱신
    rateUpdatedAt: '',
    cryptoExchange: 'bithumb',  // 'bithumb' | 'upbit' | 'coingecko'
    usCpiAnnual: 0.035,  // 미국 CPI 연율 (인플레이션 기준선용, default 3.5%)
    lastBackupAt: '',  // 마지막 JSON 백업 시점
    lastServerSaveAt: '',  // 마지막 서버(KV) 저장 시점
    activeTab: 'dashboard',  // 마지막 활성 탭
    historyChartMode: 'normalized',  // 'absolute' | 'normalized' (이력 차트 표시 모드) — 기본: 정규화
    holdingMemos: {},  // { [normalizedName]: memoText } - 종목명 기준 멀티라인 메모 (자산 입력의 짧은 라벨 memo와 별개)
    viewScope: 'all',  // 'all' | 'liquid' — 대시보드/분석탭 표시 기준 (전체 자산 vs 유동만)
    lastUpdated: localDateStr(),
  };
}

// 전역 단일 상태 객체 — 빈 기본값으로 시작하고 main.js bootstrap()이 서버(KV)
// 데이터로 통째로 재할당한다 (재할당 때문에 let 선언). 서버 단일 소스 구조라
// 이 기기(localStorage)에는 저장본을 두지 않는다.
let state = defaultState();

// 구버전 저장 데이터를 현재 스키마로 보정 — 카테고리/통화노출 rename,
// 신규 필드 기본값 채우기, 목표비중 키 보정, 과거 스냅샷 USD 누락 보정.
// 앱 스키마는 계속 진화하는데 사용자 기기·서버 KV에는 과거 버전 데이터가
// 남아 있으므로, 로드 경로(loadState·bootstrap 서버 로드·JSON 가져오기)마다
// 이 함수를 통과시켜야 undefined 필드로 인한 렌더/계산 오류를 막을 수 있다.
// 인자 s 를 제자리(in-place)에서 수정한 뒤 그대로 반환한다.
function migrateState(s) {
  const RENAMES = { 'ETF': '국내주식', 'KRX 금현물': '금' };
  const EXPOSURE_RENAMES = {
    '원자재(달러노출)': '달러(노출)',
    '달러노출': '달러(노출)',
    '달러': '달러(노출)',
  };
  // 카테고리 마이그레이션
  if (s.holdings) {
    s.holdings.forEach(h => {
      if (RENAMES[h.category]) h.category = RENAMES[h.category];
      if (EXPOSURE_RENAMES[h.exposure]) h.exposure = EXPOSURE_RENAMES[h.exposure];
      // 금 카테고리는 통화노출을 '달러헤지'로 이관 (달러노출과 role이 다름).
      // 사용자가 원화 등 다른 값으로 명시 설정한 경우는 존중.
      if (h.category === '금' && (h.exposure === '달러(노출)' || h.exposure === '달러노출' || h.exposure === '달러')) {
        h.exposure = '달러헤지';
      }
      // 신규 필드 기본값 채우기
      if (h.ticker === undefined) h.ticker = '';
      if (h.symbol === undefined) h.symbol = '';
      if (h.priceUSD === undefined) h.priceUSD = '';
      if (h.avgPrice === undefined) h.avgPrice = '';
      if (h.avgPriceUSD === undefined) h.avgPriceUSD = '';
      if (h.lastFetched === undefined) h.lastFetched = '';
      if (h.liquidity === undefined) {
        h.liquidity = DEFAULT_LIQUIDITY_BY_CAT[h.category] || 'liquid';
      }
      const cat = CATEGORY_MAP[h.category];
      // assetType: 카테고리 잠금이 있으면 항상 강제 적용
      if (cat?.assetTypeFixed) {
        h.assetType = cat.assetTypeFixed;
      } else if (h.assetType === undefined) {
        h.assetType = '주식';
      }
    });
  }
  // 통화노출 목표 키 이름 마이그레이션
  if (s.expTargets) {
    Object.entries(EXPOSURE_RENAMES).forEach(([oldKey, newKey]) => {
      if (s.expTargets[oldKey] !== undefined) {
        s.expTargets[newKey] = (s.expTargets[newKey] || 0) + s.expTargets[oldKey];
        delete s.expTargets[oldKey];
      }
    });
  }
  // 자산타입 목표 비중 신규 필드
  if (!s.assetTypeTargets) s.assetTypeTargets = { ...DEFAULT_ASSET_TYPE_TARGETS };
  // 새로 추가된 자산타입 키 보정 (부동산 등)
  ASSET_TYPES.forEach(t => {
    if (s.assetTypeTargets[t] === undefined) s.assetTypeTargets[t] = 0;
  });
  // 통화노출 목표 키 보정 (달러헤지 신규 추가)
  if (!s.expTargets) s.expTargets = { ...DEFAULT_EXP_TARGETS };
  EXPOSURES.forEach(e => {
    if (s.expTargets[e] === undefined) s.expTargets[e] = 0;
  });
  // 자산타입 금 목표와 달러헤지가 desync 되어있으면 자산타입 금 값으로 sync (한 번만)
  if (s.assetTypeTargets['금'] !== undefined && s.expTargets['달러헤지'] === 0
      && s.assetTypeTargets['금'] > 0) {
    s.expTargets['달러헤지'] = s.assetTypeTargets['금'];
  }
  if (s.usdKrwRate === undefined) s.usdKrwRate = 1380;
  if (s.rateUpdatedAt === undefined) s.rateUpdatedAt = '';
  if (s.cryptoExchange === undefined) s.cryptoExchange = 'bithumb';
  if (s.usCpiAnnual === undefined) s.usCpiAnnual = 0.035;
  if (s.lastBackupAt === undefined) s.lastBackupAt = '';
  if (s.lastServerSaveAt === undefined) s.lastServerSaveAt = '';
  if (s.activeTab === undefined) s.activeTab = 'dashboard';
  if (s.historyChartMode === undefined) s.historyChartMode = 'normalized';
  if (s.holdingMemos === undefined || s.holdingMemos === null) s.holdingMemos = {};
  if (s.viewScope === undefined) s.viewScope = 'all';
  // 과거 스냅샷에 totalUSD 누락 보정
  if (s.history && s.usdKrwRate) {
    s.history.forEach(snap => {
      if (snap.totalUSD === undefined && snap.total && (snap.fxRate || s.usdKrwRate)) {
        snap.totalUSD = snap.total / (snap.fxRate || s.usdKrwRate);
      }
    });
  }
  return s;
}

// 상태 변경을 영속화하는 유일한 진입점 — 모든 편집 핸들러가 수정 직후 호출한다.
// localStorage 대신 서버(KV) 자동 저장을 예약한다(sync.js scheduleServerSave —
// 마지막 변경 후 잠시 조용해지면 업로드 1회로 묶는 디바운스). 변경이 없으면
// 이 함수가 불릴 일이 없으므로 불필요한 통신도 발생하지 않는다.
// scheduleServerSave 는 로드 순서상 뒤(sync.js)에 정의되지만 호출 시점엔 존재한다.
function saveState() {
  state.lastUpdated = localDateStr();
  scheduleServerSave();
}

// 홀딩/스냅샷 식별용 랜덤 8자리 id 생성.
// 세션 내 DOM 바인딩·삭제 대상 식별이 목적이라 암호학적 고유성은 필요 없다.
function uid() { return Math.random().toString(36).slice(2, 10); }

// ==================== 메모 헬퍼 ====================
// 메모는 두 종류 — 종목명 기준 멀티라인 메모(state.holdingMemos)와
// 스냅샷 객체에 직접 붙는 memo 필드. 아래 헬퍼들이 조회/저장을 감싼다.
// 종목명 메모는 정규화된 종목명(소문자·trim) 기준으로 저장. 같은 종목을 다계좌에 분산해도 메모는 공유.
function memoKey(name) {
  return (name || '').trim().toLowerCase();
}
// 종목명 기준 메모 조회.
// 없으면 빈 문자열 반환 — 호출부에서 존재 여부 검사 없이 바로 표시 가능.
function getHoldingMemo(name) {
  if (!state.holdingMemos) return '';
  return state.holdingMemos[memoKey(name)] || '';
}
// 종목명 기준 메모 저장 (빈 값이면 삭제).
// state 만 수정하고 saveState()는 호출하지 않으므로 호출부가 영속화를 책임진다.
function setHoldingMemo(name, text) {
  if (!state.holdingMemos) state.holdingMemos = {};
  const key = memoKey(name);
  if (!key) return;
  const v = (text || '').trim();
  if (v) state.holdingMemos[key] = v;
  else delete state.holdingMemos[key];
}
// 스냅샷 id 기준 메모 조회.
// 스냅샷 메모는 holdingMemos 와 달리 history 항목의 memo 필드에 직접 저장돼 있다.
function getSnapshotMemo(id) {
  const s = state.history.find(h => h.id === id);
  return (s && s.memo) ? s.memo : '';
}
// 스냅샷 id 기준 메모 저장 (빈 값이면 삭제).
// 대상 스냅샷이 없으면 조용히 무시하며, 영속화는 호출부의 saveState() 몫이다.
function setSnapshotMemo(id, text) {
  const s = state.history.find(h => h.id === id);
  if (!s) return;
  const v = (text || '').trim();
  if (v) s.memo = v;
  else delete s.memo;
}
// 멀티라인 메모의 첫 줄만 maxLen 자로 잘라 미리보기 문자열을 만든다.
// 툴팁·목록 등 한 줄 표시 공간용 — Chart.js 툴팁은 텍스트 전용이라 HTML
// 이스케이프는 표시하는 쪽(render/charts)에서 필요 시 처리한다.
function memoFirstLine(text, maxLen = 80) {
  if (!text) return '';
  const line = text.split(/\r?\n/)[0];
  return line.length > maxLen ? line.slice(0, maxLen - 1) + '…' : line;
}

// 공용 메모 편집 모달 — kind: 'holding' | 'snapshot', target: name 또는 snapshotId.
// render.js 의 메모 버튼에서 호출되며, 모달을 DOM 에 즉석 생성하고 저장/삭제 시
// saveState() 후 render() 전체 갱신을 트리거한다 (부수효과 있음).
// escapeHtml·render 는 뒤에 로드되는 파일의 전역 함수지만 호출 시점엔 존재한다.
function openMemoModal(kind, target, displayLabel) {
  // 기존 모달 제거
  const existing = document.getElementById('memoModalBackdrop');
  if (existing) existing.remove();

  const current = kind === 'snapshot' ? getSnapshotMemo(target) : getHoldingMemo(target);
  const titleEmoji = kind === 'snapshot' ? '📅' : '📝';
  const titleText = kind === 'snapshot' ? '스냅샷 메모' : '종목 메모';
  const subtitle = displayLabel || target;
  const hint = kind === 'snapshot'
    ? '이 시점의 시장 상황 / 의사결정 / 리밸런싱 메모 등'
    : '이 종목 관련 메모 (목표가, 손절선, 보유 이유 등) · 같은 종목 다계좌에 공유됨';

  const backdrop = document.createElement('div');
  backdrop.id = 'memoModalBackdrop';
  backdrop.className = 'memo-modal-backdrop';
  backdrop.innerHTML = `
    <div class="memo-modal" role="dialog" aria-modal="true">
      <div class="memo-modal-head">
        <div>
          <div class="memo-modal-title">${titleEmoji} ${titleText}</div>
          <div class="memo-modal-sub">${escapeHtml(subtitle)}</div>
        </div>
        <button class="memo-modal-x" id="memoModalCloseBtn" title="닫기">×</button>
      </div>
      <div class="memo-modal-hint">${hint}</div>
      <textarea id="memoModalTextarea" class="memo-modal-textarea" rows="8" placeholder="메모 내용 (멀티라인 허용)">${escapeHtml(current)}</textarea>
      <div class="memo-modal-foot">
        <span class="memo-modal-help">Ctrl+Enter: 저장 · Esc: 닫기</span>
        <div style="display:flex;gap:8px;">
          ${current ? '<button class="btn" id="memoModalDeleteBtn" style="color:#dc2626">삭제</button>' : ''}
          <button class="btn" id="memoModalCancelBtn">취소</button>
          <button class="btn primary" id="memoModalSaveBtn">저장</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);

  const textarea = document.getElementById('memoModalTextarea');
  const close = () => backdrop.remove();
  const save = () => {
    const text = textarea.value;
    if (kind === 'snapshot') setSnapshotMemo(target, text);
    else setHoldingMemo(target, text);
    saveState();
    close();
    render();
  };
  const del = () => {
    if (kind === 'snapshot') setSnapshotMemo(target, '');
    else setHoldingMemo(target, '');
    saveState();
    close();
    render();
  };

  document.getElementById('memoModalCloseBtn').onclick = close;
  document.getElementById('memoModalCancelBtn').onclick = close;
  document.getElementById('memoModalSaveBtn').onclick = save;
  const delBtn = document.getElementById('memoModalDeleteBtn');
  if (delBtn) delBtn.onclick = del;
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); }
  });
  setTimeout(() => textarea.focus(), 30);
}

