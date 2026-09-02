# 자산 포트폴리오 — fin.hansoljj.com

개인/지인용 자산 포트폴리오 추적 앱. **로그인 계정별로 데이터가 분리**되는 다중 사용자 구조다.

- **접속**: <https://fin.hansoljj.com> — **Cloudflare Access 로그인**(구글 계정)을 통과해야 앱이 보인다. 별도 비밀번호 없음.
- **데이터**: **로그인한 계정별로 분리 저장**. 서버 API는 Access가 붙여준 통행증(JWT)을 서명 검증해 얻은 이메일로 사용자를 구분하므로, 다른 사용자의 데이터에 접근할 방법이 없다.
- **서버(2026-08-31 전환 완료)**: 증권사 API의 호출 IP 등록 요구와 트레이딩 봇(24/7) 계획 때문에 Cloudflare Pages Functions/KV 에서 **Mac mini 자립 Node 서버**(`server/`, Express + SQLite, pm2, Cloudflare Tunnel 경유)로 옮겼다. Cloudflare 는 DNS·Access 로그인·Tunnel 만 담당. 구 Pages 체제(Pages 프로젝트·KV·`functions/`)는 2026-09-02 정리 완료. 이전 기록은 [docs/handover.md](docs/handover.md).
- **배포**: main push 뒤 Mac mini 에서 `git pull` → (의존성 변경 시 `npm ci`) → `pm2 restart finance`. 자동 배포는 없다.

## 아키텍처

**현재 운영** — Cloudflare는 DNS·Access 로그인·Tunnel 만 맡고 앱은 Mac mini 에서 돈다.

```
브라우저 → Cloudflare (DNS · Access 구글 로그인 · Tunnel)
              ↓ 아웃바운드 터널 (공유기 포트 개방 불필요)
         [Mac mini] Node/Express 127.0.0.1:8787  (pm2)
           ├─ 정적 서빙 (index.html · css/ · js/)
           ├─ /api/*  (server/routes/) — 원본 Functions 와 응답 1:1
           ├─ data/finance.db (SQLite) — portfolio 원문 + 날짜 버전, 증권사 연결(자격증명 AES-256-GCM 암호화), 토큰 캐시
           └─ (후속) 트레이딩 봇 상주 프로세스
              ↓ 아웃바운드 = 집 고정 공인 IP → 한투 · 키움 · 빗썸
```

구 Pages 체제(~2026-08-31)의 구조와 코드는 git 히스토리(`functions/`, 2026-09-02 삭제)와 [docs/handover.md](docs/handover.md) 참고.

## 코드 구성

빌드 도구 없는 클래식 스크립트 구조다. index.html이 js 10개를 `<script src>`로 순서대로 로드하며, **태그 순서가 곧 의존성 순서**(constants → state → calc → render → charts → data-io → fetch → sync → broker → main)이므로 순서를 바꾸면 안 된다. 클래식 스크립트라 각 파일의 최상위 `let`/`const`/`function`은 전역으로 공유된다 — 뒤 파일이 앞 파일의 함수·변수를 그대로 쓴다.

