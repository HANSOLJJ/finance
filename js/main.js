// ============================================================================
// 앱 시작점(부트스트랩) — 전역 노출·boot·bootstrap 실행.
// 데이터 로드 우선순위는 localStorage 우선, 이 기기에 저장본이 없을 때만
// GET /api/portfolio 로 서버(KV) 데이터를 받아와 migrateState 후 캐시한다.
// 서버에도 없으면(신규 사용자·미배포 환경) 빈 포트폴리오로 시작한다.
// 로드 순서 constants→state→calc→render→charts→data-io→fetch→sync→main 의
// 마지막 파일 — 앞선 모든 파일의 전역 함수가 정의된 뒤에 실행돼야 하므로
// index.html 의 script 태그 순서상 항상 맨 끝이어야 한다.
// ============================================================================
// ==================== 시작 ====================
// 인라인 onclick에서 호출 가능하도록 window 에 명시적 노출 (스코프 안전망).
// 실제 함수 정의는 data-io.js·fetch.js·render.js 에 있고 여기서는 참조만 건다.
window.exportJSON = exportJSON;
window.importJSON = importJSON;
window.snapshot = snapshot;
window.resetAll = resetAll;
window.fetchExchangeRate = fetchExchangeRate;
window.refreshAllPrices = refreshAllPrices;
window.generateDummyHistory = generateDummyHistory;
window.switchTab = switchTab;
// 진단용 — 브라우저 콘솔에서 시세 API·현재 state 를 직접 확인하기 위한 노출.
// 앱 코드에서는 호출하지 않으며 개발/디버깅 편의 목적이다.
window.fetchUSCPI = fetchUSCPI;
window.fetchM2 = fetchM2;
window._state = () => state;

// file:// 프로토콜 감지 시 안내 배너 표시.
// 로컬 파일로 열면 /api 프록시·서버 저장이 모두 동작하지 않으므로 미리 경고한다.
if (location.protocol === 'file:') {
  const warn = document.getElementById('fileWarn');
  if (warn) warn.style.display = 'block';
}

// UI 기동 — 탭 초기화, 전체 렌더, 환율 뱃지·동기화 표시줄 갱신을 한 번에 수행.
// state 가 확정된 뒤에만 호출해야 하며(bootstrap 이 유일한 호출자), 환율이
// 1시간 이상 오래됐으면 백그라운드로 자동 갱신을 시작하는 부수효과가 있다.
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

// 데이터 부트스트랩 — localStorage 저장본이 있으면 그대로 boot(), 없을 때만
// 서버(KV)에서 GET /api/portfolio 로 내 데이터를 받아 migrateState 후 이 기기에
// 캐시하고 boot() 한다. 네트워크·파싱 실패는 조용히 무시하고 빈 상태로 시작.
// 어느 사용자의 데이터를 받는지는 Cloudflare Access 로그인 세션이 결정한다.
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

// 스크립트 로드 즉시 실행 — 이 호출이 앱 전체의 유일한 진입점이다.
bootstrap();
