// /api/proxy — 시세 CORS 프록시 (functions/api/proxy.js 이식판). 화이트리스트 호스트만 GET/POST 중계한다.
// 브라우저가 CORS 때문에 직접 못 부르는 시세·지표 API(야후·네이버·FRED·KRX 등)를 대신 fetch 한다. 호출부는 js/fetch.js.
// [보안 맥락] url 파라미터를 그대로 fetch 하면 임의 서버로의 SSRF·오픈 프록시가 되므로 ALLOW 호스트명만 허용하고
// 나머지는 403. 원본대로 인증 게이트가 없다 — 그래서 서버는 127.0.0.1 에만 바인드한다(index.js).
// FRED 요청에는 서버 환경변수(~/.finance/env 의 FRED_API_KEY)를 주입해 키를 클라이언트에 두지 않는다.
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Router } from 'express';

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

export default function proxyRoutes() {
  const r = Router();

  // 모든 메서드 공용 — GET/POST 만 받고 url 파라미터를 URL 로 파싱해 호스트명으로 화이트리스트를 검사한 뒤 중계한다.
  // User-Agent 를 브라우저처럼 위장하는 이유는 일부 시세 API(야후 등)가 기본 fetch UA 를 봇으로 보고 차단하기 때문이다.
  r.all('/', async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'POST') {
      return res.status(405).type('text/plain').send('method not allowed');
    }
    const target = typeof req.query.url === 'string' ? req.query.url : '';
    if (!target) return res.status(400).type('text/plain').send('missing url');
    let t;
    try { t = new URL(target); } catch { return res.status(400).type('text/plain').send('bad url'); }
    if (!ALLOW.includes(t.hostname)) return res.status(403).type('text/plain').send('host not allowed');

    // FRED 요청에 서버 보관 키 주입 — 요청에 이미 api_key 가 붙어 있으면 존중하고 덮어쓰지 않는다.
    if (t.hostname === 'api.stlouisfed.org' && process.env.FRED_API_KEY && !t.searchParams.get('api_key')) {
      t.searchParams.set('api_key', process.env.FRED_API_KEY);
    }

    const init = { method: req.method, headers: { 'User-Agent': 'Mozilla/5.0' } };
    if (req.method === 'POST') {
      init.body = typeof req.body === 'string' ? req.body : '';
      init.headers['Content-Type'] = req.get('Content-Type') || 'application/json';
    }
    const resp = await fetch(t.toString(), init); // 네트워크 실패는 에러 미들웨어(500) — 원본도 500
    // 넘기는 헤더는 Content-Type 하나뿐. undici 가 gzip 을 이미 풀어주므로 Content-Encoding 등을 전달하면 안 된다.
    res.status(resp.status).set('Content-Type', resp.headers.get('Content-Type') || 'application/json');
    if (!resp.body) return res.end();
    // 바이트를 손대지 않고 흘려보낸다 — resp.text() 는 UTF-8 강제 디코드라 EUC-KR 응답(KRX·네이버)을 깨뜨리고,
    // 그러면 js/fetch.js 의 _validateJSON 이 실패해 공개 프록시로 조용히 폴백된다.
    try {
      await pipeline(Readable.fromWeb(resp.body), res);
    } catch (err) {
      console.error(`[proxy] stream error: ${err.message}`);
      res.destroy();
    }
  });

  return r;
}
