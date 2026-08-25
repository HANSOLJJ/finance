// 포트폴리오 암호문을 KV에 저장/조회하는 Pages Function — 인증은 Cloudflare Access가 앞단에서 전담
const MAX_BYTES = 5 * 1024 * 1024; // 암호문 5MB 상한 (현재 ~70KB)

export async function onRequestGet({ request, env }) {
  const version = new URL(request.url).searchParams.get('version');
  const key = version ? `portfolio:v:${version}` : 'portfolio:latest';
  const data = await env.KV.get(key);
  if (data === null) return new Response('not found', { status: 404 });
  return new Response(data, { headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestPut({ request, env }) {
  const body = await request.text();
  if (new TextEncoder().encode(body).length > MAX_BYTES) {
    return new Response('too large', { status: 413 });
  }
  // encryptData()가 만드는 blob 형태({salt, iv, ct})인지 확인 — 평문/깨진 데이터로 덮어쓰기 방지
  let blob;
  try { blob = JSON.parse(body); } catch { blob = null; }
  if (!blob || typeof blob.ct !== 'string' || typeof blob.salt !== 'string' || typeof blob.iv !== 'string') {
    return new Response('invalid body: expected encrypted blob', { status: 400 });
  }
  const kstDate = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  await env.KV.put('portfolio:latest', body);
  // 날짜별 버전 (롤백용, 90일 자동 만료 — 같은 날 여러 번 저장하면 그날의 마지막 것만 남음)
  await env.KV.put(`portfolio:v:${kstDate}`, body, { expirationTtl: 90 * 24 * 3600 });
  return new Response(JSON.stringify({ ok: true, version: kstDate }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
