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

| 경로 | 설명 |
|---|---|
| `index.html` | 앱 뼈대 HTML (~440줄) |
| `css/app.css` | 전체 스타일 |
| `js/constants.js` | 카테고리·자산타입·색상·기본 목표 비중 |
| `js/state.js` | state 관리 — localStorage 로드/저장·마이그레이션 |
| `js/calc.js` | 합계·검산·P&L·세금 추정 |
| `js/render.js` | 탭·대시보드/분석/이력/설정 렌더링 |
| `js/charts.js` | Chart.js 차트·트리맵 |
| `js/data-io.js` | JSON 백업/복원·스냅샷·이력 보정 |
| `js/fetch.js` | 시세·환율·FRED/BLS 수집 (프록시 경유) |
| `js/sync.js` | 서버(KV) 저장 |
| `js/main.js` | 부트스트랩 — localStorage 우선, 없으면 서버 로드 |
| `functions/api/` | Pages Functions (API — 인증 코드 없음, Access가 엣지에서 차단) |
| `backups/` | 평문 JSON 백업 (**git 제외**) |

클래식 스크립트 분할 — index.html의 `<script src>` 순서가 곧 의존성 순서이므로 태그 순서를 바꾸지 말 것.

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
