# HANDOVER — Cloudflare에서 Mac mini 자립 서버로 이전 (6차, server/ 재작성)

작성 2026-08-31. 다음 세션(사람/에이전트)이 **이 문서만 읽고** 구현을 시작할 수 있게 쓴 인수인계다.
**공개 repo이므로 이메일·계좌번호·API 키·개인 IP는 이 문서에 적지 않는다.**

## 0. 이 문서를 읽는 세션에게

- **구현은 윈도우 PC, 운영은 Mac mini.** 윈도우에서 `server/`를 작성·로컬 검증하고 push 하면 Mac mini가 pull 해서 pm2로 띄운다.
- 계획 원본(`~/.claude/plans/…`)과 작업 노트(`ref/checklist.md`·`ref/context-notes.md`)는 **Mac mini 로컬에만 있다.** 윈도우 세션은 못 본다. 그래서 이 문서가 계획 전문을 싣는다. 결정 이유까지 여기 있는 것이 전부다.
- `CLAUDE.md`의 불변 조건(스크립트 로드 순서·서버 단일 소스·부채 제외 집계·증권사 추가는 어댑터 1곳·동기화 소유권 마커)은 그대로 유효하다. 먼저 읽을 것.
- 작업 중 내린 결정은 이 문서 12절(진행 기록)에 append 한다. 윈도우 세션의 노트도 여기로 모은다.

## 1. 왜 옮기나

최종 목표가 **트레이딩 봇**으로 확정되면서 Cloudflare Workers로는 구조적으로 불가능한 요구가 생겼다.

| 봇이 요구하는 것 | Cloudflare Workers |
|---|---|
| 24/7 상시 실행 (조건 감시) | ❌ 요청이 올 때만 실행 |
| WebSocket 실시간 시세 유지 | ❌ 장시간 연결 불가 |
| 고정 출발 IP | ❌ 엣지마다 다르고 IPv6 |

세 번째는 이미 실장애다 — 키움 `8050 지정단말기 인증에 실패했습니다`, 빗썸 `invalid ip format`. 둘 다 **호출 IP 사전 등록**을 요구하는데 Workers는 등록할 IP가 없다. 브라우저에서 증권사를 직접 호출하는 우회안은 **키움 앱키가 주문 권한을 포함**해 기각(브라우저 노출 = 계좌 탈취 위험).

## 2. 현재 상태 (2026-08-31)

**되는 것** — 앱 전체(대시보드·자산입력·분석·이력·설정), 모바일 대응, 서버 자동 저장(KV), Access 구글 로그인, 날짜별 버전 90일 보관, **한국투자증권 잔고 동기화**(연금저축·ISA 실동작).
**막힌 것** — 키움(IP 불일치), 빗썸(IPv6 거부). 둘 다 이번 이전으로 풀린다.

## 3. 확정 방향

**Mac mini(보유·24/7 가동·집 공인 IP 고정)를 자립 서버로. 외부 접속은 Cloudflare Tunnel.**

```
브라우저 → Cloudflare (DNS · Access 구글 로그인 · Tunnel)
              ↓ 아웃바운드 터널 (공유기 포트 개방 불필요)
         [Mac mini] Node/Express :8787
           ├─ 정적 서빙 (index.html · css/ · js/ — 프론트 무변경)
           ├─ /api/*  (server/routes/)
           ├─ data/finance.db (SQLite)
           └─ (후속) 트레이딩 봇 상주 프로세스
              ↓ 아웃바운드 = 집 고정 공인 IP
         [한투 · 키움 · 빗썸]
```

**이 단계의 범위는 `server/` 하나** — Mac mini에서 도는 Node 서버를 만들고 검증하는 것. Tunnel 연결·증권사 IP 재등록·봇 본체는 이후 단계다.

## 4. 결정된 것과 이유 (사용자 결정)

| 결정 | 이유 |
|---|---|
| **Express 네이티브로 다시 쓴다** (가짜 KV·Request/Response 변환 어댑터 없음) | 사용자 혼자 쓰므로 이사 중 무중단이 요구사항이 아니다. 확보할 건 데이터뿐. 호환 층을 없애 구조를 깨끗하게 |
| **SQLite (Node 내장 `node:sqlite`)** | 봇 단계의 시세 이력·신호·체결은 행 단위 기간 조회가 필요해 파일로는 감당 불가. 지금 깔면 저장소가 둘로 안 갈라진다. 트랜잭션으로 원자적 쓰기가 공짜. 백업 대상이 파일 1개 |
| **portfolio JSON은 정규화하지 않는다** | 서버는 이 데이터를 읽지 않고 통과만 시킨다(스키마 보정은 클라이언트 `migrateState()`). 컬럼으로 쪼개면 앱 필드 추가마다 서버 스키마도 고쳐야 한다 |
| **증권사 자격증명(creds)만 암호화** | 키움 앱키는 주문 권한 포함 — 저장에도 같은 잣대. portfolio는 유출돼도 금전 피해가 없고, 암호화하면 `sqlite3`로 열어보기·백업 골라내기가 막힌다 |
| **로그인은 Cloudflare Access 그대로** | Tunnel을 지나도 `Cf-Access-Jwt-Assertion` 헤더가 오리진까지 온다. 기존 JWT 검증 코드·`APP_AUD` 상수가 무수정 동작. 로그인 코드를 새로 만들지 않는다 |
| **`functions/`는 검증 끝난 뒤 마지막 커밋에서 삭제** | 재작성 중 원본 대조용. 안 건드리므로 그동안 Cloudflare 배포도 살아 있다 |

