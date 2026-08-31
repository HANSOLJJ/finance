// /api/portfolio — 사용자별 앱 state 저장·조회 (functions/api/portfolio.js 이식판, KV → SQLite).
// GET /api/portfolio(?version=날짜)(&download=1) 은 조회, PUT 은 저장.
// 클라이언트 쪽 상대는 main.js bootstrap()(GET — 404 를 "신규 사용자"로 해석하므로 미저장이면 반드시 404),
// sync.js savePortfolio()(PUT), data-io.js exportJSON()(GET 원문).
import { Router } from 'express';
import { requireAuth } from '../lib/access.js';

const MAX_BYTES = 5 * 1024 * 1024; // 5MB 상한 (현재 데이터 ~90KB)

// KST 날짜 — UTC 에 9시간을 더하는 산술이라 서버 TZ 와 무관하다 (toLocale* 금지).
const kstDate = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);

export default function portfolioRoutes(db) {
  const r = Router();
  r.use(requireAuth);

  // GET — 저장된 JSON 문자열을 파싱 없이 그대로 응답하므로 스키마 보정(migrateState)은 클라이언트가 수행한다.
  r.get('/', (req, res) => {
    const version = typeof req.query.version === 'string' && req.query.version ? req.query.version : null;
    // 원본은 KV 키 v:<문자열> 조회라 ?version=latest 가 404 였다 — 날짜 형식만 버전으로 인정해 같은 동작 유지.
    if (version && !/^\d{4}-\d{2}-\d{2}$/.test(version)) return res.status(404).type('text/plain').send('not found');
    const data = db.getPortfolio(req.email, version || 'latest');
    if (data === null) return res.status(404).type('text/plain').send('not found');
    const headers = { 'Content-Type': 'application/json' };
    // ?download=1 — 브라우저가 파일로 저장하도록 첨부 헤더를 붙인다 (백업 다운로드용).
    if (req.query.download === '1') {
      headers['Content-Disposition'] = `attachment; filename="portfolio_${version || kstDate()}.json"`;
    }
    res.set(headers).send(data);
  });

  // PUT — 크기 상한과 최소한의 형태 검증(holdings 배열 존재)만 하고 latest 와 날짜 버전에 나눠 쓴다.
  // 응답의 version(KST 날짜)은 클라이언트가 저장 확인용으로만 쓴다.
  r.put('/', (req, res) => {
    const body = typeof req.body === 'string' ? req.body : '';
    if (Buffer.byteLength(body, 'utf8') > MAX_BYTES) {
      return res.status(413).type('text/plain').send('too large');
    }
    // 앱 state 형태인지 확인 — 깨진 데이터로 latest 를 덮어써 복구 불능이 되는 사고 방지.
    let state;
    try { state = JSON.parse(body); } catch { state = null; }
    if (!state || !Array.isArray(state.holdings)) {
      return res.status(400).type('text/plain').send('invalid body: expected app state');
    }
    const date = kstDate();
    db.putPortfolio(req.email, body, date);
    res.json({ ok: true, version: date });
  });

  return r;
}