| 경로 | 설명 |
|---|---|
| `index.html` | 앱 뼈대 (~500줄) — 헤더·환율 배지·탭 버튼과 5개 탭(대시보드/입력/분석/이력/설정)의 컨테이너 마크업만 담당. 실제 내용은 js가 렌더링으로 채움 |
| `css/app.css` | 전체 스타일 — 레이아웃·탭·입력 테이블·카드·차트 영역·토스트·반응형(모바일) 전부 이 한 파일 |
| `js/constants.js` | 앱의 불변 데이터 — 카테고리 정의(`CATEGORY_MAP`, 금액직접입력·USD 여부 플래그 포함)·자산 타입·차트 색상 팔레트·기본 목표 비중 |
| `js/state.js` | 전역 `state` 단일 객체 관리 — 기본값(`defaultState`), 변경 영속화 진입점(`saveState` — 서버 자동 저장 예약), 구버전 데이터 필드 보정(`migrateState`). holdings(보유 목록)·history(스냅샷 이력)·usdKrwRate(환율) 등이 여기 담김 |
| `js/calc.js` | 순수 계산 — 콤마 섞인 입력 파싱(`num`)·표시 포맷(`fmt*`), 보유 항목 KRW/USD 평가액(`holdingValue` — 금액직접입력·해외주식 환산 규칙 포함), 카테고리 합계·검산·P&L·세금 추정. DOM을 건드리지 않음 |
| `js/render.js` | UI 렌더링 — 탭 전환(`switchTab`)과 대시보드/입력 테이블/분석/이력/설정 탭의 DOM 생성·이벤트 처리. 렌더 후 차트 그리기는 charts.js에 위임 |
| `js/charts.js` | 시각화 — Chart.js(CDN 전역)로 도넛·라인 차트, 자체 구현 트리맵. 재렌더 시 기존 차트 인스턴스 destroy 후 재생성 |
| `js/data-io.js` | 데이터 입출력 — JSON 백업 다운로드(`exportJSON`)/복원(`importJSON`), 일별 스냅샷(`snapshot`)과 이력 보정. 서버와 무관한 파일 기반 안전망 |
| `js/fetch.js` | 외부 데이터 수집 — 국내·해외 주식 시세(네이버/야후), 코인(업비트/빗썸), 환율(frankfurter), 매크로 지표(FRED/BLS). 브라우저 CORS 제한 때문에 전부 같은 도메인의 `/api/proxy` 경유 |
| `js/sync.js` | 서버 자동 저장 — 변경 시 2초 디바운스 업로드(`scheduleServerSave`), 즉시 저장(`flushServerSave`/`savePortfolio`), 헤더 ☁️ 인디케이터. 부트 성공 전엔 저장 잠금. 누구 데이터로 저장되는지는 서버가 Access 로그인으로 판단 |
| `js/broker.js` | 증권사 잔고 동기화 — 자산 입력 탭 🏦 버튼이 `/api/broker` 조회 후 `computeBrokerDiff`로 변경/신규/삭제/예수금 미리보기를 띄우고, [적용] 시에만 반영. 동기화가 만든 행(`h.source` 마커)만 갱신·삭제하고 수동 입력 행은 건드리지 않는다. 설정 탭 🔗 증권사 연결 관리(추가/수정/삭제·계좌 찾기)도 담당 |
| `js/main.js` | 시작점 — 인라인 onclick용 window 노출, `bootstrap`(서버 로드 단일 경로 — 404는 신규, 실패 시 저장 잠금+재시도 배너) 후 `boot`(첫 렌더·환율 자동 갱신) |
| `server/index.js` | **Node 서버 진입점**(Express 5, ESM) — 정적 3개(`/`·`/css`·`/js`)만 명시 서빙(루트 통째 서빙 금지), `/api/*` 라우팅, 본문은 `express.text({type: () => true})`로 원문 수신(클라이언트가 Content-Type 없이 보내므로), 에러 미들웨어(본문 로깅 금지), 127.0.0.1:8787 바인드, SIGINT/SIGTERM 시 DB 닫기 |
| `server/lib/db.js` | SQLite(`node:sqlite`, 의존성 0) — WAL, 테이블 3개(`portfolio`·`broker_connection`·`broker_token`), 질의 함수. 연결의 creds 는 여기서 암·복호화하며 복호 실패 행은 `credsError`로 돌려줘 서버가 죽지 않는다 |
| `server/lib/secret.js` | 자격증명 암호화 — AES-256-GCM, AAD=`email\|conn_id`(행 바꿔치기 차단), 키는 `~/.finance/secret.key`(hex 64자, `data/` 밖이라 DB 백업에 안 딸려감, 없으면 생성) |
| `server/lib/access.js` | **인증 핵심** — `Cf-Access-Jwt-Assertion` 헤더의 JWT를 팀 공개키(`/cdn-cgi/access/certs`)로 서명·`iss`·`aud` 검증해 email 클레임을 얻는다(`getVerifiedEmail`) + `requireAuth` 미들웨어. 상수 `TEAM_DOMAIN`·`APP_AUD`는 팀 이름 변경·Access 앱 재생성 시 갱신 필요. `.env`의 `DEV_EMAIL` 로컬 우회(운영 금지) |
| `server/lib/providers.js` | 증권사 어댑터 레지스트리 — 증권사마다 다른 것(자격증명 필드·계좌 모드·호출 방법)만 선언. **새 증권사 지원 = 여기 항목 1개 + 정규화 함수 1개**. 접근 토큰은 연결 단위로 DB에 23시간 캐시 |
| `server/lib/brokers.js` | 증권사 응답 정규화(네트워크 없는 순수 함수) — 키움 A접두사·zero-pad, 한투 D+2 예수금, 빗썸 KRW 분리 등 |
| `server/routes/*.js` | `portfolio` `whoami` `proxy` `broker` `broker-connections` `broker-discover` — 구 Pages Functions 응답 계약과 1:1(코드·헤더·문구). 프록시는 화이트리스트 도메인만 통과·FRED 키 서버 주입·upstream 바디 스트림 패스스루(EUC-KR 응답 보존). broker 계열은 조회 전용 API만 호출·소스별 에러 격리·creds 마스킹 반환 |
| `ecosystem.config.cjs` · `package.json` | pm2 설정(`~/.finance/env`를 `--env-file`로, 비밀 없음) · 스크립트 `dev`(`.env` 사용)/`start`. 의존성은 express 하나 |
| `backups/` | 평문 JSON 백업 (**git 제외** — .gitignore) |

## 일상 사용