## 5. 구조

```
server/
  index.js                  Express 앱 · 라우팅 · 정적 서빙 · :8787
  lib/
    access.js               Access JWT 검증 (이식 + DEV_EMAIL 우회)
    db.js                   SQLite 연결 · 스키마 · 질의 함수
    secret.js               creds 암·복호화 (AES-256-GCM)
    brokers.js              증권사 응답 정규화 (그대로 복사)
    providers.js            증권사 어댑터 레지스트리 (토큰 캐시 2줄만 수정)
  routes/
    portfolio.js  proxy.js  whoami.js
    broker.js  broker-connections.js  broker-discover.js
ecosystem.config.cjs        pm2 (자동 재시작 · 부팅 시 기동) — 비밀 없음
package.json                "type": "module", engines node >= 22.5, 의존성은 express 뿐
data/finance.db             실데이터 — gitignore
```

## 6. 무엇을 가져오고 무엇을 다시 쓰나

`functions/` 9개 파일 839줄 전수 확인 결과.

| 기존 | 처리 | 근거 |
|---|---|---|
| `_lib/brokers.js` (91줄) | **그대로 복사** | 네트워크·env 없는 순수 정규화 함수 |
| `_lib/providers.js` (229줄) | **복사 + 2줄** | `fetch`·`AbortSignal.timeout`·`crypto.subtle`·`randomUUID`·`btoa` 전부 Node 전역. `cachedToken()`의 `ctx.env.KV.get/put` 2곳만 db 함수로 교체 |
| `_lib/access.js` (86줄) | **복사 + 2줄** | `crypto.subtle`·`atob`·`fetch` Node 전역. `request.headers.get()` → `req.get()`, 맨 앞에 `DEV_EMAIL` 우회 1줄 |
| `api/*.js` 6개 (433줄) | **재작성** | `Request`/`Response` → Express `req`/`res`. 응답 코드·헤더·에러 분기는 원본과 1:1 |

구조 정리 하나 — 지금 `api/broker.js`가 `loadConnections`를 export 하고 `api/broker-discover.js`가 import 한다(라우트끼리 참조). 이 함수는 `lib/db.js`의 질의 함수로 내리고 두 라우트가 각자 db를 쓴다.

**라우트별 옮길 때 놓치기 쉬운 것**

- `portfolio` — GET은 저장된 **문자열을 파싱 없이 그대로** 응답(`Content-Type: application/json`), `?version=YYYY-MM-DD`로 롤백본, `?download=1`이면 `Content-Disposition: attachment; filename="portfolio_<날짜>.json"`. PUT은 5MB 초과 413, `holdings` 배열 없으면 400, 응답 `{ok:true, version:<KST날짜>}`.
- `proxy` — GET/POST 외 405, `url` 없으면 400, 파싱 실패 400, 호스트 화이트리스트(`ALLOW` 배열 10개) 밖 403. FRED(`api.stlouisfed.org`)는 `api_key` 없을 때만 `process.env.FRED_API_KEY` 주입. `User-Agent: Mozilla/5.0`. 원본은 `resp.body`(Web 스트림)를 그대로 돌려주는데 Express에선 `Readable.fromWeb(resp.body).pipe(res)`. POST 중계는 현재 클라이언트가 안 쓰지만 원본대로 유지.
- `broker` — 연결 단위 병렬(`Promise.allSettled`), 연결 안 계좌는 순차 + `rateDelayMs`. 계좌 하나 실패는 그 소스만 `ok:false`(빈 holdings로 위장 금지 — 프론트 diff가 실패 소스를 통째로 스킵해 "장애 = 전량 매도" 오판을 막는다). 연결 0개면 `note` 동봉.
- `broker-connections` — GET은 creds 원본을 **절대 반환하지 않고** 마스킹(`앞4자… (N자)`) + `providerMeta()` 동봉. PUT은 빈 creds 값이면 기존 값 유지, 값이 바뀌면 그 연결의 토큰 캐시 삭제, 삭제된 연결의 토큰도 삭제. `accountMode:'user'`면 계좌 1개 이상 필수. DELETE `?id=`(없으면 전체).
- `broker-discover` — `connId`가 오면 저장된 creds와 병합(빈 값은 저장값). 토큰 캐시 id는 `connId || 'discover:<provider>'`. 전부 실패 시 `{ok:false, error}`를 **200**으로.
- `whoami` — 진단용. 클라이언트는 안 부른다. `Cf-Access-Authenticated-User-Email` 평문 헤더와 JWT 검증 결과를 나란히 보여준다(Tunnel 뒤에서 JWT가 오리진까지 오는지 확인하는 용도).

## 7. `server/index.js` 규칙

