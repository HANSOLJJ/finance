// ============================================================================
// 카테고리·자산타입·색상·목표 비중 등 앱 전역 상수 정의.
// 자산 입력 테이블의 섹션 구성(CATEGORIES), 집계·차트의 3개 축(카테고리/자산타입/
// 통화노출)과 축별 색상·CSS 클래스, 리밸런싱 기본 목표 비중, 신규 행 기본값,
// localStorage 저장 키(STORAGE_KEY), 로컬 시간대 날짜 헬퍼(localDateStr)를 담는다.
// 로드 순서 constants→state→calc→render→charts→data-io→fetch→sync→main 의
// 첫 번째 파일 — 다른 js 파일에 의존하지 않으며, 이후 모든 파일이 여기 정의된
// 전역 const 를 스크립트 전역 스코프로 직접 참조한다 (모듈/export 없음).
// ============================================================================
// ==================== 상수 ====================
// 자산 카테고리 정의 — amountOnly: 금액 직접입력, hasTicker: 시세검색 지원,
// isUSD: USD 가격 기준, assetTypeFixed: 자산타입 고정(사용자 변경 불가)
// state.js defaultState()의 초기 행 생성, render.js 입력 테이블의 섹션 구성,
// calc.js 집계, data-io.js CSV 입출력이 모두 이 배열의 순서·플래그를 따른다.
// 항목을 추가/삭제하면 기존 저장 데이터와 어긋나므로 migrateState() 보정도 함께 볼 것.
const CATEGORIES = [
  { key: '현금',         cls: 'cash',         amountOnly: true,  hasTicker: false, isUSD: false, hasAssetTag: true, assetTypeFixed: '현금' },
  { key: '국내주식',     cls: 'kstock',       amountOnly: false, hasTicker: true,  isUSD: false, hasAssetTag: true, tickerHint: '예: 005930' },
  { key: '해외주식',     cls: 'fstock',       amountOnly: false, hasTicker: true,  isUSD: true,  hasAssetTag: true, tickerHint: '예: AAPL' },
  { key: '암호화폐',     cls: 'crypto',       amountOnly: false, hasTicker: true,  isUSD: false, hasAssetTag: true, isCrypto: true, assetTypeFixed: '암호화폐', tickerHint: '예: bitcoin' },
  { key: '연금저축펀드', cls: 'pension-fund', amountOnly: false, hasTicker: true,  isUSD: false, hasAssetTag: true, tickerHint: 'TIGER 미국S&P500 등 ETF' },
  { key: '퇴직연금',     cls: 'retirement',   amountOnly: false, hasTicker: true,  isUSD: false, hasAssetTag: true, tickerHint: 'KODEX 200 등 ETF' },
  { key: 'ISA',          cls: 'isa',          amountOnly: false, hasTicker: true,  isUSD: false, hasAssetTag: true, tickerHint: '069500 등 ETF' },
  { key: '금',           cls: 'gold',         amountOnly: false, hasTicker: false, isUSD: false, hasAssetTag: true, assetTypeFixed: '금' },
  { key: '부동산',       cls: 'realestate',   amountOnly: true,  hasTicker: false, isUSD: false, hasAssetTag: true, assetTypeFixed: '부동산', skipAccount: true },
];

// key → 카테고리 정의 빠른 조회용 맵.
// calc.js·fetch.js·charts.js·data-io.js 가 홀딩의 category 문자열로
// 플래그(isUSD, isCrypto 등)를 조회할 때 CATEGORIES 순회 대신 사용.
const CATEGORY_MAP = Object.fromEntries(CATEGORIES.map(c => [c.key, c]));
// 자산타입 축 (도넛/리밸런싱/트리맵의 집계 기준) + 타입별 색상·CSS 클래스.
// ASSET_TYPES 배열 순서가 calc.js 집계·charts.js 도넛·render.js 리밸런싱 표의
// 표시 순서를 결정. COLORS 는 charts.js 차트 색, CLS 는 render.js 뱃지 클래스.
// 타입을 추가하면 state.js migrateState()의 목표비중 키 보정이 0으로 채워준다.
const ASSET_TYPES = ['현금', '주식', '채권', '금', '원자재', '부동산', '암호화폐'];
const ASSET_TYPE_COLORS = {
  '현금': '#16a34a', '주식': '#2563eb', '채권': '#0d9488',
  '금': '#eab308', '원자재': '#a16207', '부동산': '#7c3aed', '암호화폐': '#ec4899',
};
const ASSET_TYPE_CLS = {
  '현금': 'asset-cash', '주식': 'asset-stock', '채권': 'asset-bond',
  '금': 'asset-gold', '원자재': 'asset-commodity', '부동산': 'asset-realestate', '암호화폐': 'asset-crypto',
};
// 트리맵/도넛 전용 의사(pseudo) 타입 색상 — 달러 현금을 원화 현금과 같은
// 초록 계열, 명도만 다르게 구별. ASSET_TYPES 배열에는 없는 표시 전용 키라서
// 집계·목표비중에는 등장하지 않고 charts.js 색상 조회에서만 쓰인다.
ASSET_TYPE_COLORS['현금($)'] = '#2dd4bf';

