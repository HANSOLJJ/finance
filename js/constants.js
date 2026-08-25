// 카테고리·자산타입·색상·목표 비중 등 앱 전역 상수 정의
// ==================== 상수 ====================
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

const CATEGORY_MAP = Object.fromEntries(CATEGORIES.map(c => [c.key, c]));
const ASSET_TYPES = ['현금', '주식', '채권', '금', '원자재', '부동산', '암호화폐'];
const ASSET_TYPE_COLORS = {
  '현금': '#16a34a', '주식': '#2563eb', '채권': '#0d9488',
  '금': '#eab308', '원자재': '#a16207', '부동산': '#7c3aed', '암호화폐': '#ec4899',
};
const ASSET_TYPE_CLS = {
  '현금': 'asset-cash', '주식': 'asset-stock', '채권': 'asset-bond',
  '금': 'asset-gold', '원자재': 'asset-commodity', '부동산': 'asset-realestate', '암호화폐': 'asset-crypto',
};
// 트리맵/도넛 전용 의사(pseudo) 타입: 달러 현금을 원화 현금과 같은 초록 계열, 명도만 다르게 구별
ASSET_TYPE_COLORS['현금($)'] = '#2dd4bf';

const CATEGORY_COLORS = {
  '현금': '#16a34a', '국내주식': '#2563eb', '해외주식': '#0ea5e9', '암호화폐': '#f59e0b',
  '연금저축펀드': '#94a3b8', '퇴직연금': '#6366f1', 'ISA': '#f97316', '금': '#eab308',
  '부동산': '#7c3aed',
};

// 통화노출: 원화 / 달러(노출) / 달러헤지(금·실물)
// 금은 달러 자체 노출과 다른 role (달러 약세시 오히려 상승) → 별도 분리
const EXPOSURES = ['원화', '달러(노출)', '달러헤지'];
const EXPOSURE_COLORS = { '원화': '#16a34a', '달러(노출)': '#2563eb', '달러헤지': '#eab308' };
const EXPOSURE_CLS = { '원화': 'krw', '달러(노출)': 'usd', '달러헤지': 'hedge' };

const DEFAULT_ASSET_TYPE_TARGETS = {
  '현금': 0.05, '주식': 0.30, '채권': 0.10, '금': 0.05, '원자재': 0.05, '부동산': 0.35, '암호화폐': 0.10,
};
const DEFAULT_EXP_TARGETS = { '원화': 0.55, '달러(노출)': 0.40, '달러헤지': 0.05 };

const DEFAULT_EXPOSURE_BY_CAT = {
  '현금': '원화', '국내주식': '원화', '해외주식': '달러(노출)', '암호화폐': '달러(노출)',
  '연금저축펀드': '원화', '퇴직연금': '원화', 'ISA': '원화', '금': '달러헤지',
  '부동산': '원화',
};

// 카테고리별 유동성 기본값
// 'liquid': 즉시 인출/매도 가능
// 'locked': 제도/제약으로 묶임 (연금/ISA 만기/주택청약/부동산 등)
// 행별로 사용자가 override 가능 (예: 같은 현금 카테고리에서 주택청약/보험만 locked)
const DEFAULT_LIQUIDITY_BY_CAT = {
  '현금': 'liquid', '국내주식': 'liquid', '해외주식': 'liquid', '암호화폐': 'liquid', '금': 'liquid',
  '연금저축펀드': 'locked', '퇴직연금': 'locked', 'ISA': 'locked', '부동산': 'locked',
};

const STORAGE_KEY = 'portfolio_state_v1';

// 로컬(KST 등) 시간대 기준 YYYY-MM-DD. toISOString()은 UTC라
// KST 오전 9시 이전엔 전날 날짜가 나오는 버그가 있어 이 함수를 씀.
function localDateStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