- **정적 서빙은 명시적으로만** — `/` → `index.html`, `/css`·`/js` → `express.static`. 루트를 통째로 서빙하면 `data/`·`ref/`·`.git`이 노출된다. 정적 자산은 이 셋뿐이다(favicon 없음, 차트 라이브러리는 CDN).
- **본문 파서는 `express.text({ type: '*/*', limit: '5mb' })`** — 클라이언트 7곳(sync.js·broker.js) 전부 `Content-Type` 없이 `fetch` 하므로 `text/plain`으로 도착한다. `express.json()`은 그 요청을 건드리지 않아 `req.body`가 빈다. 문자열을 받아 핸들러에서 `JSON.parse`(원본의 `request.json()` try/catch와 같은 모양). portfolio는 그 문자열을 파싱 없이 그대로 저장한다.
- **캐시 헤더를 직접 정한다** — 지금은 `_headers` 파일이 없어 Cloudflare Pages 기본값에 얹혀 있다. `index.html` → `Cache-Control: no-cache`(항상 재검증, `?v=` 스탬프가 먹히는 전제). `/js`·`/css`는 `express.static` 기본(`max-age=0` + ETag) 유지 — `immutable`로 길게 주면 스탬프를 깜빡했을 때 옛 파일이 조용히 남는다. 이걸 안 하면 CLAUDE.md의 "신 HTML + 구 JS 캐시" 사고가 재발한다.
- **ESM** — `package.json`에 `"type": "module"`. `functions/`가 `import/export`라 그대로 옮기려면 필수. pm2 설정이 `.cjs`인 이유.
- **Express 5** — async 핸들러 예외가 에러 미들웨어로 자동 전파. 에러 미들웨어는 `err.status`(body-parser 413 등)를 존중하고 **메시지·스택만** 로깅.
- **로그에 요청 본문을 찍지 않는다** — `PUT /api/broker-connections` 본문에 자격증명 원문이 있다. 찍으면 pm2 로그로 앱키가 새어 암호화가 무의미해진다.
- **비밀은 `~/.finance/env`** — `ecosystem.config.cjs`는 커밋되므로 `FRED_API_KEY`를 넣을 수 없다. Node 내장 `--env-file`로 읽는다(dotenv 불필요). 로컬 개발은 `--env-file-if-exists=.env`(`.env`는 gitignore).
- 기동 옵션 `--dns-result-order=ipv4first` — Mac mini에 지금은 글로벌 IPv6가 없지만 ISP가 나중에 주면 빗썸 `invalid ip format`이 재발한다. 한 줄짜리 보험.
- `SIGINT`/`SIGTERM`에 DB를 닫는다 — pm2 재시작 때 WAL 정리.
- 경로는 `os.homedir()` + `path.join` — `~/.finance`를 문자열로 박지 않는다(윈도우 개발·Mac 운영 양쪽에서 동작).

## 8. `server/lib/db.js` — SQLite

현재 KV에 실제로 들어 있는 건 3종류뿐이다.

| KV 키 | 내용 | TTL |
|---|---|---|
| `user:<email>:portfolio:latest` | 앱 state 원문 문자열 | 없음 |
| `user:<email>:portfolio:v:<KST날짜>` | 같은 원문 (롤백용) | 90일 |
| `user:<email>:broker:connections` | `[{id,provider,label,creds{},accounts[]}]` | 없음 |
| `user:<email>:broker:token:<connId>` | 토큰 문자열 | 23시간 |

```sql
PRAGMA journal_mode = WAL;   -- 봇이 붙어 읽는 동안 쓰기가 막히지 않는다
-- foreign_keys 는 node:sqlite 기본 ON. 아래 스키마엔 FK 가 없다

-- 앱 state. version='latest' 가 현재본, 'YYYY-MM-DD'(KST) 가 롤백 스냅샷.
CREATE TABLE IF NOT EXISTS portfolio (
  email      TEXT    NOT NULL,
  version    TEXT    NOT NULL,
  json       TEXT    NOT NULL,            -- 원문 그대로. 파싱해서 다시 직렬화하지 않는다
  updated_at INTEGER NOT NULL,            -- epoch ms
  PRIMARY KEY (email, version)
);

-- 증권사 연결. 연결 1개 = 1행.
CREATE TABLE IF NOT EXISTS broker_connection (
  email    TEXT NOT NULL,
  id       TEXT NOT NULL,
  provider TEXT NOT NULL,                 -- 'kis' | 'kiwoom' | 'bithumb' …
  label    TEXT NOT NULL DEFAULT '',
  creds    TEXT NOT NULL,                 -- 암호화된 JSON 뭉치 'enc:v1:…' (9절)
  accounts TEXT NOT NULL DEFAULT '[]',    -- JSON [{code,category}]. 민감하지 않아 평문
  PRIMARY KEY (email, id)
);

-- 접근 토큰 캐시. KIS 는 발급이 1분 1회 제한이라 사실상 필수.
-- FK 를 걸지 않는다 — broker-discover 가 저장 전 연결을 'discover:<provider>' 임시 id 로
-- 캐시하므로 부모 행이 없는 토큰이 정상적으로 존재한다. 삭제는 원본처럼 명시적으로.
CREATE TABLE IF NOT EXISTS broker_token (
  email      TEXT    NOT NULL,
  conn_id    TEXT    NOT NULL,
  token      TEXT    NOT NULL,
  expires_at INTEGER NOT NULL,            -- epoch ms. 읽을 때 검사
  PRIMARY KEY (email, conn_id)
);
```

