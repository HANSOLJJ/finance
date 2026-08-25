// 포트폴리오 state를 사용자별로 KV에 저장/조회하는 Pages Function
// 인증·신원은 Cloudflare Access가 전담 — 통과한 요청에만 인증 이메일 헤더가 붙는다.
const MAX_BYTES = 5 * 1024 * 1024; // 5MB 상한 (현재 데이터 ~90KB)

// Access가 엣지에서 붙여주는 인증된 사용자 이메일 (클라이언트가 위조 불가)
function userEmail(request) {
  return request.headers.get('Cf-Access-Authenticated-User-Email') || '';
}

export async function onRequestGet({ request, env }) {
  const email = userEmail(request);
  if (!email) return new Response('unauthenticated', { status: 401 });
  const version = new URL(request.url).searchParams.get('version');
  const key = version
    ? `user:${email}:portfolio:v:${version}`
    : `user:${email}:portfolio:latest`;
  const data = await env.KV.get(key);
  if (data === null) return new Response('not found', { status: 404 });
  return new Response(data, { headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestPut({ request, env }) {
  const email = userEmail(request);
  if (!email) return new Response('unauthenticated', { status: 401 });
  const body = await request.text();
  if (new TextEncoder().encode(body).length > MAX_BYTES) {
    return new Response('too large', { status: 413 });
  }
  // 앱 state 형태인지 확인 — 깨진 데이터로 덮어쓰기 방지
  let state;
  try { state = JSON.parse(body); } catch { state = null; }
  if (!state || !Array.isArray(state.holdings)) {
    return new Response('invalid body: expected app state', { status: 400 });
  }
  const kstDate = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  await env.KV.put(`user:${email}:portfolio:latest`, body);
  // 날짜별 버전 (롤백용, 90일 자동 만료 — 같은 날 여러 번 저장하면 마지막 것만 남음)
  await env.KV.put(`user:${email}:portfolio:v:${kstDate}`, body, { expirationTtl: 90 * 24 * 3600 });
  return new Response(JSON.stringify({ ok: true, version: kstDate }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
