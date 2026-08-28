# 자산 포트폴리오 — fin.hansoljj.com

개인/지인용 자산 포트폴리오 추적 앱. Cloudflare 올인원 체제(Pages + Access + KV)로 운영하며, **로그인 계정별로 데이터가 분리**되는 다중 사용자 구조다.

- **접속**: <https://fin.hansoljj.com> — **Cloudflare Access 로그인**(구글 계정)을 통과해야 앱이 보인다. 별도 비밀번호 없음.
- **데이터**: Cloudflare KV에 **로그인한 계정별로 분리 저장**. 서버 API는 Access가 붙여준 통행증(JWT)을 서명 검증해 얻은 이메일로 사용자를 구분하므로, 다른 사용자의 데이터에 접근할 방법이 없다.
- **배포**: 이 repo에 push하면 Cloudflare Pages가 수십 초 안에 자동 배포.

## 아키텍처

```
[GitHub repo]  index.html + css/ + js/ + functions/api/  ← 코드만. 데이터 없음
      │ push = 자동 배포
      ▼
[Cloudflare]  fin.hansoljj.com
   ├─ Access: 로그인 관문 (구글 로그인만 하면 통과, 세션 30일)
   │    └─ 통과한 요청에 Cf-Access-Jwt-Assertion 헤더(서명된 JWT) 부착
   │       → 서버가 팀 공개키로 서명 검증 후 email 클레임 사용 (_lib/access.js)
   ├─ Pages: 정적 서빙 (index.html + css/ + js/)
   ├─ Functions (/api/*):
   │    ├─ GET/PUT /api/portfolio → KV, user:<이메일>: 키로 사용자별 분리
   │    │                           (+ 날짜별 버전 90일 보관 — 롤백용)
   │    └─ GET /api/proxy?url=    → 시세 프록시 (화이트리스트 도메인만, FRED 키 서버 주입)
   └─ KV(finance-data): user:<이메일>:portfolio:latest / ...:v:YYYY-MM-DD
```

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
| `functions/api/portfolio.js` | Pages Function — GET/PUT. `_lib/access.js`의 JWT 검증으로 얻은 이메일로 사용자를 구분해 `user:<이메일>:` 키에 읽고 씀. 검증 실패면 401. PUT마다 날짜별 버전 키도 기록(90일 보관) |
| `functions/api/proxy.js` | Pages Function — 시세 프록시. 허용 도메인 화이트리스트 밖은 403, FRED 요청엔 서버 보관 API 키를 주입(키가 클라이언트에 노출되지 않음) |
| `functions/api/broker.js` | Pages Function — 증권사 잔고 조회. 등록된 연결을 순회하며 provider 어댑터로 조회 전용 API만 호출하고, 소스별로 에러를 격리해 정규화 결과를 돌려준다. 접근 토큰은 연결 단위로 KV에 23시간 캐시 |
| `functions/api/broker-connections.js` | Pages Function — 증권사 연결(자격증명+조회할 계좌) 등록/삭제. `user:<이메일>:broker:connections`에 저장하며 조회 시 원본 대신 마스킹만 반환 |
| `functions/api/broker-discover.js` | Pages Function — 계좌 찾기. 한투처럼 계좌가 여러 개인 곳에서 후보를 순차 조회해 실제 존재하는 계좌를 보유 종목과 함께 알려준다 |
| `functions/api/whoami.js` | Pages Function — 진단용. 서버가 이 요청을 누구로 인식하는지(`verifiedEmail`) 반환. 401이 날 때 가장 먼저 열어볼 곳 |
| `functions/_lib/access.js` | **인증 핵심** — `Cf-Access-Jwt-Assertion` 헤더의 JWT를 팀 공개키(`/cdn-cgi/access/certs`)로 서명·`iss`·`aud` 검증한 뒤 email 클레임을 돌려준다(`getVerifiedEmail`). 모든 API가 사용자 식별에 이걸 쓴다. 상수 `TEAM_DOMAIN`·`APP_AUD`는 팀 이름 변경·Access 앱 재생성 시 갱신 필요 |
| `functions/_lib/providers.js` | 증권사 어댑터 레지스트리 — 증권사마다 다른 것(자격증명 필드·계좌 모드·호출 방법)만 선언. **새 증권사 지원 = 여기 항목 1개 + 정규화 함수 1개** |
| `functions/_lib/brokers.js` | 증권사 응답 정규화(네트워크 없는 순수 함수) — 키움 A접두사·zero-pad, 한투 D+2 예수금, 빗썸 KRW 분리 등 |
| `backups/` | 평문 JSON 백업 (**git 제외** — .gitignore) |