- 기동 시 `CREATE TABLE IF NOT EXISTS`. 마이그레이션 도구 없음.
- **봇용 테이블은 지금 만들지 않는다** — 쓰는 코드가 없는 스키마는 추측이다.
- **범용 TTL 계층이 없다.** 90일 롤백 버전은 만료시키지 않는다(하루 1행 × ~100KB = 연 36MB). 토큰은 `expires_at`(발급 + 23h)을 읽을 때 검사.
- 연결은 서버가 내용을 읽고 판단하는(필수 필드 검사·자격증명 변경 비교) 개체라 행으로 쪼갰다. `creds` 안쪽은 provider마다 필드가 달라 JSON 한 칸 — 컬럼화하면 "증권사 추가는 어댑터 1곳" 규칙이 깨진다.
- 사람이 볼 일이 있으면 `sqlite3 data/finance.db "select json from portfolio where version='latest'"`. 앱의 `?download=1`도 그대로.

## 9. `server/lib/secret.js` — creds 암호화

- Node 내장 `node:crypto`, **AES-256-GCM**. 의존성 0.
- 저장 형식 `enc:v1:<base64(iv12 ‖ tag16 ‖ ciphertext)>`. 접두사로 평문/방식 판별.
- **AAD = `email|conn_id`** — 남의 행에 암호문을 복사해 넣어도 복호화 실패.
- 키 파일 `~/.finance/secret.key`(32바이트, 권한 600). **`data/` 밖**이어야 DB 백업에 키가 딸려가지 않는다. 없으면 기동 시 생성하고 "새 키 생성됨" 로그.
- 복호화 실패 시 500으로 죽지 않고 해당 연결을 `ok:false, error:'자격증명을 읽을 수 없습니다 — 재등록 필요'`로 — 키가 바뀌어도 앱 전체가 안 뜨면 안 된다.
- 막는 것 — DB 파일·백업만 새는 경우(가장 흔한 경로). 못 막는 것 — 서버가 통째로 털리는 경우(키가 같은 기기에 있어야 하므로 구조적 한계).

## 10. `server/lib/access.js` — 인증

Access가 인증 후 붙이는 `Cf-Access-Jwt-Assertion`을 팀 공개키(`<TEAM_DOMAIN>/cdn-cgi/access/certs`, RS256)로 서명·iss·aud·exp 검증해 email 클레임을 쓴다. 기존 코드 그대로. Access 앱 설정·정책(`everyone`)도 손대지 않는다.

- 로컬엔 그 헤더가 없어 전부 401이므로 맨 앞에 `if (process.env.DEV_EMAIL) return process.env.DEV_EMAIL;`.
- **운영(Tunnel 뒤)에서 `DEV_EMAIL`을 절대 설정하지 않는다** — 로그인 없이 임의 이메일로 남의 데이터 접근 가능. `ecosystem.config.cjs`·`~/.finance/env` 어디에도 넣지 않는다.
- **우회 경로가 없어야 성립한다** — `cloudflared`는 아웃바운드만 쓰므로 공유기 포트포워딩·UPnP로 8787을 열지 않는 한 자연히 충족.

## 11. `.gitignore` · `package.json`

- 추가: `data/`, `node_modules/`, `.env`
- **`!package.json`, `!package-lock.json`** — 기존 `*.json` 규칙이 둘 다 막는다(`git check-ignore`로 확인). lock이 빠지면 Mac mini 재설치 때 express 버전이 달라진다.
- `package.json` — `"type": "module"`, `"engines": { "node": ">=22.5" }`(`node:sqlite` 하한), `"scripts"`에 `start`(운영)·`dev`(`--env-file-if-exists=.env`).

## 12. 커밋 단위와 진행 기록

각 커밋은 한 문장으로 설명되는 단위. **co-author trailer 금지**(사용자 규칙).

- [x] **1. 서버 골격 + portfolio·whoami** — `index.js`, `lib/{db,access}.js`, `routes/{portfolio,whoami}.js`, `ecosystem.config.cjs`, `package.json`, `.gitignore`. 여기서 부트·저장 왕복이 검증된다 (9387496)
- [x] **2. 시세 프록시** — `routes/proxy.js` (1af5c56)
- [x] **3. 증권사 3종** — `lib/{brokers,providers}.js` 이식 + `lib/secret.js` + `routes/broker*.js` 3개 (3fd93ce)
- [x] **4. 문서 갱신** (사용자 결정으로 `functions/` 삭제는 제외 — Tunnel 전환·안정화 후 별도 커밋. 지금 지우면 Pages 자동 배포로 운영 API 가 죽고 롤백 수단도 사라진다)
  - README — 아키텍처 절, "자격증명 평문 저장" 고지 정정(이제 암호화)
  - SETUP — Mac mini/Tunnel 절 추가, "Pages가 만든 CNAME 손대지 말 것" 규칙 폐기
  - **CLAUDE.md** — 불변조건의 `functions/_lib/…` 경로를 `server/lib/…`로, "서버 비밀은 Cloudflare 대시보드 환경변수로"를 `~/.finance/env` 기준으로, 검증 루틴의 python http.server를 `node server/index.js`로
  - `.claude/launch.json` — `finance-static`(python 8124)을 `finance-server`(`node --env-file-if-exists=.env server/index.js`)로 교체. **API가 살아 있으므로 "부트 실패 배너가 정상" 전제가 없어진다**. `.env`에 `DEV_EMAIL`을 두므로 launch.json에는 이메일을 넣지 않는다(공개 repo)

