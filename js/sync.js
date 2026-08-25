// 서버(KV) 저장/로드와 잠금화면 — 암호화 계층 포함
// ==================== 🔐 암호화 (AES-256-GCM + PBKDF2) ====================
// GitHub 같은 공개 저장소에 자산 데이터를 안전하게 올리기 위한 브라우저 내장 암호화.
// 복호화는 전적으로 브라우저 안에서만, 비밀번호 입력 시에만 일어남.
async function _deriveKey(password, salt, iter) {
  const enc = new TextEncoder();
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
  );
}
function _b64(buf) {
  const b = new Uint8Array(buf); let s = ''; const CH = 0x8000;
  for (let i = 0; i < b.length; i += CH) s += String.fromCharCode.apply(null, b.subarray(i, i + CH));
  return btoa(s);
}
function _unb64(str) { return Uint8Array.from(atob(str), c => c.charCodeAt(0)); }

async function encryptData(plainText, password) {
  const iter = 250000;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await _deriveKey(password, salt, iter);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plainText));
  return { v: 1, alg: 'AES-256-GCM', kdf: 'PBKDF2-SHA256', iter, salt: _b64(salt), iv: _b64(iv), ct: _b64(ct) };
}
async function decryptData(obj, password) {
  const salt = _unb64(obj.salt), iv = _unb64(obj.iv), ct = _unb64(obj.ct);
  const key = await _deriveKey(password, salt, obj.iter || 250000);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return new TextDecoder().decode(pt);
}

