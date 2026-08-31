# CLAUDE.md — finance 프로젝트 규칙

개인 자산 포트폴리오 SPA. 바닐라 JS(빌드 없음), 인증은 Cloudflare Access(구글 로그인). **서버를 Cloudflare Pages Functions/KV 에서 Mac mini 자립 Node 서버(`server/`, Express + SQLite)로 옮기는 중이다** — `server/`는 완성·검증됐고, Tunnel 전환 전까지 운영(fin.hansoljj.com)은 아직 Pages(`functions/`)다. main push = Pages 자동 배포. **공개 repo다 — 개인정보·자격증명이 커밋되지 않게 항상 의식할 것.**

## 아키텍처 불변 조건 (깨면 앱이 죽는다)

- **클래식 스크립트 로드 순서 고정**: constants → state → calc → render → charts → data-io → fetch → sync → broker → main. ES 모듈 아님, 전역 스코프 공유. index.html 하단의 나열 순서를 바꾸지 말 것.
- **서버 단일 소스**: localStorage에 데이터를 저장하지 않는다. 부트는 `GET /api/portfolio` 단일 경로, 저장은 `saveState()` → 2초 디바운스 자동 업로드(sync.js). 새 수정 핸들러는 `saveState()`만 부르면 저장까지 이어진다.
- **인증**: 서버는 `server/lib/access.js`(구 `functions/_lib/access.js`, 전환기엔 둘 다)의 JWT 서명 검증으로 이메일을 얻는다 (헤더 신뢰 금지). Access 앱을 재생성하면 `APP_AUD` 상수 갱신 필요. 로컬 개발 우회 `DEV_EMAIL`은 `.env`에만 — **운영 env 파일·pm2 설정에 절대 넣지 않는다**(로그인 없이 남의 데이터 접근 가능).
- **서버는 127.0.0.1:8787 에만 바인드**: 외부 접속은 Cloudflare Tunnel 경로 하나뿐이어야 Access 로그인이 성립한다. `/api/proxy`는 원본대로 무인증이므로 0.0.0.0 으로 열면 LAN 오픈 프록시가 된다.
- **부채 카테고리는 자산이 아니다**: 모든 자산 축 집계는 `assetHoldings()`(부채 제외) 기반. 새 집계 코드에서 `state.holdings`를 직접 돌리면 부채가 섞인다.
- 집계 3축 = 카테고리 / 자산타입(assetType) / 통화노출(exposure). 축별 정의는 constants.js.
- **증권사 추가는 어댑터 1곳**: `server/lib/providers.js` 에 항목 1개(자격증명 필드·계좌 모드·호출 함수) + `server/lib/brokers.js` 에 정규화 함수 1개면 끝난다 (전환기엔 `functions/_lib/` 사본도 동일하게). 설정 화면·저장 구조·diff 는 그 선언을 읽어 동작하므로 수정하지 말 것 — 증권사별 분기를 다른 파일에 넣는 순간 확장성이 깨진다.
- **증권사 동기화의 소유권 마커**: `h.source`(소스 id, 예수금은 `<id>:cash`)가 찍힌 행만 동기화가 갱신·삭제한다. 수동 입력 행(`source: ''`)은 절대 삭제하지 않으며, 실패한 소스는 diff에서 통째로 스킵해 "장애 = 전량 매도" 오판을 막는다. 새 행 생성 코드를 추가하면 `source`/`syncedAt` 기본값도 함께 넣을 것 (state.js·render.js·data-io.js 3곳 + migrateState).

## 배포 철칙 — ?v= 캐시 스탬프

**js/css를 수정해 배포할 때는 index.html의 `?v=YYYYMMDD…` 스탬프를 반드시 함께 올린다.** index.html은 항상 재검증되므로 스탬프 갱신 = js/css 강제 새로받기. 스탬프를 안 올리면 "신 HTML + 구 JS 캐시" 어긋남으로 폰에서 렌더 체인이 통째로 죽는 사고가 난다 (2026-08-26 실제 발생, context-notes 참조).

## 절대 금지

- `backups/` 커밋·삭제 금지 (평문 백업, 유일한 복구 수단. gitignore 되어 있음)
- `screencapture/`, `config/` 커밋 금지 (개인 스크린샷·OAuth secret)
- `data/`(SQLite 실데이터)·`.env`(DEV_EMAIL)·`ref/`(작업 노트) 커밋 금지 — 전부 gitignore 돼 있지만 `git add -A` 전에 `git status`로 확인
- API 키·토큰을 코드/커밋에 넣지 않기. 서버 비밀은 Mac mini `~/.finance/env`(`FRED_API_KEY`)로, 전환 전까지의 Pages는 Cloudflare 대시보드 환경변수로. 증권사 자격증명은 앱 설정 탭에서 등록 → 서버가 `~/.finance/secret.key`로 암호화해 DB에 저장
- 자격증명 입력은 사용자가 직접 (Claude가 대시보드에 입력하지 않는다)

