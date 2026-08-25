// 앱 시작점 — 전역 노출·boot·bootstrap 실행
// ==================== 시작 ====================
// 인라인 onclick에서 호출 가능하도록 window 에 명시적 노출 (스코프 안전망)
window.exportJSON = exportJSON;
window.importJSON = importJSON;
window.snapshot = snapshot;
window.resetAll = resetAll;
window.fetchExchangeRate = fetchExchangeRate;
window.refreshAllPrices = refreshAllPrices;
window.generateDummyHistory = generateDummyHistory;
window.switchTab = switchTab;
// 진단용 - 콘솔에서 API 직접 테스트
window.fetchUSCPI = fetchUSCPI;
window.fetchM2 = fetchM2;
window._state = () => state;

// file:// 프로토콜 감지 시 안내 배너 표시
if (location.protocol === 'file:') {
  const warn = document.getElementById('fileWarn');
  if (warn) warn.style.display = 'block';
}

function boot() {
  initTabs();
  render();
  updateFxBadge();
  if (typeof refreshSyncUI === 'function') refreshSyncUI(); // ☁️ 서버 저장 상태 표시
  // 페이지 로드 시 환율 자동 갱신 (rateUpdatedAt이 1시간 이상 지났거나 비어있으면)
  const stale = !state.rateUpdatedAt
    || (Date.now() - new Date(state.rateUpdatedAt).getTime()) > 3600 * 1000;
  if (stale) fetchExchangeRate(false);
}

async function bootstrap() {
  localStorage.removeItem('pf_pw'); // 구 암호화 체제의 잔여 비번 일회성 청소
  const hadSaved = localStorage.getItem(STORAGE_KEY) !== null;
  if (hadSaved) { boot(); return; }               // 이 기기에 데이터 있음 → 그대로
  if (location.protocol === 'file:') { boot(); return; } // 로컬 파일은 fetch 불가
  // 새 기기: 서버(KV)에서 내 데이터 로드 — 누구의 데이터인지는 Access 로그인이 결정
  try {
    const res = await fetch('/api/portfolio', { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      if (data.holdings && Array.isArray(data.holdings)) {
        state = migrateState({ ...defaultState(), ...data });
        saveState(); // 이 기기에 캐시 — 접근 통제는 Access 로그인이 담당
      }
    }
  } catch (_) {}
  boot(); // 서버에 데이터가 없으면(신규 사용자) 빈 포트폴리오로 시작
}

bootstrap();
