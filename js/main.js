// ============================================================================
// 앱 시작점(부트스트랩) — 전역 노출·boot·bootstrap 실행.
// 데이터는 서버(KV)에서만 로드한다(서버 단일 소스 — localStorage 캐시 없음).
// 404 는 신규 사용자(빈 상태)로 취급하고, 그 외 실패 시에는 자동 저장을 잠근 채
// (#bootFailBanner) 재시도만 안내한다 — 빈 화면이 자동 저장으로 서버 데이터를
// 덮어쓰는 사고를 막기 위해서다.
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
window.openCashflowModal = openCashflowModal;
window.resetAll = resetAll;
window.fetchExchangeRate = fetchExchangeRate;
window.refreshAllPrices = refreshAllPrices;
window.switchTab = switchTab;
// 진단용 — 브라우저 콘솔에서 시세 API·현재 state 를 직접 확인하기 위한 노출.
// 앱 코드에서는 호출하지 않으며 개발/디버깅 편의 목적이다.
window.fetchUSCPI = fetchUSCPI;
window.fetchM2 = fetchM2;
window._state = () => state;

// file:// 프로토콜 감지 시 안내 배너 표시.
// 서버 단일 소스 구조라 로컬 파일로 열면 데이터 로드·저장이 모두 불가능하다.
if (location.protocol === 'file:') {
  const warn = document.getElementById('fileWarn');
  if (warn) warn.style.display = 'block';
}

// UI 기동 — 탭 초기화, 전체 렌더, 환율 뱃지·동기화 인디케이터 갱신을 한 번에 수행.
// state 가 확정된 뒤에만 호출해야 하며(bootstrap 이 유일한 호출자), 환율이
// 1시간 이상 오래됐으면 백그라운드로 자동 갱신을 시작하는 부수효과가 있다
// (갱신 성공 → saveState → 자동 저장까지 자연히 이어진다).
function boot() {
  initTabs();
  initHelpTapTooltips(); // ? 툴팁 터치(탭) 토글 — 모바일 대응

  render();
  updateFxBadge();
  updateSyncIndicator(); // ☁️ 헤더·설정 탭 동기화 상태 초기 표시
  // 페이지 로드 시 환율 자동 갱신 (rateUpdatedAt이 1시간 이상 지났거나 비어있으면)
  const stale = !state.rateUpdatedAt
    || (Date.now() - new Date(state.rateUpdatedAt).getTime()) > 3600 * 1000;
  if (stale) fetchExchangeRate(false);
}

// 부트 실패 배너 표시 — 자동 저장은 잠긴 채로 두고 새로고침 재시도만 안내한다.
function showBootFail(reason) {
  const banner = document.getElementById('bootFailBanner');
  if (banner) banner.style.display = 'block';
  const msg = document.getElementById('bootFailMsg');
  if (msg) msg.textContent = reason;
}

// 데이터 부트스트랩 — 서버(KV)가 유일한 데이터 원천이다.
// 200: 내 저장본으로 state 교체 / 404: 신규 사용자(빈 상태로 시작) — 이 두 경우만
// 자동 저장 잠금(syncEnabled, sync.js)을 해제한다. 그 외 오류·네트워크 실패는
// 잠금을 유지한 채 배너로 알린다. 어떤 경우에도 화면은 뜬다(boot 는 항상 실행).
// 어느 사용자의 데이터를 받는지는 Cloudflare Access 로그인 세션이 결정한다.
async function bootstrap() {
  // 구 체제 잔재 일회성 청소 — localStorage 캐시와 기기 저장 비번은 더 이상 안 쓴다.
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem('pf_pw');
  } catch (_) {}
  try {
    const res = await fetch('/api/portfolio', { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      if (data && Array.isArray(data.holdings)) {
        state = migrateState({ ...defaultState(), ...data });
      }
      syncEnabled = true;
    } else if (res.status === 404) {
      syncEnabled = true; // 신규 사용자 — 빈 포트폴리오로 시작, 저장 허용
    } else {
      showBootFail('서버 응답 오류 (HTTP ' + res.status + ')');
    }
  } catch (_) {
    showBootFail('서버에 연결하지 못했습니다 — 네트워크 확인 후 새로고침하세요');
  }
  boot();
}

// 스크립트 로드 즉시 실행 — 이 호출이 앱 전체의 유일한 진입점이다.
bootstrap();