## 일상 사용

- **보기**: 아무 기기에서 접속 → 로그인 → 데이터 표시 (새 기기도 로그인만 하면 끝 — 데이터는 서버에만 있음)
- **수정**: 값을 고치면 **몇 초 안에 서버로 자동 저장** — 헤더의 ☁️ 인디케이터로 상태 확인, 다른 기기는 새로고침
- **이력**: 🔄 전체 시세 갱신을 하면 **오늘 날짜 스냅샷이 자동 기록**됨 (같은 날은 덮어쓰기)
- **백업**: 설정 탭 → 💾 JSON 백업 다운로드(서버 진본) 주기적으로. 서버에도 날짜별 버전이 90일 보관됨 (`/api/portfolio?version=YYYY-MM-DD`)
- **잔고 동기화**: 설정 탭에서 증권사 연결을 한 번 등록해두면, 자산 입력 탭 🏦 버튼으로 수량·평단·예수금을 실계좌에서 가져온다 (미리보기 확인 후 적용, 조회 전용). 대상은 한투 연금저축·ISA, 키움 국내·미국주식, 빗썸 — **퇴직연금(DC)·한투 금현물·은행 현금·부동산은 증권사 API가 지원하지 않아 수동 입력 유지**

## 사용자(친구) 추가

정책이 Include: **Everyone**(로그인은 필수, 대상은 제한 없음)이라 **주소만 공유하면 끝난다**. 새 사용자는 로그인 후 빈 포트폴리오에서 시작한다. 자리는 Zero Trust Free 50석이고 한 달 미접속 시 자동 회수된다.

특정인을 막을 때만 Cloudflare One → Access controls → Policies → `everyone` → Configure → **Exclude**에 이메일을 추가한다.

> ⚠️ 정직 고지: 데이터는 평문으로 KV에 저장되므로 **운영자(계정 소유자)는 기술적으로 사용자 데이터를 열람할 수 있다.** 친구를 초대할 때 이 점을 알리는 것을 권장. Cloudflare 계정 2FA 필수.

## Cloudflare 설정 (대시보드)

> 개념 설명과 정확한 메뉴·옵션명까지 포함한 전체 인프라 가이드는 **[SETUP.md](SETUP.md)** 참고. 아래는 요약.

- Pages 프로젝트 `finance` — repo 연결, 빌드 없음, 커스텀 도메인 fin.hansoljj.com
- Bindings: KV `finance-data` → 변수명 `KV` (**Production만** — 프리뷰 배포는 데이터 접근 불가)
- Secrets: `FRED_API_KEY`
- Zero Trust Access: 앱 `finance`, 정책 `everyone`(Include: Everyone — 로그인만 하면 통과), 세션 30일. 바인딩/시크릿 변경 시 Retry deployment 필요

## 복구 시나리오

- **잘못 저장/데이터 사고**: KV의 날짜별 버전(90일)으로 복원 — `GET /api/portfolio?version=...` 또는 대시보드 KV 브라우저
- **최후 안전망**: `backups/`의 평문 JSON → 설정 탭 "📂 JSON에서 복원" → 서버에 저장

## 히스토리

- ~2026-08: GitHub Pages + repo 내 암호문(portfolio.enc) 커밋 + 비밀번호 복호화 방식 — git 히스토리 참고
- 2026-08-25: Cloudflare 체제 이전(Access·KV) → 이후 2차 개편으로 암호화 층 제거, 계정별 다중 사용자 구조 전환, 코드 분할(css/js). 히스토리에 남은 portfolio.enc 커밋들은 폐기된 비밀번호의 암호문
- 2026-08-26: 인증을 Access JWT 서명 검증으로 교체(신 UI 앱이 이메일 헤더를 안 붙임) · 3차 개편 — 서버 단일 소스(localStorage 제거)·변경 시 자동 저장·시세 갱신 연동 자동 스냅샷·구글 로그인(IdP)
- 2026-08-27: 증권사 잔고 자동 동기화 구현 — 한투(연금저축·ISA)·키움(국내·미국)·빗썸. provider 어댑터 구조라 증권사 추가는 `_lib/providers.js` 항목 1개 + 정규화 함수 1개로 끝난다