진행하면서 결정·발견은 아래에 날짜와 함께 append.

- 2026-08-31 계획 확정. 셰임(어댑터) 방식 → 재작성으로 변경, 파일 저장소 → SQLite, creds 암호화 추가. 검증 중 발견한 원 계획의 오류 2개 — ① `express.json()`은 Content-Type 없는 클라이언트 요청을 파싱하지 않음 → `express.text` ② `broker_token`의 FK cascade는 discover 임시 id 때문에 INSERT 실패 → FK 제거
- 2026-08-31 **윈도우 세션, 커밋 1(9387496)** — 사용자 결정 3개: 바인드 `127.0.0.1`(Tunnel 경로만, 프록시가 무인증이라 LAN 오픈 프록시 방지) · **커밋 4는 문서 갱신만, `functions/` 삭제는 Tunnel 전환·안정화 후**(지금 지우면 Pages 자동 배포로 운영 API 사망 + 롤백 수단 소실) · 커밋 3은 한투 실키로 실동작까지. 원안 대비 변경 — `express.text({ type: () => true })`(문자열 `'*/*'`는 Content-Type 헤더 부재 시 매치 실패, 함수형만 curl `-H "Content-Type:"` 통과 실측) · `?version=`은 `YYYY-MM-DD`만 인정(원본은 KV 키 `v:latest`가 없어 404였는데 SQLite는 latest 행을 돌려주므로 차단) · `--dns-result-order` 플래그 대신 코드 `dns.setDefaultResultOrder('ipv4first')`(dev/prod 동일) · `BEGIN IMMEDIATE` + `busy_timeout=5000`(후속 봇 프로세스 대비) · `.gitattributes eol=lf`(로컬 `core.autocrlf=true`라 체크아웃 파일이 CRLF로 바뀌는 것 실측) · `--disable-warning=ExperimentalWarning`(Node 25.0도 `node:sqlite` 경고 출력) · `.playwright-mcp/` gitignore(playwright MCP가 repo 안에 스냅샷·스크린샷을 씀). 수용한 편차 — Express 응답 Content-Type에 `; charset=utf-8`이 붙음(클라이언트는 `res.json()/text()`만 쓰므로 무해) · 매핑된 경로의 미지원 메서드는 404(Pages는 405) · `/index.html` 직접 경로 404(클라이언트 미사용). **Windows 실측 함정** — ① `process.kill`·TaskStop은 SIGINT 핸들러를 거치지 않아 graceful shutdown·WAL 정리는 Mac mini pm2에서 확인해야 함(강제 종료 후 재기동 시 WAL 재생으로 데이터 유지는 확인) ② 같은 포트 중복 listen이 조용히 성공함(EADDRINUSE 미발생) — 서버 재기동 전 `netstat -ano | grep 8787`로 확인 ③ `npm run dev`를 백그라운드로 띄우면 중지 시 node 자식이 고아로 남음 → node를 직접 실행 ④ Git Bash에서 `fc.exe /b`는 `/b`가 경로로 변환됨 → `cmp` 사용. 검증 13절 1~5·9·10 통과(바이트 동일 왕복, 재기동 유지, 401/404/413/400, no-cache, ETag 304, 375px 렌더).
- 2026-08-31 **커밋 2(1af5c56)** — proxy는 `Readable.fromWeb(resp.body)` + `stream/promises.pipeline` 패스스루. 직접 호출과 프록시 경유 응답을 `cmp`로 바이트 비교해 동일 확인, upstream Content-Type 원형 통과(야후 `application/json;charset=utf-8` 공백 없는 그대로). 405/400/400/403 문구 원본과 일치. 브라우저 콘솔에서 corsproxy.io 폴백이 사라짐(자체 프록시가 1순위로 성공). `resp.body === null`이면 `res.end()`. 스트리밍 중 실패는 에러 미들웨어의 `headersSent` 가드로 소켓 종료.
- 2026-08-31 **커밋 3** — `db.js`의 `getConnections`가 복호화까지 맡고 실패 행은 `creds:null + credsError`로 돌려줘 라우트가 500 없이 "재등록 필요"를 낸다(broker: 소스 `ok:false`, broker-connections GET: `credsMasked {}` + `credsError` 필드 추가 — 프론트는 무시). `deleteConnections`를 `putConnections`와 분리해 삭제 시 나머지 행을 재암호화하지 않는다(복호 실패 행의 암호문 보존). `secret.key`는 hex 64자 텍스트, 형식 오류면 새 키로 덮지 않고 기동 실패(고아 암호문 방지), BOM은 `charCodeAt(0)===0xFEFF`로 제거(정규식 `﻿` 이스케이프를 sed가 먹어버리는 사고가 있었음). **실키 검증(한투)**: 연금저축펀드(22) 3종목+예수금·ISA(01) 2종목 동기화 성공, 토큰 23h 캐시 → 같은 creds 재PUT·빈 creds PUT 시 토큰 유지 → appsecret 변경 PUT 시 토큰 삭제 → `expires_at=0` 강제 후 재발급 성공 → discover가 01/22/29 발견(`discover:kis` 토큰 행 생성) → DELETE로 연결·토큰 삭제. 🏦 동기화 모달 diff "변경 0·신규 5·예수금 1건" 렌더 확인(적용은 안 함). 암호문 바꿔치기(A→B 행) 시 B만 실패, 키 파일 제거 후 재기동 시 전 행 "재등록 필요"(200), 키 복원 후 정상. DB·WAL·stdout에 앱키 원문 없음. **KIS 토큰 발급은 1분당 1회** — 검증 중 `discover`가 직전 재발급 60초 안에 호출돼 "접근토큰 발급 잠시 후 다시 시도하세요(1분당 1회)"로 전부 실패 → 원본 계약대로 200 `ok:false`(에러 문구 그대로)를 돌려줬고 60초 후 재시도 성공. 운영에서 동기화 직후 계좌 찾기를 누르면 같은 현상이 나므로 문구가 그대로 보이는 게 맞다. 카테고리 키는 `연금저축펀드`·`ISA`(constants.js CATEGORIES). 원본 대조(13.12)는 라우트 6개를 나란히 놓고 이식했으며 응답 코드·문구 전부 유지, 추가된 것은 `credsError` 분기뿐.

