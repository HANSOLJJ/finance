// ============================================================================
// 서버(KV) 저장 — PUT /api/portfolio 로 현재 state 전체를 업로드한다.
// 인증은 Cloudflare Access(구글/이메일 로그인)가 엣지에서 전담하므로 이 코드는
// 토큰·비밀번호를 다루지 않으며, 누구의 데이터로 저장될지는 Access 세션이 결정
// (functions/api/portfolio.js 가 Access 헤더의 이메일로 사용자별 KV 키 분리).
// 서버에서 내려받는 방향(GET)은 main.js bootstrap()이 담당 — 여기는 업로드 전용.
// 로드 순서 constants→state→calc→render→charts→data-io→fetch→sync→main 중
// 여덟 번째 — state.js 의 state/saveState, render.js 계열 UI 갱신 함수에 의존.
// ============================================================================
// 서버 저장 버튼 핸들러 — 빈 상태 업로드를 막고, 성공 시 lastServerSaveAt 를
// 기록해 localStorage 에도 반영한 뒤 설정 탭·동기화 표시줄을 갱신한다.
// file:// 등 /api 가 없는 환경에서는 404 안내 메시지를 붙여 알려준다.
async function savePortfolio() {
  const hasData = state.holdings && state.holdings.some(h => h.name || h.price || h.priceUSD);
  if (!hasData) { alert('저장할 데이터가 없습니다.'); return; }
  try {
    state.lastUpdated = localDateStr();
    const res = await fetch('/api/portfolio', { method: 'PUT', body: JSON.stringify(state) });
    if (!res.ok) {
      const hint = res.status === 404 ? ' — 이 환경엔 /api 서버가 없습니다 (배포 사이트에서 저장하세요)' : '';
      throw new Error('HTTP ' + res.status + hint);
    }
    state.lastServerSaveAt = new Date().toISOString();
    saveState();
    renderSettings();
    refreshSyncUI();
    toast('☁️ 서버에 저장됨 — 즉시 반영');
  } catch (err) {
    console.error('[Save] 에러:', err);
    alert('서버 저장 실패:\n' + err.message);
  }
}

// 동기화 상태 표시줄(#syncStatus) 갱신 — 마지막 서버 저장 시각을 보여주고,
// 한 번도 저장한 적 없으면 다른 기기 연동 안내 문구를 띄운다.
// boot()·savePortfolio() 성공 직후에 호출되며 해당 요소가 없으면 조용히 통과.
function refreshSyncUI() {
  const st = document.getElementById('syncStatus');
  if (!st) return;
  st.innerHTML = state.lastServerSaveAt
    ? '마지막 서버 저장: ' + new Date(state.lastServerSaveAt).toLocaleString('ko-KR') + '<br>'
    : '아직 서버에 저장한 적 없음 — 한 번 저장하면 다른 기기에서도 보입니다<br>';
}

// 인라인 onclick 과 main.js boot()에서 접근할 수 있도록 전역 노출.
window.savePortfolio = savePortfolio;
window.refreshSyncUI = refreshSyncUI;
