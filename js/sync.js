// 서버(KV) 저장/로드 — 인증은 Cloudflare Access(구글/이메일 로그인)가 전담, 데이터는 사용자별로 분리 저장됨
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

function refreshSyncUI() {
  const st = document.getElementById('syncStatus');
  if (!st) return;
  st.innerHTML = state.lastServerSaveAt
    ? '마지막 서버 저장: ' + new Date(state.lastServerSaveAt).toLocaleString('ko-KR') + '<br>'
    : '아직 서버에 저장한 적 없음 — 한 번 저장하면 다른 기기에서도 보입니다<br>';
}

window.savePortfolio = savePortfolio;
window.refreshSyncUI = refreshSyncUI;
