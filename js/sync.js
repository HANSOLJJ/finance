// ============================================================================
// 서버(KV) 자동 저장 — state 변경을 PUT /api/portfolio 로 업로드한다.
// 트리거는 "변경"이다. 모든 편집 핸들러가 부르는 saveState()(state.js)가
// scheduleServerSave()를 호출하고, 마지막 변경 후 2초 조용하면 업로드 1회로
// 묶인다(디바운스 — 주기 타이머가 아니라 타이핑 연타를 합치는 장치).
// 시세 갱신·JSON 복원처럼 완료 시점이 명확한 곳은 flushServerSave()로 즉시 저장.
// 부트(서버 로드)가 성공하기 전에는 syncEnabled=false 로 잠가, 빈 state 가
// 서버 데이터를 덮는 사고를 막는다 (잠금 해제는 main.js bootstrap 이 수행).
// 인증은 Cloudflare Access 가 엣지에서 전담 — 누구의 데이터로 저장될지는 로그인이 결정.
// 로드 순서 constants→state→calc→render→charts→data-io→fetch→sync→main 중
// 여덟 번째 — state.js 의 state, data-io.js 의 toast 에 의존한다.
// ============================================================================

// 자동 저장 잠금 — 서버 로드(200/404)가 확인되기 전까지 false. main.js 가 해제한다.
let syncEnabled = false;
// 마지막으로 업로드에 성공한 JSON 문자열 — 내용이 같으면 업로드를 건너뛴다(KV 쓰기 절약).
let _lastUploadedJson = null;
// 디바운스 타이머와 현재 저장 상태 ('idle' | 'saving' | 'saved' | 'error').
let _saveTimer = null;
let _syncState = 'idle';

// 변경 발생 시 saveState()가 부르는 예약 함수 — 마지막 변경 후 2초 조용하면 업로드.
// 연달아 불리면 타이머가 계속 뒤로 밀리므로 타이핑 중에는 통신이 일어나지 않는다.
function scheduleServerSave() {
  if (!syncEnabled) return;
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => { flushServerSave(); }, 2000);
}

// 밀린 변경을 즉시 업로드한다. 직전 업로드와 내용이 같으면 통신 없이 끝낸다.
// 성공 시 lastServerSaveAt 을 갱신하고, 실패해도 state 는 유지되므로 다음
// 변경(또는 인디케이터 클릭)에서 자연히 재시도된다.
async function flushServerSave() {
  if (!syncEnabled) return;
  clearTimeout(_saveTimer);
  const json = JSON.stringify(state);
  if (json === _lastUploadedJson) return;
  _syncState = 'saving';
  updateSyncIndicator();
  try {
    const res = await fetch('/api/portfolio', { method: 'PUT', body: json });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    state.lastServerSaveAt = new Date().toISOString();
    // 비교 기준은 lastServerSaveAt 갱신 후의 최종 state 로 잡는다 — 타임스탬프
    // 변경만으로 다음 플러시가 "변경 있음"으로 오판해 재업로드하는 루프 방지.
    _lastUploadedJson = JSON.stringify(state);
    _syncState = 'saved';
  } catch (err) {
    console.error('[Sync] 자동 저장 실패:', err);
    _syncState = 'error';
  }
  updateSyncIndicator();
}

// 수동 즉시 저장 — 설정 탭 버튼과 헤더 인디케이터 클릭용. 결과를 토스트로 알린다.
async function savePortfolio() {
  if (!syncEnabled) {
    alert('서버 연결이 안 된 상태라 저장할 수 없습니다.\n새로고침 후 다시 시도하세요.');
    return;
  }
  await flushServerSave();
  if (_syncState === 'error') alert('서버 저장 실패 — 네트워크 상태를 확인하세요.');
  else toast('☁️ 서버에 저장됨');
}

// 헤더(#syncIndicator)와 설정 탭(#syncStatus)의 동기화 상태 표시를 갱신한다.
// 색상 구분은 css 의 .sync-indicator.ok / .err 클래스가 담당한다.
function updateSyncIndicator() {
  let text, cls;
  if (!syncEnabled) { text = '🔒 서버 연결 안 됨'; cls = 'err'; }
  else if (_syncState === 'saving') { text = '☁️ 저장 중…'; cls = ''; }
  else if (_syncState === 'error') { text = '⚠️ 저장 실패 — 클릭해 재시도'; cls = 'err'; }
  else if (state.lastServerSaveAt) {
    const t = new Date(state.lastServerSaveAt)
      .toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
    text = '☁️ 저장됨 ' + t; cls = 'ok';
  } else { text = '☁️ 자동 저장 대기'; cls = ''; }
  const el = document.getElementById('syncIndicator');
  if (el) { el.textContent = text; el.className = 'sync-indicator ' + cls; }
  const st = document.getElementById('syncStatus');
  if (st) {
    st.textContent = state.lastServerSaveAt
      ? '마지막 서버 저장: ' + new Date(state.lastServerSaveAt).toLocaleString('ko-KR')
      : '아직 서버에 저장된 내용이 없습니다 — 값을 수정하면 자동 저장됩니다';
  }
}

// 탭 전환·창 최소화 시 밀린 변경을 즉시 플러시 — 탭이 닫히기 전 마지막 기회다.
// (탭을 그대로 종료하면 마지막 ~2초 내 변경은 유실될 수 있음 — 합의된 한계)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushServerSave();
});

// 인라인 onclick 에서 접근할 수 있도록 전역 노출.
window.savePortfolio = savePortfolio;
