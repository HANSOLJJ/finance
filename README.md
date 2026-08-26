# 자산 포트폴리오 — fin.hansoljj.com

개인/지인용 자산 포트폴리오 추적 앱. Cloudflare 올인원 체제(Pages + Access + KV)로 운영하며, **로그인 계정별로 데이터가 분리**되는 다중 사용자 구조다.

- **접속**: <https://fin.hansoljj.com> — **Cloudflare Access 로그인**(구글/이메일 인증)을 통과해야 앱이 보인다. 별도 비밀번호 없음.
- **데이터**: Cloudflare KV에 **로그인한 계정별로 분리 저장**. 서버 API는 Access가 붙여주는 인증 이메일 헤더로 사용자를 구분하므로, 다른 사용자의 데이터에 접근할 방법이 없다.
- **배포**: 이 repo에 push하면 Cloudflare Pages가 수십 초 안에 자동 배포.

## 아키텍처

```
[GitHub repo]  index.html + css/ + js/ + functions/api/  ← 코드만. 데이터 없음
      │ push = 자동 배포
      ▼
[Cloudflare]  fin.hansoljj.com
   ├─ Access: 로그인 관문 (허용된 이메일만, 세션 30일)
   │    └─ 통과한 요청에 Cf-Access-Authenticated-User-Email 헤더 부착
   ├─ Pages: 정적 서빙 (index.html + css/ + js/)
   ├─ Functions (/api/*):
   │    ├─ GET/PUT /api/portfolio → KV, user:<이메일>: 키로 사용자별 분리
   │    │                           (+ 날짜별 버전 90일 보관 — 롤백용)
   │    └─ GET /api/proxy?url=    → 시세 프록시 (화이트리스트 도메인만, FRED 키 서버 주입)
   └─ KV(finance-data): user:<이메일>:portfolio:latest / ...:v:YYYY-MM-DD
```

## 코드 구성

빌드 도구 없는 클래식 스크립트 구조다. index.html이 js 9개를 `<script src>`로 순서대로 로드하며, **태그 순서가 곧 의존성 순서**(constants → state → calc → render → charts → data-io → fetch → sync → main)이므로 순서를 바꾸면 안 된다. 클래식 스크립트라 각 파일의 최상위 `let`/`const`/`function`은 전역으로 공유된다 — 뒤 파일이 앞 파일의 함수·변수를 그대로 쓴다.