- 2026-08-31 **커밋 4(문서)** — CLAUDE.md(전환 중 상태·경로 `server/lib/`·비밀 위치·검증 루틴 `finance-server`·Windows 함정), README(목표/현재 아키텍처 병기·`server/` 파일 표·고지 정정·복구 시나리오), SETUP(8절 Mac mini 이전 절차·CNAME 예외·한투 토큰 1분 제한), `.claude/launch.json` → `finance-server`. **다음 단계는 Mac mini**: `git pull` → `npm ci` → `~/.finance/env` → `pm2 start` → Tunnel → 데이터 이전 → IP 등록 → 3사 동기화(13절 13). push 직후 확인할 것 — Pages 가 `package.json`을 보고 `npm install`을 돌려 `node_modules/`를 정적 자산으로 올릴 수 있다(`fin.hansoljj.com/node_modules/express/package.json`이 열리는지) → 열리면 Pages 환경변수 `SKIP_DEPENDENCY_INSTALL=1`(사용자 결정: 일단 진행하고 확인).
- 2026-08-31 **키움·빗썸 실키 검증도 Windows에서 통과** — 개발 PC가 Mac mini와 같은 공유기(같은 공인 IP)에 있어 의미 있는 테스트였고(사용자 지적), 결과 키움 국내 2종목+KRW 예수금 · 키움 해외 13종목+USD 예수금 · 빗썸 8종목+KRW 예수금 전부 `ok:true`, 서버 로그 에러 0. **즉 집 공인 IP는 이미 키움·빗썸에 등록돼 있고**, Mac mini 단계(13절 13)에서 남은 것은 pull·npm ci·pm2·Tunnel·데이터 이전·연결 재등록뿐이다(IP 등록 단계는 재확인만). 키움 토큰 캐시 행(23h) 생성 확인, 빗썸은 요청마다 JWT 서명이라 토큰 없음. 검증 후 연결·토큰 전부 삭제.
- 2026-08-31 **Mac mini 기동 완료(SSH로 대행)** — `~/projects/finance` 최신(5f56461), `npm ci`, `~/.finance/env`는 주석만 있는 빈 파일로 생성(700/600 — `FRED_API_KEY`는 사용자가 넣고 `pm2 restart finance`), `pm2 start ecosystem.config.cjs` + `pm2 save`. 첫 기동에 `secret.key` 생성(65B, 600), `data/finance.db` 생성. `pm2 restart`로 graceful shutdown 확인 — 에러 로그 없음, 재기동 시 키 재사용(재생성 안 함). 내부 확인: `/` 200, `/api/whoami` 200(JWT 없음), `/api/portfolio` 401. **남은 것(사용자)**: ① Mac 터미널에서 `pm2 startup` 출력 명령(sudo) 실행 ② FRED 키 입력 ③ Tunnel(`cloudflared tunnel login`은 URL 승인이 필요 — SSH로 실행해 URL만 전달 가능) → Pages 커스텀 도메인 분리 → `tunnel route dns` ④ 데이터 이전(JSON 백업→복원) ⑤ 앱에서 증권사 연결 재등록 → 3사 동기화. Cloudflare Secret은 대시보드에서 다시 읽을 수 없으므로 FRED 키는 fred.stlouisfed.org 계정에서 확인.
- 2026-08-31 **pm2 startup·Tunnel 준비 완료(SSH 대행, DNS 미전환)** — `pm2 startup`은 `~/Library/LaunchAgents`가 없어 ENOENT로 실패했었음 → 폴더 생성 후 사용자가 sudo 명령 재실행해 `pm2.hansol.plist` 생성. 자동 로그인(`autoLoginUser=hansol`)·FileVault 꺼짐·GUI 세션 열려 있음 확인 — 사용자 LaunchAgent 방식(pm2·cloudflared 둘 다)은 이 전제 위에서만 재부팅 복구가 된다. `cloudflared tunnel login`은 SSH로 실행해 URL만 전달(브라우저는 아무 기기나 됨) → `tunnel create finance`(id 2558b984-…3c31, 자격증명 `~/.cloudflared/<id>.json`) → `~/.cloudflared/config.yml`(ingress `fin.hansoljj.com → http://127.0.0.1:8787`, 나머지 404) → 테스트 run 에서 icn 엣지 4연결. **함정**: `brew services start cloudflared`도 `cloudflared service install`도 인자 없이 `cloudflared`만 실행하는 plist를 만들며, cloudflared 2026.8은 "use `cloudflared tunnel run`"으로 거부(종료 1 반복). 해결 = `cloudflared service install` 후 `plutil -replace ProgramArguments -json '["/opt/homebrew/bin/cloudflared","tunnel","--config","/Users/hansol/.cloudflared/config.yml","run"]' ~/Library/LaunchAgents/com.cloudflare.cloudflared.plist` → `launchctl unload/load`. brew 서비스는 stop 해둠. 로그는 `~/Library/Logs/com.cloudflare.cloudflared.err.log`. **남은 것**: 사용자가 현 사이트에서 JSON 백업 다운로드 → Pages Custom domains 에서 `fin.hansoljj.com` 제거 → (SSH) `cloudflared tunnel route dns finance fin.hansoljj.com` → 로그인·whoami 확인 → JSON 복원 → 연결 재등록 → 재부팅 테스트.
- 2026-08-31 **전환 완료 — 사용자가 직접 수행**(JSON 백업 → Pages 도메인 분리 → 터널 DNS 연결 → 로그인 → JSON 복원 → 3사 연결 재등록). Mac mini DB 에 로그인 계정의 portfolio(latest + 날짜 버전, 69KB)와 broker_connection 3행(kis·kiwoom·bithumb)이 생긴 것으로 확인 — `DEV_EMAIL` 없는 운영 서버에 이메일이 붙었으므로 Access JWT 가 Tunnel 을 지나 오리진까지 도달·검증된 것(13절 13 충족). 문서(CLAUDE·README·SETUP)를 "전환 완료" 기준으로 갱신. **후속**: ① Mac mini 재부팅 테스트(pm2·cloudflared 자동 복귀) ② `~/.finance/env`에 FRED 키 ③ `secret.key` 백업 ④ 안정화 후 `functions/` 삭제 + Pages·KV·Secret 정리(별도 커밋) ⑤ Cron 자동 스냅샷·IP 변경 감지·봇은 다음 개편.
- 2026-09-02 **구 체제 정리 완료(안정화 이틀 만 — 사용자 결정으로 조기 정리)** — 사용자가 대시보드에서 Pages 프로젝트·KV namespace 삭제(FRED Secret 은 프로젝트와 함께 소멸, KV 의 평문 creds 도 함께 제거됨), repo 에서 `functions/` 9개 파일 삭제 커밋. 문서에서 롤백 경로 제거 — SETUP 9절 삭제, TODO 항목 삭제, CLAUDE/README 의 "롤백용 유지"·"전환기엔 둘 다" 문구 정리. 이후 복구 수단은 SQLite 날짜 버전(`?version=`)·`backups/` 평문 JSON·`sqlite3 .backup` 뿐이다.