// 카테고리별 차트 색상 팔레트.
// 현재 다른 파일에서 참조하는 곳이 없는 예비 팔레트 — 차트는 자산타입/통화노출
// 축 색상(ASSET_TYPE_COLORS/EXPOSURE_COLORS)을 사용한다.
const CATEGORY_COLORS = {
  '현금': '#16a34a', '국내주식': '#2563eb', '해외주식': '#0ea5e9', '암호화폐': '#f59e0b',
  '연금저축펀드': '#94a3b8', '퇴직연금': '#6366f1', 'ISA': '#f97316', '금': '#eab308',
  '부동산': '#7c3aed',
};

// 통화노출 축 — 원화 / 달러(노출) / 달러헤지(금·실물).
// 금은 달러 자체 노출과 다른 role (달러 약세시 오히려 상승) → 별도 분리.
// calc.js 통화노출 집계, charts.js 노출 도넛, render.js 노출 선택 UI·리밸런싱
// 표가 이 배열 순서를 따르며, COLORS/CLS 는 각각 차트 색·뱃지 클래스용이다.
const EXPOSURES = ['원화', '달러(노출)', '달러헤지'];
const EXPOSURE_COLORS = { '원화': '#16a34a', '달러(노출)': '#2563eb', '달러헤지': '#eab308' };
const EXPOSURE_CLS = { '원화': 'krw', '달러(노출)': 'usd', '달러헤지': 'hedge' };

// 리밸런싱 기본 목표 비중 (자산타입 / 통화노출, 각각 합계 1.0).
// state.js defaultState()의 초기값과 migrateState()의 누락 키 보정에만 쓰이고,
// 이후 사용자가 리밸런싱 탭에서 수정한 값은 state.assetTypeTargets/expTargets 에
// 저장되므로 여기 값을 바꿔도 기존 사용자에게는 반영되지 않는다.
const DEFAULT_ASSET_TYPE_TARGETS = {
  '현금': 0.05, '주식': 0.30, '채권': 0.10, '금': 0.05, '원자재': 0.05, '부동산': 0.35, '암호화폐': 0.10,
};
const DEFAULT_EXP_TARGETS = { '원화': 0.55, '달러(노출)': 0.40, '달러헤지': 0.05 };

// 신규 행 생성 시 카테고리별 통화노출 기본값.
// state.js defaultState()·render.js 행 추가·data-io.js CSV 가져오기에서 사용.
// 행별로 사용자가 노출 셀렉트로 자유롭게 변경 가능한 초기값일 뿐이다.
const DEFAULT_EXPOSURE_BY_CAT = {
  '현금': '원화', '국내주식': '원화', '해외주식': '달러(노출)', '암호화폐': '달러(노출)',
  '연금저축펀드': '원화', '퇴직연금': '원화', 'ISA': '원화', '금': '달러헤지',
  '부동산': '원화',
};

// 카테고리별 유동성 기본값.
// 'liquid': 즉시 인출/매도 가능.
// 'locked': 제도/제약으로 묶임 (연금/ISA 만기/주택청약/부동산 등).
// 행별로 사용자가 override 가능 (예: 같은 현금 카테고리에서 주택청약/보험만 locked).
// state.js 초기 행·마이그레이션, calc.js 의 viewScope('liquid') 필터,
// render.js 행 추가, data-io.js CSV 가져오기에서 기본값으로 참조된다.
const DEFAULT_LIQUIDITY_BY_CAT = {
  '현금': 'liquid', '국내주식': 'liquid', '해외주식': 'liquid', '암호화폐': 'liquid', '금': 'liquid',
  '연금저축펀드': 'locked', '퇴직연금': 'locked', 'ISA': 'locked', '부동산': 'locked',
};

// localStorage 저장 키.
// state.js loadState()/saveState()와 main.js bootstrap()의 "이 기기에 데이터
// 있음" 판정이 이 키를 공유한다. 이름을 바꾸면 기존 기기 데이터가 유실된 것처럼
// 보이므로 스키마가 호환 불가능하게 바뀔 때만 v2 등으로 올릴 것.
const STORAGE_KEY = 'portfolio_state_v1';

// 로컬(KST 등) 시간대 기준 YYYY-MM-DD 문자열을 돌려주는 날짜 헬퍼.
// toISOString()은 UTC라 KST 오전 9시 이전엔 전날 날짜가 나오는 버그가 있어 이 함수를 씀.
// state.js saveState()의 lastUpdated, sync.js 서버 저장 직전 갱신,
// data-io.js 스냅샷/백업 날짜 표기 등 날짜 문자열이 필요한 곳 전반에서 호출된다.
function localDateStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

