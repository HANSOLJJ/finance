// Express 앱 진입점 — 정적 파일(index.html·css·js)과 /api/* 를 127.0.0.1:8787 에서 서빙한다.
import dns from 'node:dns';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { openDb } from './lib/db.js';
import { loadOrCreateKey } from './lib/secret.js';
import portfolioRoutes from './routes/portfolio.js';
import whoamiRoutes from './routes/whoami.js';
import proxyRoutes from './routes/proxy.js';
import brokerRoutes from './routes/broker.js';
import brokerConnectionsRoutes from './routes/broker-connections.js';
import brokerDiscoverRoutes from './routes/broker-discover.js';

// 빗썸 allowlist 가 IPv4 만 받으므로 아웃바운드 DNS 를 IPv4 우선으로.
// 기동 플래그 대신 코드에 두어 dev(npm run dev)·prod(pm2) 가 동일하게 동작한다.
dns.setDefaultResultOrder('ipv4first');

// 경로는 전부 이 파일 기준 절대경로 — pm2·npm·직접 실행의 cwd 가 달라도 같은 파일을 가리킨다.
const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 8787;

// 자격증명 암호화 키는 data/ 밖(~/.finance)에 둔다 — DB 백업에 키가 딸려가지 않게. 없으면 생성.
const secretKey = loadOrCreateKey(path.join(os.homedir(), '.finance', 'secret.key'));
const db = openDb(path.join(ROOT, 'data', 'finance.db'), secretKey);

const app = express();
app.disable('x-powered-by');

// 정적 자산은 셋만 명시적으로 — 루트를 통째로 서빙하면 data/·ref/·.git 이 노출된다.
// index.html 은 항상 재검증(no-cache) → ?v= 스탬프로 js/css 강제 갱신이 성립한다.
app.get('/', (req, res) => {
  res.sendFile(path.join(ROOT, 'index.html'), { headers: { 'Cache-Control': 'no-cache' } });
});
app.use('/css', express.static(path.join(ROOT, 'css')));
app.use('/js', express.static(path.join(ROOT, 'js')));

// 클라이언트는 Content-Type 없이 fetch 한다(브라우저가 text/plain 을 붙임). express.json() 은 그 요청을
// 파싱하지 않으므로 타입을 가리지 않고 원문 문자열로 받고, 각 핸들러가 JSON.parse 한다.
app.use('/api', express.text({ type: () => true, limit: '5mb' }));
app.use('/api/portfolio', portfolioRoutes(db));
app.use('/api/whoami', whoamiRoutes());
app.use('/api/proxy', proxyRoutes());
// /api/broker 마운트는 세그먼트 경계로 매칭되므로 /api/broker-connections 와 충돌하지 않는다.
app.use('/api/broker-connections', brokerConnectionsRoutes(db));
app.use('/api/broker-discover', brokerDiscoverRoutes(db));
app.use('/api/broker', brokerRoutes(db));
app.use('/api', (req, res) => res.status(404).type('text/plain').send('not found'));
app.use((req, res) => res.status(404).type('text/plain').send('not found'));

// 에러 미들웨어 — body-parser 의 413 등 err.status 를 존중한다.
// 요청 본문은 절대 로그에 남기지 않는다 (broker-connections 본문에 자격증명 원문이 있다).
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error(`[${req.method} ${req.path}]`, err.stack || err.message);
  // 프록시가 upstream 스트림을 흘려보내는 도중 실패하면 헤더가 이미 나갔다 — Express 기본 처리(소켓 종료)에 맡긴다.
  if (res.headersSent) return next(err);
  const text = status === 413 ? 'too large' : status >= 500 ? 'internal error' : 'bad request';
  res.status(status).type('text/plain').send(text);
});

const server = app.listen(PORT, '127.0.0.1', () => {
  console.log(`finance server: http://127.0.0.1:${PORT}`);
  if (process.env.DEV_EMAIL) console.log(`DEV_EMAIL=${process.env.DEV_EMAIL} — Access 검증 우회 중 (운영에서는 절대 금지)`);
});

// pm2 재시작·Ctrl+C 시 연결을 닫아 WAL 을 정리한다. Windows 는 SIGINT 만 실제로 전달된다.
function shutdown() {
  server.close(() => { db.close(); process.exit(0); });
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