## 13. 검증 (커밋 전 통과)

1. **문법** — 새 파일 전부 `node --check`
2. **기동** — `.env`에 `DEV_EMAIL=test@x.com` → `npm run dev` → `curl.exe -i localhost:8787/` 200
3. **저장 왕복** — `PUT /api/portfolio` `{"holdings":[]}` → GET이 **바이트 단위 동일**(원문 보존) → 재시작 후에도 유지
4. **버전 행** — `select version from portfolio`가 `latest`와 오늘 KST 두 행. 같은 날 두 번째 PUT은 행을 늘리지 않고 덮어쓴다
5. **경계** — `DEV_EMAIL` 없이 401 · 없는 사용자 404 · 5MB 초과 413 · `holdings` 없는 본문 400 · `/api/proxy?url=https://evil.com` 403 · `/data/finance.db`·`/ref/checklist.md`·`/.git/config` 404 · **Content-Type 없이 보낸 PUT이 정상 저장**(`curl.exe -X PUT --data-binary @x.json -H "Content-Type:"` — 헤더를 지워야 브라우저와 같은 조건)
6. **프록시** — `/api/proxy?url=https%3A%2F%2Fapi.frankfurter.app%2Flatest%3Ffrom%3DUSD%26to%3DKRW` 200
7. **토큰 캐시** — `broker_token.expires_at`을 과거로 UPDATE 후 재조회 시 재발급 · 연결 DELETE와 자격증명 변경 PUT 각각에서 토큰 행 삭제 · 계좌 찾기(`discover:kis`) 후 토큰 행 정상 생성
8. **암호화** — 더미 연결 등록 후 `creds`가 `enc:v1:…` · DB 파일에 앱키 원문이 없음(`strings`/`findstr`) · 저장→조회(마스킹) 왕복 · 다른 행의 암호문을 복사해 넣으면 복호화 실패 · 키 파일 제거 후 GET이 500이 아니라 "재등록 필요"
9. **화면** — `localhost:8787` 브라우저로 열어 실제 부트(state 주입 없이) → 탭·카드 렌더, 375px·1280px
10. **캐시 헤더** — `/`가 `no-cache`, `/js/main.js`에 ETag, 같은 ETag 재요청 304
11. **로그 위생** — 연결 등록 후 stdout에 앱키 문자열 없음
12. **원본 대조** — 라우트마다 `functions/api/*.js`와 나란히 읽어 응답 코드·헤더·에러 분기 누락 확인. **재작성이라 누락이 가장 큰 위험이다**
13. **Mac mini(운영, 이 단계 이후)** — `git pull` → `npm ci` → `pm2 start ecosystem.config.cjs` → 집 IP로 나가므로 키움·빗썸 등록 후 🏦 동기화 3사 성공(이번 이전의 핵심 성공 기준) → Tunnel → `/api/whoami`로 JWT 도달 확인 → 재부팅 후 자동 기동

