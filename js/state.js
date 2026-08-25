// 상태(state) 관리 — 기본값·localStorage 로드/저장·마이그레이션·메모 헬퍼
// ==================== 상태 관리 ====================
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

let state = loadState() || defaultState();

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return migrateState(parsed);
  } catch (e) { return null; }
}

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

function saveState() {
  state.lastUpdated = localDateStr();
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
}

function uid() { return Math.random().toString(36).slice(2, 10); }

// ==================== 메모 헬퍼 ====================
// 종목명 메모는 정규화된 종목명(소문자·trim) 기준으로 저장. 같은 종목을 다계좌에 분산해도 메모는 공유.
function memoKey(name) {
  return (name || '').trim().toLowerCase();
}
function getHoldingMemo(name) {
  if (!state.holdingMemos) return '';
  return state.holdingMemos[memoKey(name)] || '';
}
function setHoldingMemo(name, text) {
  if (!state.holdingMemos) state.holdingMemos = {};
  const key = memoKey(name);
  if (!key) return;
  const v = (text || '').trim();
  if (v) state.holdingMemos[key] = v;
  else delete state.holdingMemos[key];
}
function getSnapshotMemo(id) {
  const s = state.history.find(h => h.id === id);
  return (s && s.memo) ? s.memo : '';
}
function setSnapshotMemo(id, text) {
  const s = state.history.find(h => h.id === id);
  if (!s) return;
  const v = (text || '').trim();
  if (v) s.memo = v;
  else delete s.memo;
}
// HTML escaping in tooltips (Chart.js text-only) → \n 보존, 단지 escapeHtml
function memoFirstLine(text, maxLen = 80) {
  if (!text) return '';
  const line = text.split(/\r?\n/)[0];
  return line.length > maxLen ? line.slice(0, maxLen - 1) + '…' : line;
}

// 공용 메모 편집 모달 — kind: 'holding' | 'snapshot', target: name 또는 snapshotId
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