| 경로 | 설명 |
|---|---|
| `index.html` | 앱 뼈대 (~440줄) — 헤더·환율 배지·탭 버튼과 5개 탭(대시보드/입력/분석/이력/설정)의 컨테이너 마크업만 담당. 실제 내용은 js가 렌더링으로 채움 |
| `css/app.css` | 전체 스타일 — 레이아웃·탭·입력 테이블·카드·차트 영역·토스트·반응형(모바일) 전부 이 한 파일 |
| `js/constants.js` | 앱의 불변 데이터 — 카테고리 정의(`CATEGORY_MAP`, 금액직접입력·USD 여부 플래그 포함)·자산 타입·차트 색상 팔레트·기본 목표 비중 |
| `js/state.js` | 전역 `state` 단일 객체 관리 — 기본값(`defaultState`), localStorage 로드/저장(`saveState`), 구버전 데이터 필드 보정(`migrateState`). holdings(보유 목록)·history(스냅샷 이력)·usdKrwRate(환율) 등이 여기 담김 |
| `js/calc.js` | 순수 계산 — 콤마 섞인 입력 파싱(`num`)·표시 포맷(`fmt*`), 보유 항목 KRW/USD 평가액(`holdingValue` — 금액직접입력·해외주식 환산 규칙 포함), 카테고리 합계·검산·P&L·세금 추정. DOM을 건드리지 않음 |
| `js/render.js` | UI 렌더링 — 탭 전환(`switchTab`)과 대시보드/입력 테이블/분석/이력/설정 탭의 DOM 생성·이벤트 처리. 렌더 후 차트 그리기는 charts.js에 위임 |
| `js/charts.js` | 시각화 — Chart.js(CDN 전역)로 도넛·라인 차트, 자체 구현 트리맵. 재렌더 시 기존 차트 인스턴스 destroy 후 재생성 |
| `js/data-io.js` | 데이터 입출력 — JSON 백업 다운로드(`exportJSON`)/복원(`importJSON`), 일별 스냅샷(`snapshot`)과 이력 보정. 서버와 무관한 파일 기반 안전망 |
| `js/fetch.js` | 외부 데이터 수집 — 국내·해외 주식 시세(네이버/야후), 코인(업비트/빗썸), 환율(frankfurter), 매크로 지표(FRED/BLS). 브라우저 CORS 제한 때문에 전부 같은 도메인의 `/api/proxy` 경유 |
| `js/sync.js` | 서버 동기화 — `savePortfolio`(state 전체를 `PUT /api/portfolio`)와 마지막 저장 시각 표시(`refreshSyncUI`). 누구 데이터로 저장되는지는 서버가 Access 로그인으로 판단 |
| `js/main.js` | 시작점 — 인라인 onclick용 window 노출, `bootstrap`(이 기기에 localStorage 있으면 그걸로, 없으면 `GET /api/portfolio`로 서버 로드) 후 `boot`(첫 렌더·환율 자동 갱신) |
| `functions/api/portfolio.js` | Pages Function — GET/PUT. Access가 붙여주는 인증 이메일 헤더로 사용자를 구분해 `user:<이메일>:` 키에 읽고 씀. 헤더 없으면 401. PUT마다 날짜별 버전 키도 기록(90일 보관) |
| `functions/api/proxy.js` | Pages Function — 시세 프록시. 허용 도메인 화이트리스트 밖은 403, FRED 요청엔 서버 보관 API 키를 주입(키가 클라이언트에 노출되지 않음) |
| `backups/` | 평문 JSON 백업 (**git 제외** — .gitignore) |

## 일상 사용

- **보기**: 아무 기기에서 접속 → 로그인 → 데이터 표시 (새 기기도 로그인만 하면 끝)
- **수정·저장**: 수정 후 설정 탭 → **☁️ 서버에 저장** → 즉시 반영, 다른 기기는 새로고침
- **백업**: 설정 탭 → 💾 JSON 백업 다운로드 주기적으로. 서버에도 날짜별 버전이 90일 보관됨 (`/api/portfolio?version=YYYY-MM-DD`)

## 사용자(친구) 추가

Zero Trust → Access → 애플리케이션 `finance` 정책의 Include → Emails에 지메일 추가 (Free 50명). 새 사용자는 로그인 후 빈 포트폴리오에서 시작한다.

> ⚠️ 정직 고지: 데이터는 평문으로 KV에 저장되므로 **운영자(계정 소유자)는 기술적으로 사용자 데이터를 열람할 수 있다.** 친구를 초대할 때 이 점을 알리는 것을 권장. Cloudflare 계정 2FA 필수.

## Cloudflare 설정 (대시보드)

- Pages 프로젝트 `finance` — repo 연결, 빌드 없음, 커스텀 도메인 fin.hansoljj.com
- Bindings: KV `finance-data` → 변수명 `KV` (**Production만** — 프리뷰 배포는 데이터 접근 불가)
- Secrets: `FRED_API_KEY`
- Zero Trust Access: 앱 `finance`, 이메일 허용 목록, 세션 30일. 바인딩/시크릿 변경 시 Retry deployment 필요

## 복구 시나리오

- **잘못 저장/데이터 사고**: KV의 날짜별 버전(90일)으로 복원 — `GET /api/portfolio?version=...` 또는 대시보드 KV 브라우저
- **최후 안전망**: `backups/`의 평문 JSON → 설정 탭 "📂 JSON에서 복원" → 서버에 저장

## 히스토리

- ~2026-08: GitHub Pages + repo 내 암호문(portfolio.enc) 커밋 + 비밀번호 복호화 방식 — git 히스토리 참고
- 2026-08-25: Cloudflare 체제 이전(Access·KV) → 이후 2차 개편으로 암호화 층 제거, 계정별 다중 사용자 구조 전환, 코드 분할(css/js). 히스토리에 남은 portfolio.enc 커밋들은 폐기된 비밀번호의 암호문