- **보기**: 아무 기기에서 접속 → 로그인 → 데이터 표시 (새 기기도 로그인만 하면 끝 — 데이터는 서버에만 있음)
- **수정**: 값을 고치면 **몇 초 안에 서버로 자동 저장** — 헤더의 ☁️ 인디케이터로 상태 확인, 다른 기기는 새로고침
- **이력**: 🔄 전체 시세 갱신을 하면 **오늘 날짜 스냅샷이 자동 기록**됨 (같은 날은 덮어쓰기)
- **백업**: 설정 탭 → 💾 JSON 백업 다운로드(서버 진본) 주기적으로. 서버에도 날짜별 버전이 보관됨 (`/api/portfolio?version=YYYY-MM-DD`, 만료 없음)
- **잔고 동기화**: 설정 탭에서 증권사 연결을 한 번 등록해두면, 자산 입력 탭 🏦 버튼으로 수량·평단·예수금을 실계좌에서 가져온다 (미리보기 확인 후 적용, 조회 전용). 대상은 한투 연금저축·ISA, 키움 국내·미국주식, 빗썸 — **퇴직연금(DC)·한투 금현물·은행 현금·부동산은 증권사 API가 지원하지 않아 수동 입력 유지**

## 사용자(친구) 추가

정책이 Include: **Everyone**(로그인은 필수, 대상은 제한 없음)이라 **주소만 공유하면 끝난다**. 새 사용자는 로그인 후 빈 포트폴리오에서 시작한다. 자리는 Zero Trust Free 50석이고 한 달 미접속 시 자동 회수된다.

특정인을 막을 때만 Cloudflare One → Access controls → Policies → `everyone` → Configure → **Exclude**에 이메일을 추가한다.

> ⚠️ 정직 고지: 포트폴리오 데이터는 평문으로 저장되므로(Mac mini SQLite) **운영자(계정 소유자)는 기술적으로 사용자 데이터를 열람할 수 있다.** 친구를 초대할 때 이 점을 알리는 것을 권장. Cloudflare 계정 2FA 필수. 증권사 자격증명은 서버에서 AES-256-GCM 으로 암호화 저장되지만(DB 파일·백업만 새는 경우 방어), 키가 같은 기기에 있으므로 서버 자체가 털리는 경우까지 막지는 못한다.

## Cloudflare 설정 (대시보드)

> 개념 설명과 정확한 메뉴·옵션명까지 포함한 전체 인프라 가이드는 **[docs/SETUP.md](docs/SETUP.md)** 참고 (서버 재시작·배포·DB 조회는 7절 운영 치트시트). 아래는 요약.

- Zero Trust Tunnel `finance` — Mac mini 의 cloudflared 가 유지, `fin.hansoljj.com → 127.0.0.1:8787` (docs/SETUP.md 6절)
- Zero Trust Access: 앱 `finance`, 정책 `everyone`(Include: Everyone — 로그인만 하면 통과), 세션 30일

## 복구 시나리오

- **잘못 저장/데이터 사고**: 날짜별 버전으로 복원 — `GET /api/portfolio?version=YYYY-MM-DD`. `data/finance.db`의 `portfolio` 행에 만료 없이 보관 (`sqlite3 data/finance.db ".backup <경로>"`로 정기 백업)
- **최후 안전망**: `backups/`의 평문 JSON → 설정 탭 "📂 JSON에서 복원" → 서버에 저장
- **암호화 키 분실**(`~/.finance/secret.key`): 증권사 연결만 "재등록 필요"로 표시되고 포트폴리오는 무관 — 설정 탭에서 연결을 다시 등록하면 된다

## 히스토리

- ~2026-08: GitHub Pages + repo 내 암호문(portfolio.enc) 커밋 + 비밀번호 복호화 방식 — git 히스토리 참고
- 2026-08-25: Cloudflare 체제 이전(Access·KV) → 이후 2차 개편으로 암호화 층 제거, 계정별 다중 사용자 구조 전환, 코드 분할(css/js). 히스토리에 남은 portfolio.enc 커밋들은 폐기된 비밀번호의 암호문
- 2026-08-26: 인증을 Access JWT 서명 검증으로 교체(신 UI 앱이 이메일 헤더를 안 붙임) · 3차 개편 — 서버 단일 소스(localStorage 제거)·변경 시 자동 저장·시세 갱신 연동 자동 스냅샷·구글 로그인(IdP)
- 2026-08-27: 증권사 잔고 자동 동기화 구현 — 한투(연금저축·ISA)·키움(국내·미국)·빗썸. provider 어댑터 구조라 증권사 추가는 `_lib/providers.js` 항목 1개 + 정규화 함수 1개로 끝난다
- 2026-08-31: 서버를 Mac mini 자립 Node 서버로 재작성(`server/` — Express + `node:sqlite`, 자격증명 암호화). 키움·빗썸의 호출 IP 등록 요구(Workers 는 고정 IP 없음)와 트레이딩 봇 계획이 동기. 같은 날 Tunnel 전환·데이터 이전·3사 연결 재등록까지 완료
- 2026-09-02: 구 Pages 체제 정리 — Cloudflare Pages 프로젝트·KV namespace 삭제(대시보드), repo 의 `functions/` 삭제. 롤백 경로 종료, 이후 복구 수단은 SQLite 날짜 버전·`backups/`
