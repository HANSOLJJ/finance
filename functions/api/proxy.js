// 시세 CORS 프록시 Pages Function — 화이트리스트 도메인만 대신 fetch (구 Cloudflare Worker 로직 이식)
const ALLOW = [
  'query1.finance.yahoo.com',
  'query2.finance.yahoo.com',
  'm.stock.naver.com',
  'api.stlouisfed.org',
  'api.bls.gov',
  'api.frankfurter.app',
  'api.coingecko.com',
  'api.bithumb.com',
  'api.upbit.com',
  'data.krx.co.kr',
];

export async function onRequest({ request, env }) {
  if (request.method !== 'GET' && request.method !== 'POST') {
    return new Response('method not allowed', { status: 405 });
  }
  const target = new URL(request.url).searchParams.get('url');
  if (!target) return new Response('missing url', { status: 400 });
  let t;
  try { t = new URL(target); } catch { return new Response('bad url', { status: 400 }); }
  if (!ALLOW.includes(t.hostname)) return new Response('host not allowed', { status: 403 });

  // FRED 요청에 서버 보관 키 주입 — 브라우저마다 localStorage에 키를 등록할 필요 제거
  if (t.hostname === 'api.stlouisfed.org' && env.FRED_API_KEY && !t.searchParams.get('api_key')) {
    t.searchParams.set('api_key', env.FRED_API_KEY);
  }

  const init = { method: request.method, headers: { 'User-Agent': 'Mozilla/5.0' } };
  if (request.method === 'POST') {
    init.body = await request.text();
    init.headers['Content-Type'] = request.headers.get('Content-Type') || 'application/json';
  }
  const resp = await fetch(t.toString(), init);
  return new Response(resp.body, {
    status: resp.status,
    headers: { 'Content-Type': resp.headers.get('Content-Type') || 'application/json' },
  });
}
