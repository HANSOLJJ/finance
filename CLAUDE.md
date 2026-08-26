# CLAUDE.md — finance 프로젝트 규칙

개인 자산 포트폴리오 SPA. 바닐라 JS(빌드 없음) + Cloudflare Pages/Functions/KV, 인증은 Cloudflare Access(구글 로그인). 배포는 main push = 자동 배포 (fin.hansoljj.com). **공개 repo다 — 개인정보·자격증명이 커밋되지 않게 항상 의식할 것.**

## 아키텍처 불변 조건 (깨면 앱이 죽는다)

- **클래식 스크립트 로드 순서 고정**: constants → state → calc → render → charts → data-io → fetch → sync → main. ES 모듈 아님, 전역 스코프 공유. index.html 하단의 나열 순서를 바꾸지 말 것.
- **서버 단일 소스**: localStorage에 데이터를 저장하지 않는다. 부트는 `GET /api/portfolio` 단일 경로, 저장은 `saveState()` → 2초 디바운스 자동 업로드(sync.js). 새 수정 핸들러는 `saveState()`만 부르면 저장까지 이어진다.
- **인증**: Functions는 `functions/_lib/access.js`의 JWT 서명 검증으로 이메일을 얻는다 (헤더 신뢰 금지). Access 앱을 재생성하면 `APP_AUD` 상수 갱신 필요.
- **부채 카테고리는 자산이 아니다**: 모든 자산 축 집계는 `assetHoldings()`(부채 제외) 기반. 새 집계 코드에서 `state.holdings`를 직접 돌리면 부채가 섞인다.
- 집계 3축 = 카테고리 / 자산타입(assetType) / 통화노출(exposure). 축별 정의는 constants.js.

## 배포 철칙 — ?v= 캐시 스탬프

**js/css를 수정해 배포할 때는 index.html의 `?v=YYYYMMDD…` 스탬프를 반드시 함께 올린다.** index.html은 항상 재검증되므로 스탬프 갱신 = js/css 강제 새로받기. 스탬프를 안 올리면 "신 HTML + 구 JS 캐시" 어긋남으로 폰에서 렌더 체인이 통째로 죽는 사고가 난다 (2026-08-26 실제 발생, context-notes 참조).

## 절대 금지

- `backups/` 커밋·삭제 금지 (평문 백업, 유일한 복구 수단. gitignore 되어 있음)
- `screencapture/`, `config/` 커밋 금지 (개인 스크린샷·OAuth secret)
- API 키·토큰을 코드/커밋에 넣지 않기. 서버 비밀은 Cloudflare 대시보드 환경변수로
- 자격증명 입력은 사용자가 직접 (Claude가 대시보드에 입력하지 않는다)

## 검증 루틴

- 수정한 js는 `node --check`부터.
- 로컬 확인: `.claude/launch.json`의 `finance-static`(python http.server 8124) → 부트 실패 배너가 뜨는 게 정상(API 없음)이고 `syncEnabled=false`라 어떤 조작도 서버에 안 간다. javascript_tool로 테스트 state 주입 + `render()` 호출로 화면 검증.
- 모바일은 375x812 에뮬레이션 + 데스크톱 1280px 회귀 확인. 반응형 분기는 1200/1024/768px 세 지점(app.css).
- 로컬 브라우저 캐시가 완고함: force reload가 안 먹으면 cache-bust 쿼리로 `<script>`/`<link>` 주입. 단 render.js는 top-level const 때문에 같은 페이지 재주입 불가 — 별도 테스트 html로.

## 문서 지도

- `README.md` 구조·사용법 / `SETUP.md` Cloudflare·Google 설정 (정확한 새 UI 메뉴명 기준)
- `TODO.md` 백로그 / `checklist.md`·`context-notes.md` 진행 기록·결정 이유 (gitignore, 세션 인수인계용 — 작업 후 갱신)
- 계획 파일: `~/.claude/plans/eager-knitting-orbit.md` (개편 단위로 교체)
