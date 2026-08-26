// ============================================================================
// 시세 CORS 프록시 Cloudflare Pages Function (구 Cloudflare Worker 로직 이식).
// 브라우저가 CORS 때문에 직접 못 부르는 시세·지표 API(야후·네이버·FRED·KRX 등)를
// GET/POST /api/proxy?url=<대상> 형태로 대신 fetch 해준다. 호출부는 js/fetch.js.
// [보안 맥락] url 파라미터를 그대로 fetch 하면 임의 서버로의 SSRF·오픈 프록시가
// 되므로, 아래 ALLOW 화이트리스트에 있는 호스트명만 허용하고 나머지는 403.
// 이 엔드포인트 역시 Cloudflare Access 뒤에 있어 외부인이 프록시를 남용할 수 없다.
// FRED 요청에는 서버 환경변수의 API 키를 주입 — 키를 클라이언트 코드/localStorage
// 에 두지 않기 위한 설계다 (상세는 아래 주입 지점 주석 참고).
// ============================================================================
// 프록시가 대신 호출해줄 수 있는 호스트명 화이트리스트.
// 여기 없는 도메인은 무조건 403 — 새 시세 소스를 붙일 때만 신중히 추가할 것.
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

// 모든 메서드 공용 핸들러 — GET/POST 만 받고 url 파라미터를 URL 로 파싱해
// 호스트명 기준으로 화이트리스트를 검사한 뒤 대상 API 로 중계한다.
// User-Agent 를 브라우저처럼 위장하는 이유는 일부 시세 API(야후 등)가
// 기본 fetch UA 를 봇으로 보고 차단하기 때문이다.
export async function onRequest({ request, env }) {
  if (request.method !== 'GET' && request.method !== 'POST') {
    return new Response('method not allowed', { status: 405 });
  }
  const target = new URL(request.url).searchParams.get('url');
  if (!target) return new Response('missing url', { status: 400 });
  let t;
  try { t = new URL(target); } catch { return new Response('bad url', { status: 400 }); }
  if (!ALLOW.includes(t.hostname)) return new Response('host not allowed', { status: 403 });

  // FRED 요청에 서버 보관 키(env.FRED_API_KEY) 주입 — 키를 클라이언트에 노출하지
  // 않고, 브라우저마다 localStorage에 키를 등록할 필요도 제거한다.
  // 요청에 이미 api_key 가 붙어 있으면 존중하고 덮어쓰지 않는다.
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
