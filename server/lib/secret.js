// 증권사 자격증명(creds) 암·복호화 — AES-256-GCM, 키 파일은 ~/.finance/secret.key (data/ 밖이라 DB 백업에 안 딸려간다).
// 저장 형식 'enc:v1:<base64(iv12 ‖ tag16 ‖ ciphertext)>'. AAD 는 'email|conn_id' — 다른 행의 암호문을 복사해 넣으면 복호 실패.
// 막는 것: DB 파일·백업만 새는 경우. 못 막는 것: 서버가 통째로 털리는 경우(키가 같은 기기에 있어야 하므로 구조적 한계).
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

const PREFIX = 'enc:v1:';

// 키 파일을 읽고, 없으면 생성한다. 형식은 hex 64자 텍스트 — 비밀번호 관리자에 백업하기 위해 바이너리가 아니다.
// 형식이 틀리면 새 키로 덮지 않고 기동 실패시킨다 (덮으면 기존 암호문이 전부 고아가 된다).
// 권한 mode 는 macOS 에서만 의미 있고 Windows 는 무시한다 — 검사하지 않는다.
export function loadOrCreateKey(keyPath) {
  let txt;
  try {
    txt = fs.readFileSync(keyPath, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    fs.mkdirSync(path.dirname(keyPath), { recursive: true, mode: 0o700 });
    const key = randomBytes(32);
    try {
      fs.writeFileSync(keyPath, key.toString('hex') + '\n', { mode: 0o600, flag: 'wx' });
    } catch (e) {
      if (e.code === 'EEXIST') return loadOrCreateKey(keyPath); // 동시 기동 경합 — 먼저 만든 쪽을 읽는다
      throw e;
    }
    console.log(`새 암호화 키 생성됨: ${keyPath} — 비밀번호 관리자에 백업할 것 (분실 시 증권사 연결 재등록 필요)`);
    return key;
  }
  const clean = txt.charCodeAt(0) === 0xFEFF ? txt.slice(1) : txt; // BOM 제거 — PowerShell 로 손수 만든 파일 대비
  const key = Buffer.from(clean.trim(), 'hex');
  if (key.length !== 32) throw new Error(`secret.key 형식 오류: hex 64자를 기대 (${keyPath})`);
  return key;
}

export function encrypt(key, text, aad) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(Buffer.from(aad, 'utf8'));
  const ct = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return PREFIX + Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}

// 실패(접두사 불일치·손상·키 불일치·AAD 불일치)는 전부 throw — 호출부(db.js)가 "재등록 필요"로 흡수한다.
// 평문 통과 분기는 두지 않는다: 실수로 평문이 저장돼도 조용히 동작하면 암호화 누락을 못 잡는다.
export function decrypt(key, stored, aad) {
  if (typeof stored !== 'string' || !stored.startsWith(PREFIX)) throw new Error('unsupported format');
  const buf = Buffer.from(stored.slice(PREFIX.length), 'base64');
  if (buf.length < 28) throw new Error('corrupt');
  const d = createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12));
  d.setAAD(Buffer.from(aad, 'utf8'));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8');
}