## 검증 루틴

- **구현은 Windows PC, 운영은 Mac mini(SSH 터미널 전용, GUI 없음)** — 어느 쪽이든 화면 검증은 **MCP playwright**로 한다(`~/.claude.json`에 연결돼 있고 브라우저도 설치돼 있다 — repo에 npm 의존성을 추가하지 말 것). 요소 존재·텍스트 확인은 `browser_snapshot`(접근성 트리 텍스트)이 스크린샷보다 정확하고 싸다. 레이아웃을 봐야 할 때만 `browser_resize` 375x812·1280px 후 캡처. 해시만 바뀌는 `#tab` 이동은 페이지를 재로드하지 않으니 서버를 바꾼 뒤엔 `?x=1` 같은 쿼리를 붙여 다시 연다. 운영 도메인은 Cloudflare Access 구글 로그인 때문에 헤드리스로 열리지 않으니 로컬 서버로만 검증하고, 실물 확인은 폰 등 다른 기기에서 한다.
- 수정한 js는 `node --check`부터. 서버 파일은 `server/**/*.js` 전부.
- 로컬 확인: `.env`에 `DEV_EMAIL=test@x.com`을 두고 `.claude/launch.json`의 `finance-server`(`node --env-file-if-exists=.env server/index.js`, 127.0.0.1:8787). **API가 살아 있으므로 부트 성공·자동 저장이 로컬 `data/finance.db`로 실제 들어간다** — 실데이터 검증이 필요하면 `/api/portfolio?download=1`로 받은 JSON을 설정 탭 "JSON에서 복원"으로 넣는다. API는 PowerShell에서 `curl.exe`(별칭 `curl`은 Invoke-WebRequest), DB는 `sqlite3 data/finance.db`. **Windows 함정**: 같은 포트 중복 listen이 조용히 성공하므로 재기동 전 `netstat -ano | grep 8787`로 확인, 백그라운드 서버는 npm 경유 말고 node 직접 실행(중지 시 고아 방지), 강제 종료는 SIGINT 핸들러를 안 거치므로 graceful shutdown 검증은 Mac mini에서.
- 모바일은 375x812 에뮬레이션 + 데스크톱 1280px 회귀 확인. 반응형 분기는 1200/1024/768px 세 지점(app.css).
- 로컬 브라우저 캐시가 완고함: force reload가 안 먹으면 cache-bust 쿼리로 `<script>`/`<link>` 주입. 단 render.js는 top-level const 때문에 같은 페이지 재주입 불가 — 별도 테스트 html로. Playwright는 매 실행이 새 브라우저 컨텍스트라 이 문제가 아예 없다.

## 문서 지도

- `README.md` 구조·사용법 / `SETUP.md` Cloudflare·Google 설정 (정확한 새 UI 메뉴명 기준) + 8절 Mac mini 자립 서버 운영
- `TODO.md` 백로그 / `ref/` **커밋 금지 작업 노트**(gitignore) — `ref/checklist.md` 진행 기록, `ref/context-notes.md` 결정 이유. 읽고 참조만 하고 repo 로 옮기지 말 것. 작업 후 갱신
- `references/` 투자 판단 참고자료. **앱 코드와 무관하니 SPA 작업 시엔 읽지 말 것.**
  - `AI기업_9factor_채점표_2026-08.md` — AI 12개사 정성 채점표 **규칙 정본**(v1.4). 채점 관련 판단은 항상 이 파일이 이김
  - `AI기업_9factor_자동화_설계.md` — 채점 일부를 코드로 뽑기 위한 설계 노트. **원자료를 저장하고 점수는 함수로 계산**(규칙 개정 시 소급 재채점)이 핵심 전제
  - `AI기업_채점표_2026-08.html`(`D` 배열 하나가 전체 시각화 구동) · `채점이력.csv` · `check_채점표.py`(MD↔HTML 정합성 검사기 — 통과 전 배포 금지)
- 현재 계획: `handover.md` (6차 — Mac mini 자립 서버 이전. 계획 전문 + 진행 기록 12절. 다른 기기의 세션도 이 파일만으로 이어받는다. 개편 단위로 교체)