// 현재 데이터를 암호화한 portfolio.enc 다운로드 (서버 장애·비번 분실 대비 비상 백업)
async function exportEncrypted() {
  const hasData = state.holdings && state.holdings.some(h => h.name || h.price || h.priceUSD);
  if (!hasData) {
    alert('내보낼 데이터가 없습니다.\n먼저 "📂 JSON에서 복원"으로 최신 백업을 불러온 뒤 다시 시도하세요.');
    return;
  }
  const pw = prompt('암호화 비밀번호를 입력하세요.\n(긴 패스프레이즈 권장 — 15자 이상, 예: 단어 5~6개 조합)');
  if (!pw) return;
  const pw2 = prompt('확인을 위해 비밀번호를 한 번 더 입력하세요.');
  if (pw !== pw2) { alert('비밀번호가 일치하지 않습니다. 다시 시도하세요.'); return; }
  if (pw.length < 10 && !confirm('⚠️ 비밀번호가 짧습니다 (' + pw.length + '자). 공개 저장소에서는 오프라인 크래킹 위험이 있어요.\n그래도 진행할까요?')) return;
  try {
    state.lastUpdated = localDateStr();
    const blobObj = await encryptData(JSON.stringify(state), pw);
    const out = JSON.stringify(blobObj);
    const blob = new Blob([out], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'portfolio.enc'; a.style.display = 'none';
    document.body.appendChild(a); a.click();
    setTimeout(() => { try { document.body.removeChild(a); } catch (_) {} URL.revokeObjectURL(url); }, 1000);
    toast('🔐 portfolio.enc 생성 완료 — 비상 백업용으로 안전한 곳에 보관하세요');
  } catch (err) {
    console.error('[Encrypt] 에러:', err);
    alert('암호화 실패: ' + err.message);
  }
}
window.exportEncrypted = exportEncrypted;
window.encryptData = encryptData;
window.decryptData = decryptData;

// ==================== ☁️ 서버 저장 (Cloudflare KV — 인증은 Access가 전담) ====================
// 비밀번호는 복호화 성공 시 이 기기 localStorage('pf_pw')에 기억 → 저장/로드 모두 무프롬프트.
// 신뢰 기기의 localStorage엔 이미 평문 state가 있으므로 보안 수준은 동일하다.
async function savePortfolio() {
  const hasData = state.holdings && state.holdings.some(h => h.name || h.price || h.priceUSD);
  if (!hasData) { alert('저장할 데이터가 없습니다.'); return; }
  let pw = localStorage.getItem('pf_pw');
  if (!pw) {
    const p1 = prompt('암호화 비밀번호\n(사이트 접속 시 쓰는 비번과 동일해야 합니다)');
    if (!p1) return;
    const p2 = prompt('확인을 위해 비밀번호를 한 번 더 입력하세요.');
    if (p1 !== p2) { alert('비밀번호가 일치하지 않습니다. 취소되었습니다.'); return; }
    pw = p1;
    localStorage.setItem('pf_pw', pw);
  }
  try {
    state.lastUpdated = localDateStr();
    const blobObj = await encryptData(JSON.stringify(state), pw);
    const res = await fetch('/api/portfolio', { method: 'PUT', body: JSON.stringify(blobObj) });
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
function forgetDevicePassword() {
  localStorage.removeItem('pf_pw');
  toast('🔒 이 기기에서 비밀번호를 지웠습니다 — 다음 접속부터 다시 묻습니다');
  refreshSyncUI();
}
function refreshSyncUI() {
  const st = document.getElementById('syncStatus');
  if (!st) return;
  const pwNote = localStorage.getItem('pf_pw')
    ? '🔑 비번: <b style="color:#22c55e;">이 기기에 기억됨</b>'
    : '🔑 비번: <b style="color:#f59e0b;">기억 안 됨</b> — 저장 시 물어봅니다';
  let saveNote = '';
  if (state.lastServerSaveAt) {
    const dt = new Date(state.lastServerSaveAt);
    saveNote = ' · 마지막 서버 저장: ' + dt.toLocaleString('ko-KR');
  }
  st.innerHTML = pwNote + saveNote + '<br>';
}
window.savePortfolio = savePortfolio;
window.forgetDevicePassword = forgetDevicePassword;
window.refreshSyncUI = refreshSyncUI;

// 잠금 화면 DOM을 동적으로 생성 (스크립트가 body 끝에서 실행되므로 JS로 주입)
function _buildGate() {
  if (document.getElementById('unlockGate')) return document.getElementById('unlockGate');
  const div = document.createElement('div');
  div.id = 'unlockGate';
  div.style.cssText = 'display:none;position:fixed;inset:0;z-index:99999;background:#0f1117;color:#e5e7eb;flex-direction:column;align-items:center;justify-content:center;font-family:system-ui,-apple-system,sans-serif;padding:20px;';
  div.innerHTML =
    '<div style="max-width:360px;width:100%;text-align:center;">' +
      '<div style="font-size:40px;margin-bottom:12px;">🔐</div>' +
      '<div style="font-size:19px;font-weight:700;margin-bottom:6px;">자산 포트폴리오</div>' +
      '<div style="font-size:13px;color:#9ca3af;margin-bottom:20px;">비밀번호를 입력하면 데이터를 복호화합니다.<br>복호화는 이 브라우저 안에서만 이뤄집니다.</div>' +
      '<input id="unlockPw" type="password" placeholder="비밀번호" autocomplete="current-password" ' +
        'style="width:100%;box-sizing:border-box;padding:12px 14px;font-size:15px;border:1px solid #374151;border-radius:10px;background:#1a1d26;color:#e5e7eb;outline:none;margin-bottom:10px;" />' +
      '<label style="display:flex;align-items:center;gap:6px;font-size:13px;color:#9ca3af;margin-bottom:10px;cursor:pointer;">' +
        '<input id="unlockRemember" type="checkbox" checked style="accent-color:#7c3aed;" /> 이 기기에서 기억 (다음부터 안 물어봄)' +
      '</label>' +
      '<button id="unlockBtn" style="width:100%;padding:12px;font-size:15px;font-weight:600;border:none;border-radius:10px;background:#7c3aed;color:#fff;cursor:pointer;">복호화</button>' +
      '<div id="unlockErr" style="min-height:18px;margin-top:10px;font-size:13px;color:#f87171;"></div>' +
    '</div>';
  document.body.appendChild(div);
  return div;
}

// 비밀번호 게이트: 저장된 데이터가 없고 portfolio.enc 가 있으면 잠금 화면 표시
function showUnlockGate(encData) {
  const gate = _buildGate();
  const input = document.getElementById('unlockPw');
  const err = document.getElementById('unlockErr');
  const btn = document.getElementById('unlockBtn');
  gate.style.display = 'flex';
  setTimeout(() => input.focus(), 50);
  async function attempt() {
    if (!input.value) return;
    err.textContent = '';
    btn.disabled = true; btn.textContent = '복호화 중…';
    try {
      const json = await decryptData(encData, input.value);
      const data = JSON.parse(json);
      if (!data.holdings || !Array.isArray(data.holdings)) throw new Error('형식 오류');
      state = migrateState({ ...defaultState(), ...data });
      // "이 기기에서 기억" 체크 시 비번을 localStorage에 저장 → 이후 무프롬프트 자동 복호화.
      // 체크 해제(공용 PC)면 메모리에만 유지 — 새로고침 시 다시 물어봄.
      const remember = document.getElementById('unlockRemember');
      if (remember && remember.checked) localStorage.setItem('pf_pw', input.value);
      gate.style.display = 'none';
      boot();
    } catch (e) {
      err.textContent = '비밀번호가 틀렸거나 데이터가 손상되었습니다.';
      btn.disabled = false; btn.textContent = '복호화';
      input.select();
    }
  }
  btn.onclick = attempt;
  input.onkeydown = (e) => { if (e.key === 'Enter') attempt(); };
}

