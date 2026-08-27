// ============================================================================
// 증권사 API 키 등록/조회/삭제 — /api/broker-keys
// 키는 portfolio 데이터와 동일한 규약으로 KV `user:<이메일>:broker:keys` 에
// JSON 저장된다 (사용자 결정: 저장 구조 일관성 — 사용자 간 구조적 격리,
// 친구도 자기 키를 등록하면 자기 계좌를 동기화할 수 있는 구조).
// 클라이언트 상대는 설정 탭의 "🔑 증권사 API 키" 카드(js/broker.js).
// [보안]
//  - GET 은 등록 여부 + 앞 4자 마스킹만 반환 — 저장된 키 원본은 어떤 API로도
//    다시 내보내지 않는다 (열람 경로 차단).
//  - KV 평문 저장은 portfolio 와 동일한 신뢰 모델(README 고지: 계정 운영자는
//    열람 가능). 그 이상이 필요하면 봉투 암호화를 후속으로.
//  - 저장/삭제 시 파생물(접근 토큰 캐시)도 함께 삭제해 낡은 토큰이 남지 않게 한다.
// [필드] kisAppkey / kisAppsecret / kisCano / kwAppkey / kwSecretkey /
//        bithumbKey / bithumbSecret — 부분 등록 허용 (등록된 증권사만 동기화됨).
// ============================================================================
import { getVerifiedEmail } from '../_lib/access.js';

const FIELDS = ['kisAppkey', 'kisAppsecret', 'kisCano', 'kwAppkey', 'kwSecretkey', 'bithumbKey', 'bithumbSecret'];
const keyOf = (email) => `user:${email}:broker:keys`;

// 저장·삭제 시 무효화할 토큰 캐시 키 (broker.js 의 캐시 규약과 일치해야 함)
const tokenCacheKeys = (email) => [
  `user:${email}:broker:kis:token`,
  `user:${email}:broker:kw:token`,
];

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

// GET — 등록 상태 조회. 값 원본은 절대 반환하지 않고 앞 4자 + 길이만 준다.
export async function onRequestGet({ request, env }) {
  const email = await getVerifiedEmail(request);
  if (!email) return new Response('unauthenticated', { status: 401 });
  const raw = await env.KV.get(keyOf(email));
  if (!raw) return json({ ok: true, registered: false, fields: {} });
  let keys;
  try { keys = JSON.parse(raw); } catch { keys = {}; }
  const fields = {};
  for (const f of FIELDS) {
    const v = String(keys[f] || '');
    fields[f] = v ? `${v.slice(0, 4)}… (${v.length}자)` : '';
  }
  return json({ ok: true, registered: true, fields });
}

// PUT — 키 저장. 보낸 필드만 갱신(빈 문자열은 해당 필드 삭제)하고 나머지는 유지 —
// 증권사별로 나눠 등록해도 된다. 저장 후 토큰 캐시를 비워 새 키로 재발급되게 한다.
export async function onRequestPut({ request, env }) {
  const email = await getVerifiedEmail(request);
  if (!email) return new Response('unauthenticated', { status: 401 });
  let body;
  try { body = await request.json(); } catch { body = null; }
  if (!body || typeof body !== 'object') {
    return new Response('invalid body: expected key object', { status: 400 });
  }
  const raw = await env.KV.get(keyOf(email));
  let keys = {};
  try { keys = raw ? JSON.parse(raw) : {}; } catch { keys = {}; }
  for (const f of FIELDS) {
    if (!(f in body)) continue;
    const v = String(body[f] || '').trim();
    if (v) keys[f] = v;
    else delete keys[f];
  }
  await env.KV.put(keyOf(email), JSON.stringify(keys));
  for (const k of tokenCacheKeys(email)) await env.KV.delete(k);
  return json({ ok: true });
}

// DELETE — 키 전체 삭제 (토큰 캐시 포함).
export async function onRequestDelete({ request, env }) {
  const email = await getVerifiedEmail(request);
  if (!email) return new Response('unauthenticated', { status: 401 });
  await env.KV.delete(keyOf(email));
  for (const k of tokenCacheKeys(email)) await env.KV.delete(k);
  return json({ ok: true });
}