## 14. 윈도우 개발 주의

- **Node 22.5 이상** (`node:sqlite`). Mac mini는 25.8 — 메이저를 맞추는 게 안전.
- 환경변수 주입 문법이 셸마다 다르다(`DEV_EMAIL=x node …`는 PowerShell 불가) → `.env` + `--env-file-if-exists`로 통일.
- PowerShell의 `curl`은 `Invoke-WebRequest` 별칭. **`curl.exe`**.
- `strings`가 없으면 `findstr /m "<앱키>" data\finance.db`.
- 줄바꿈 — 기존 파일이 LF다. 에디터 자동 CRLF 변환 주의.
- MCP playwright 없이 GUI 브라우저로 직접 확인하면 된다.

## 15. 사용자가 직접 해야 하는 것 (이 단계 이후, Mac mini)

1. `npm ci`, `npm i -g pm2`, `pm2 startup`(launchd 등록). Node 25.8과 pm2 호환은 여기서 실제 확인 — 문제면 `pm2 startup`이 만드는 launchd plist를 직접 쓴다
2. `~/.finance/env`에 `FRED_API_KEY`(권한 600). `DEV_EMAIL`은 넣지 않는다
3. `brew install cloudflared` → `cloudflared tunnel login` → 터널 생성 → **Pages 프로젝트에서 커스텀 도메인 분리**(같은 호스트명에 CNAME 둘 불가) → 터널 라우팅
4. 증권사 포털에 **집 공인 IP 등록**(키움·빗썸. 한투는 불필요)
5. API 키를 Mac mini로 옮기고 앱 설정 탭에서 연결 **재등록**(KV의 creds는 옮기지 않는다)
6. **FileVault 켜기**, **`~/.finance/secret.key`를 비밀번호 관리자에 백업**(DB 백업과 다른 곳에)
7. `data/`를 Time Machine 등 백업 대상에 포함. WAL이라 실행 중 `.db`만 복사하면 깨진다 — `sqlite3 data/finance.db ".backup <경로>"`

**데이터 이전** — 브라우저에서 `/api/portfolio?download=1`로 받아둔 JSON을, Tunnel이 뜬 뒤 로그인 상태에서 앱의 **JSON 가져오기**(설정 탭)로 넣으면 끝(`importJSON` → `saveState` → PUT, 형식 동일). Tunnel 전에 로컬에서 하려면 `DEV_EMAIL`이 실제 구글 이메일이어야 Access가 주는 이메일과 같은 행에 들어간다. Cloudflare KV 원본은 안정화 전까지 지우지 않는다.

## 16. 리스크 · 비목표

- **재작성 누락** — 검증 12번이 유일한 장치
- **Mac mini 다운/정전** — 봇이 알림 단계라 손실 없음. 자동주문 전환 전 재검토
- **집 IP 변경** — 증권사 재등록 필요(감지 스크립트는 후속)
- **암호화 키 분실** — 연결 재등록으로 복구되지만 키 백업 안 하면 반드시 겪는다
- **롤백** — Cloudflare DNS를 Pages로 되돌리면 즉시 복구. 그래서 안정화 전까지 Pages·KV를 지우지 않는다

비목표 — 트레이딩 봇 본체 · Cron 자동 스냅샷 · IP 변경 감지 · 자동주문 전환 · Cloudflare Pages/KV 정리 · 퇴직연금(DC)·금현물 수동 유지(증권사 API 미지원)

## 17. 참고 문서

- `CLAUDE.md` — 아키텍처 불변 조건·배포 철칙(`?v=` 스탬프)·절대 금지
- `SETUP.md`(같은 docs/) — Cloudflare·Google·Mac mini 설정. 5절 증권사 연결 등록, 6절 이전 절차, 7절 운영 치트시트
- `README.md` — 파일별 역할
- `ref/`(gitignore, Mac mini 로컬) — checklist·context-notes. 윈도우 세션은 못 보므로 이 문서 12절이 대신한다
