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
  const hadSaved = localStorage.getItem(STORAGE_KEY) !== null;
  if (hadSaved) { boot(); return; }               // 내 PC(기존 데이터) → 그대로
  if (location.protocol === 'file:') { boot(); return; } // 로컬 파일은 fetch 불가
  // 신규 기기: 서버(KV)에서 암호문 로드 → 기억된 비번 있으면 무프롬프트, 없으면 잠금 화면
  const gate = _buildGate();
  gate.style.display = 'flex'; // 깜빡임 방지용 선표시
  let encData = null;
  try {
    const res = await fetch('/api/portfolio', { cache: 'no-store' });
    if (res.ok) encData = await res.json();
  } catch (_) {}
  if (!encData) { gate.style.display = 'none'; boot(); return; }
  const savedPw = localStorage.getItem('pf_pw');
  if (savedPw) {
    try {
      const data = JSON.parse(await decryptData(encData, savedPw));
      if (data.holdings && Array.isArray(data.holdings)) {
        state = migrateState({ ...defaultState(), ...data });
        gate.style.display = 'none';
        boot();
        return;
      }
    } catch (_) {
      localStorage.removeItem('pf_pw'); // 비번이 바뀐 경우 — 기억 폐기 후 잠금 화면으로
    }
  }
  showUnlockGate(encData);
}

bootstrap();
