// /reports — 옆 폴더 stock-report-harness 의 채점표 리포트(output/<run_id>/report.html·audit.md)를 읽기 전용으로 서빙한다.
// 실행 폴더를 통째로 열지 않고 두 파일만 내보낸다. run_id 는 주소에서 받으므로 새 실행은 그 repo 를 git pull 하면 바로 보인다.
import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';

// run_id 형식을 좁혀 경로 탈출(../)을 막는다.
const RUN_RE = /^ai-scorecard-[a-z0-9-]+$/;
const NO_CACHE = { 'Cache-Control': 'no-cache' };

function escapeHtml(s) {
  return s.replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
  );
}

// report.html 앞부분에서 <title> 만 읽는다 — 파일이 1MB 가 넘어 통째로 읽지 않는다.
function readTitle(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(4096);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    const m = buf.toString('utf8', 0, n).match(/<title>([^<]*)<\/title>/);
    return m ? m[1].trim() : '';
  } finally {
    fs.closeSync(fd);
  }
}

function listRuns(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && RUN_RE.test(e.name))
    .map((e) => ({ id: e.name, file: path.join(dir, e.name, 'report.html') }))
    .filter((r) => fs.existsSync(r.file))
    .map((r) => ({ id: r.id, title: readTitle(r.file) }))
    .sort((a, b) => b.id.localeCompare(a.id));
}

function indexPage(runs) {
  const items = runs.length
    ? runs
        .map(
          (r) =>
            `<li><a href="/reports/${r.id}/"><b>${escapeHtml(r.title || r.id)}</b><span>${r.id}</span></a></li>`,
        )
        .join('')
    : '<li class="empty">리포트가 없다.</li>';
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>채점표 리포트</title>
<style>
:root{color-scheme:light dark;--bg:#fff;--tx:#1a1a1a;--sub:#6b6b6b;--line:#e3e3e3;--acc:#2f6fdb}
@media (prefers-color-scheme:dark){:root{--bg:#141414;--tx:#ececec;--sub:#9a9a9a;--line:#2c2c2c;--acc:#7aa7ff}}
body{margin:0;background:var(--bg);color:var(--tx);font:16px/1.5 system-ui,-apple-system,sans-serif}
main{max-width:640px;margin:0 auto;padding:24px 16px}
h1{font-size:20px;margin:0 0 16px}
ul{list-style:none;margin:0;padding:0}
li{border-bottom:1px solid var(--line)}
a{display:block;padding:14px 4px;color:inherit;text-decoration:none}
a b{display:block;color:var(--acc)}
a span{font-size:13px;color:var(--sub)}
.empty{padding:14px 4px;color:var(--sub)}
</style></head>
<body><main><h1>채점표 리포트</h1><ul>${items}</ul></main></body></html>`;
}

export default function reportsRoutes(dir) {
  const r = Router();

  // /reports 는 Access 를 Bypass 하는 공개 경로다 — 주소를 아는 사람만 보도록 검색 수집을 막는다.
  r.use((req, res, next) => {
    res.set('X-Robots-Tag', 'noindex, nofollow');
    next();
  });

  r.get('/', (req, res) => {
    res
      .set(NO_CACHE)
      .type('html')
      .send(indexPage(listRuns(dir)));
  });

  // 리포트가 audit.md 를 상대 경로로 링크하므로 끝 슬래시가 없으면 붙여서 보낸다.
  r.get('/:run', (req, res, next) => {
    const { run } = req.params;
    if (!RUN_RE.test(run)) return next();
    if (!req.originalUrl.split('?')[0].endsWith('/'))
      return res.redirect(301, `/reports/${run}/`);
    const file = path.join(dir, run, 'report.html');
    if (!fs.existsSync(file)) return next();
    res.sendFile(file, { headers: NO_CACHE });
  });

  // 마크다운은 브라우저가 내려받지 않고 바로 보이도록 text/plain 으로 보낸다.
  r.get('/:run/audit.md', (req, res, next) => {
    const { run } = req.params;
    if (!RUN_RE.test(run)) return next();
    const file = path.join(dir, run, 'audit.md');
    if (!fs.existsSync(file)) return next();
    res.sendFile(file, {
      headers: { ...NO_CACHE, 'Content-Type': 'text/plain; charset=utf-8' },
    });
  });

  return r;
}
