# 인프라 설정 가이드 — Cloudflare · Google · Mac mini

이 앱을 돌리는 데 쓰인 모든 외부 서비스·서버 설정을, **왜 필요한지(개념)** 와 **정확한 메뉴·옵션명(2026-08 새 UI 기준)** 으로 정리한 문서다. 코드는 repo에 있지만 이 설정들은 대시보드와 Mac mini에만 존재하므로, 계정을 옮기거나 처음부터 다시 만들 때는 이 문서가 유일한 지도다.

- 절 순서 = 현재 체제 기준. **0~5절 = 지금 돌아가는 것**, 6~7절 = Mac mini 서버 구축·운영, 8절 = 자주 하는 작업.
- Cloudflare 쪽 명칭은 **새 Cloudflare One 대시보드**(구 Zero Trust) 기준.
- Google 쪽 명칭은 **Google 인증 플랫폼**(console.cloud.google.com, 한국어 UI) 기준.
- UI는 계속 개편되므로 메뉴 위치가 다르면 대시보드 상단 **Quick search(Ctrl+K)** 에 항목명을 검색하면 찾아진다.

---

## 0. 전체 그림 — 접속 한 번이 지나가는 길 (2026-08-31 Mac mini 체제)

```text
브라우저에서 fin.hansoljj.com 입력
  │
  ▼
① DNS ─ "fin.hansoljj.com이 어디냐"를 Cloudflare가 답해줌 (터널을 가리키는 CNAME)
  │
  ▼
② Access (경비실) ─ 로그인 안 했으면 구글 로그인으로 보내고, 했으면 통행증(JWT)을 붙여 통과
  │
  ▼
③ Tunnel ─ Mac mini의 cloudflared가 미리 열어둔 아웃바운드 터널로 요청 전달 (공유기 포트 개방 불필요)
  │
  ▼
④ Mac mini Node 서버 (server/, Express, 127.0.0.1:8787, pm2) ─ 정적 서빙 + /api/* 실행
  │
  ▼
⑤ SQLite (data/finance.db) ─ 사용자별 portfolio·증권사 연결(암호화)·토큰 캐시
```

로그인 기능은 여전히 코드에 없다 — ②의 Access가 사이트 앞단에서 대신 해주고, 서버는 통행증(JWT)의 서명만 검증한다(4절). 증권사 API 호출이 Mac mini에서 나가므로 출발 IP가 집 공인 IP로 고정된다 — 키움·빗썸의 호출 IP 등록 요구(5절)가 이걸로 풀렸다. 구 Pages 체제(~2026-08-31)는 2026-09-02에 정리했다 — Pages 프로젝트·KV namespace 삭제, repo 의 `functions/` 제거.

## 1. 도메인 — hansoljj.com

**개념.** 도메인은 인터넷 주소의 이름이고, DNS는 그 이름을 실제 서버 위치로 바꿔주는 전화번호부다. Registrar는 도메인을 파는 등록 대행사다.

**우리 설정.** hansoljj.com을 Cloudflare Registrar에서 구입했고 DNS도 Cloudflare가 관리한다. `fin.` 레코드는 터널 생성 시(`cloudflared tunnel route dns`) 자동으로 만들어진 CNAME이고, `arena.` 는 Pages 커스텀 도메인 연결 때 자동 생성된 것이다.

- 위치 — Cloudflare 대시보드 → 계정 홈 → **hansoljj.com** → **DNS** → Records.
- 자동 생성된 CNAME 레코드는 손대지 말 것. 지우면 해당 서브도메인이 죽는다.

## 2. Cloudflare One (Access) — 로그인 관문

**개념.** Access는 사이트 **앞**에 세우는 경비실이다. 요청이 오리진(지금은 Tunnel 너머의 Mac mini)에 닿기 전에 Cloudflare 데이터센터(엣지)에서 로그인 여부를 검사하고, 통과한 요청에만 서명된 통행증(JWT, 4절 참고)을 붙여 들여보낸다. 덕분에 앱 코드에는 로그인 코드가 한 줄도 없고, **오리진을 Pages에서 Mac mini로 바꿔도 Access 설정은 그대로다.**

진입 — Cloudflare 대시보드에서 Zero Trust(Cloudflare One)로 이동. 팀 정보는 **Settings** → **Team name and domain** 에 있다.

- Team name `tight-star-46f3`, Team domain `tight-star-46f3.cloudflareaccess.com` — 로그인 페이지가 뜨는 주소이자 구글 리디렉션 URI의 기반이다. **바꾸면 Google 클라이언트의 리디렉션 URI와 `server/lib/access.js`의 `TEAM_DOMAIN` 상수도 함께 바꿔야 한다.**

### 2-1. 애플리케이션 (무엇을 지킬 것인가)

위치 — **Access controls** → **Applications** → `finance` (Self-hosted 타입, 대상 호스트네임 fin.hansoljj.com).

"fin.hansoljj.com으로 오는 모든 요청은 경비실을 거쳐라"라는 선언이다. 앱마다 고유 식별자(**AUD 태그**)가 발급되는데, **앱을 지웠다 다시 만들면 AUD가 바뀌므로 `server/lib/access.js`의 `APP_AUD` 상수를 새 값으로 갱신해야 한다** (안 하면 저장/조회가 전부 401).

### 2-2. 정책 (누구를 들여보낼 것인가)

위치 — **Access controls** → **Policies** → `everyone`.

- **Action: Allow** + Include: **Everyone** — "아무나 들어올 수 있다, 단 **로그인은 반드시 해야 한다**"는 뜻이다. 단 **실제 문지기는 이 정책이 아니라 구글 OAuth 앱의 테스트 모드다**(3절) — Cloudflare 는 열어둬도, 테스트 사용자 목록에 없는 계정은 구글 로그인 단계에서 먼저 막힌다.
- **절대 Bypass로 바꾸지 말 것.** Bypass는 "로그인 자체 생략"이라 통행증이 안 붙고, 서버가 사용자를 식별 못 해 저장이 401로 죽는다.
- 특정인 차단 — 정책 **Configure** → **Exclude** 에 Emails로 해당 주소 추가.

### 2-3. 로그인 방법 (어떻게 신원을 확인할 것인가)

위치 — Applications → `finance` 편집 → 로그인 방법(Login methods) 섹션.

- **Accept all available identity providers** 체크 해제 → **Google만 선택**.
- **Instant Auth** 켜기 — 로그인 방법이 하나뿐일 때만 나타나는 옵션으로, "Cloudflare Access" 선택 화면을 건너뛰고 바로 구글 계정 선택으로 직행시킨다.
- 트레이드오프 — 이메일 코드(One-time PIN) 폴백이 사라지므로 구글 로그인 장애 시 아무도 못 들어온다. 그때는 이 화면에서 잠시 PIN을 다시 켜면 된다.

### 2-4. 자리(Seat) 관리

**개념.** 한 번이라도 로그인한 사용자는 요금제의 "자리" 하나를 차지한다. 현재 **Zero Trust Free 플랜, 50석** (Settings → Cloudflare One plan에서 확인). 구글 테스트 모드(3절)가 앞단을 막고 있어 실제로 자리를 먹을 수 있는 건 등록된 사용자뿐이지만, 미접속 자리 자동 회수는 켜뒀다.

- 자동 회수 — **Settings** → **Admin controls** → **Remove inactive users from seats** → Inactivity time **1 month**. 한 달간 로그인 없는 사용자를 자동으로 자리에서 내린다 (다시 로그인하면 다시 들어옴).
- 수동 회수 — **Team & Resources** → **Users** → 사용자 체크 → **Action** → **Remove users**.
- 로그인 기록 — **Insights & Logs** 에서 누가 언제 인증했는지 볼 수 있다.

## 3. Google 인증 플랫폼 — 구글 로그인 연동 (IdP)

**개념.** Access가 경비실이라면, 신원 확인은 구글에 외주를 준다. 이런 신원 확인 대행자를 **IdP**(Identity Provider)라 하고, 그 표준 절차가 **OAuth**다. 흐름은 "Cloudflare가 사용자를 구글로 보냄 → 사용자가 구글에 로그인 → 구글이 '이 사람은 누구다'라는 확인서를 Cloudflare에 돌려줌"이다. 구글 입장에서는 아무한테나 확인서를 써줄 수 없으니, **누가(Client) 어디로(리디렉션 URI) 확인을 요청하는지**를 미리 등록해야 한다 — 그래서 구글 콘솔 설정이 필요하다.

**우리 설정.** console.cloud.google.com → 프로젝트 `finance-login` → **Google 인증 플랫폼** 메뉴.

1. **브랜딩** — 구글 로그인 동의 화면에 표시될 앱 이름·지원 이메일. 꾸미기 용도라 아무 값이어도 동작에 영향 없다.
2. **대상** — 사용자 유형 **외부**(External). 내부는 Google Workspace 조직 전용이라 개인 지메일이 못 들어온다. **게시 상태는 "테스트 중"이고 그대로 둔다**(2026-09-02 확인·결정) — 테스트 모드에서 로그인되는 건 ① 테스트 사용자 목록의 계정 ② 구글 프로젝트 소유자·편집자뿐이고, 목록이 비어 있는 지금 운영자가 로그인되는 건 ②의 예외 덕분이다. **사용자를 늘리려면 이 화면의 "테스트 사용자 → Add users"에 상대 지메일을 추가**한다(한도 100명 — 지인용으로 충분). "프로덕션" 게시는 홈페이지·개인정보처리방침 등 공개 URL이 필수라 하지 않기로 했다(docs/TODO.md 참고). 구글 refresh token 의 테스트 모드 7일 만료는 무관 — Access 는 로그인 순간에만 구글을 쓰고 이후 30일은 자체 세션 쿠키로 유지한다.
3. **클라이언트** — OAuth 클라이언트. 반드시 **"웹 애플리케이션"** 유형이어야 한다 (데스크톱 유형에는 리디렉션 URI 입력란 자체가 없다).
   - **승인된 리디렉션 URI** — `https://tight-star-46f3.cloudflareaccess.com/cdn-cgi/access/callback` 한 줄. 구글이 확인서를 **이 주소로만** 돌려주겠다는 화이트리스트다. 다른 주소로는 절대 안 보내므로 확인서 탈취가 차단된다.
   - **승인된 JavaScript 원본** — 비워둠. 웹페이지 안에서 자바스크립트로 직접 구글 팝업을 띄우는 방식일 때만 쓰는 칸인데, 우리는 Cloudflare 서버가 뒤에서 통신하므로 해당 없다.
4. **Client ID / Client Secret** — 이 클라이언트의 아이디와 비밀번호 같은 쌍이다. ID 는 클라이언트 상세 화면에서 언제든 재확인되지만 **Secret 은 생성 직후에만 표시**될 수 있다(2025년부터 구글이 마스킹) — 값을 모르면 재발급하고, Cloudflare 쪽 IdP 등록(아래)도 같이 갱신한다. **Secret은 절대 repo에 커밋 금지** (.gitignore의 `*.json` 규칙이 다운로드 JSON을 막아준다).

**Cloudflare 쪽 등록 위치** — Cloudflare One → **Integrations** → **Identity providers** → **Add new identity provider** → **Google** → **App ID** 칸에 Client ID, **Client Secret** 칸에 Secret → Save. Secret을 구글에서 재발급하면 여기도 같이 갱신해야 한다.

## 4. 서버가 사용자를 알아보는 방법 — JWT 검증

**개념.** Access를 통과한 요청에는 `Cf-Access-Jwt-Assertion` 헤더로 **JWT**(서명된 통행증)가 붙는다. 안에 "이 요청의 주인은 누구" 같은 내용이 적혀 있고, Cloudflare의 비밀키로 **서명**되어 있어 내용을 위조하면 서명이 깨진다. 서버는 공개키로 서명을 확인한 뒤에만 그 이메일을 믿는다. **이 헤더는 Tunnel을 지나 Mac mini까지 그대로 전달되므로**, 서버를 옮겨도 검증 코드는 무수정이었다.

**왜 이 방식인가.** 원래는 Access가 붙여주는 이메일 평문 헤더(`Cf-Access-Authenticated-User-Email`)를 쓸 계획이었지만, **새 Cloudflare One UI로 만든 앱은 이 헤더를 붙여주지 않는 것**을 확인했다(2026-08-26, 로그인 후에도 저장이 401로 실패하던 원인). 그래서 JWT를 직접 검증하는 방식으로 교체했고, 결과적으로 보안도 더 강해졌다 (서명 검증이라 어떤 경로로 와도 사칭 불가).

**코드와 설정의 연결 고리** — [server/lib/access.js](../server/lib/access.js) 상단 상수 두 개.

| 상수 | 현재 값 | 언제 바꾸나 |
|---|---|---|
| `TEAM_DOMAIN` | https://tight-star-46f3.cloudflareaccess.com | 팀 이름을 바꿨을 때 |
| `APP_AUD` | 9c1dd224…08bfd | Access 앱을 지웠다 다시 만들었을 때 |

**진단 도구** — 로그인된 브라우저에서 `fin.hansoljj.com/api/whoami` 를 열면 서버가 이 요청을 누구로 인식하는지 보여준다. `verifiedEmail`에 이메일이 나오면 인증 체인(로그인 → JWT → Tunnel → 서버 검증) 전체가 정상이다. 로컬 개발은 `.env`의 `DEV_EMAIL`로 우회한다 — **운영 env에는 절대 넣지 않는다.**

## 5. 증권사 잔고 자동 동기화 — 연결 등록

**개념.** 자산 입력 탭의 🏦 동기화는 등록된 증권사에서 수량·평단·예수금을 읽어와 앱과 맞춘다. 등록 단위는 **연결(connection)** 하나 — `증권사 + 자격증명 + 조회할 계좌 목록`이다. 연결은 대시보드가 아니라 **앱의 설정 탭에서** 만들고, 로그인 이메일 귀속으로 서버 DB(`broker_connection` 테이블)에 저장된다 — 자격증명은 `~/.finance/secret.key`로 **AES-256-GCM 암호화**되어 들어간다. 사용자마다 자기 연결만 쓰고 서로 완전히 격리되며, 등록된 자격증명은 어떤 API로도 원본을 다시 내보내지 않는다(설정 화면엔 앞 4자 마스킹만).

**키 발급처** (각 사이트에서 본인이 직접 발급, 조회 권한만 있으면 된다).

| 증권사 | 발급처 | 입력할 값 |
|---|---|---|
| 한국투자증권 | KIS Developers (apiportal.koreainvestment.com) — 홈페이지 로그인 후 Open API 신청 | 앱키 · 앱시크릿 · 계좌번호 앞 8자리 |
| 키움증권 | 키움 REST API (openapi.kiwoom.com) | 앱키 · 시크릿키 |
| 빗썸 | 마이페이지 → API 관리 (API 2.0, 자산조회 권한) | 액세스 키 · 시크릿 키 |

> **호출 IP 등록** — 키움·빗썸은 API를 호출하는 서버의 공인 IP를 포털에 미리 등록해야 응답을 준다. 서버가 Mac mini(집 고정 공인 IP)라 **집 IP 하나만 등록하면 끝**이고, 이미 등록돼 실동작 확인까지 끝났다. 한국투자증권은 IP 등록을 요구하지 않는다. (Cloudflare Workers 시절에는 출발 IP가 고정되지 않아 이 둘이 구조적으로 막혀 있었다 — Mac mini 이전의 직접적 동기. 6절.)

**등록 방법.** 설정 탭 → "🔗 증권사 연결" → **[+ 증권사 연결 추가]** → 증권사를 고르면 그 증권사에 필요한 입력칸만 나타난다 → 값 입력 → 저장.

- **키움·빗썸**은 조회 대상이 고정(국내주식·해외주식 / 암호화폐)이라 키만 넣으면 끝난다.
- **한국투자증권**은 계좌번호 하나 밑에 상품(연금저축·ISA 등)이 여러 개라 조회할 계좌를 지정해야 한다. **[🔍 계좌 찾기]** 를 누르면 서버가 후보를 훑어 실제 조회되는 계좌를 보유 종목과 함께 보여주므로, 상품코드를 몰라도 각 계좌의 **카테고리만 고르면** 된다 (직접 넣을 경우 상품코드 = 계좌번호 뒤 2자리, 22=연금저축 · 01=ISA · 29=IRP).
- 같은 증권사라도 **계좌마다 앱키가 다르면 연결을 따로 추가**한다 (한투는 계좌 단위로 앱키가 발급된다).
- 수정 화면에서 자격증명 칸을 비워두면 기존 값이 유지된다. 값을 바꾸거나 연결을 지우면 저장된 접근 토큰 캐시도 함께 정리된다.

**한투 토큰 발급 제한.** 접근토큰 발급은 앱키당 **1분에 1회**. 서버가 23시간 캐시하므로 평소엔 문제없지만, 자격증명을 바꾼 직후나 동기화 직후에 [🔍 계좌 찾기]를 누르면 "접근토큰 발급 잠시 후 다시 시도하세요(1분당 1회)"가 그대로 보인다 — 1분 뒤 다시 누르면 된다.

**동작 범위.** 조회 전용 API만 호출한다(주문 불가). 퇴직연금(DC)·한투 금현물은 증권사 API가 공식적으로 지원하지 않아 수동 입력을 유지한다. 새 증권사 지원은 `server/lib/providers.js`에 어댑터를 추가하면 되고, 설정 화면은 그 선언을 읽어 자동으로 폼을 그린다.

## 6. Mac mini 자립 서버 — 이전 절차 (2026-08-31 완료)

**왜.** 키움·빗썸이 호출 IP 등록을 요구하고(5절), 트레이딩 봇은 24/7 상주·WebSocket·고정 IP가 필요한데 Workers 는 셋 다 불가. 그래서 앱 서버를 집 Mac mini(고정 공인 IP)로 옮기고 Cloudflare 는 DNS·Access 로그인·Tunnel 만 맡긴다. Access 는 오리진이 어디든 `Cf-Access-Jwt-Assertion` 헤더를 붙여주므로 로그인 코드는 그대로다. 서버 코드는 `server/`(Express + SQLite). 상세·진행 기록은 [handover.md](handover.md).

**Mac mini 쪽 (Node 22.5+, pm2, cloudflared 설치됨)**

1. `git pull` → `npm ci` (lock 파일 기준 설치)
2. `~/.finance/env` 생성(권한 600) — 내용은 `FRED_API_KEY=…` 한 줄. **`DEV_EMAIL`은 절대 넣지 않는다**(로그인 우회).
3. `pm2 start ecosystem.config.cjs` → `pm2 save` → `pm2 startup`(출력되는 sudo 명령을 실행해 launchd 등록. `~/Library/LaunchAgents` 폴더가 없으면 ENOENT 로 실패하니 `mkdir -p` 먼저). 첫 기동 로그에 "새 암호화 키 생성됨: ~/.finance/secret.key" 가 찍힌다 — **이 파일을 비밀번호 관리자에 백업**(DB 백업과 다른 곳에). 분실하면 증권사 연결만 재등록하면 되고 포트폴리오는 무관.
4. 로컬 확인 — `curl -i http://127.0.0.1:8787/api/whoami`(200 + `verifiedEmail: null` 이면 정상. JWT 는 Tunnel 을 거쳐야 온다).
5. `cloudflared tunnel login`(출력되는 URL을 아무 기기 브라우저에서 열어 승인) → `cloudflared tunnel create finance` → `~/.cloudflared/config.yml`에 `tunnel:`·`credentials-file:`·ingress(`fin.hansoljj.com → http://127.0.0.1:8787`, 마지막 `http_status:404`) → `cloudflared tunnel ingress validate` → 상시 실행은 **`cloudflared service install` 후 plist 수정이 필요하다**: brew 서비스와 기본 plist 모두 인자 없이 `cloudflared`만 실행해 "use `cloudflared tunnel run`"으로 거부되므로, `plutil -replace ProgramArguments -json '["/opt/homebrew/bin/cloudflared","tunnel","--config","/Users/hansol/.cloudflared/config.yml","run"]' ~/Library/LaunchAgents/com.cloudflare.cloudflared.plist` 후 `launchctl unload`/`load`. 연결 확인 `cloudflared tunnel info finance`. 여기까지는 운영에 영향이 없다.
6. **전환** — Pages 프로젝트 Custom domains 에서 `fin.hansoljj.com` 제거 → `cloudflared tunnel route dns finance fin.hansoljj.com`.
7. 브라우저에서 fin.hansoljj.com → 구글 로그인 → `/api/whoami`의 `verifiedEmail`에 이메일이 나오면 JWT 가 오리진까지 온 것.
8. **데이터 이전** — 전환 전에 구 사이트에서 `/api/portfolio?download=1`로 받아둔 JSON 을, 로그인 상태에서 설정 탭 "📂 JSON에서 복원"으로 넣는다(형식 동일). 증권사 연결은 자격증명이라 옮기지 않고 **재등록**.
9. 재부팅 후 pm2·cloudflared 자동 기동 확인. `data/`를 백업 대상에 포함하되 WAL 이라 실행 중 `.db`만 복사하면 깨진다 — 7절의 `.backup` 사용.

pm2·cloudflared 모두 **사용자 LaunchAgent** 라 **자동 로그인이 켜져 있어야 재부팅 후 올라온다**(`defaults read /Library/Preferences/com.apple.loginwindow autoLoginUser` 로 확인. FileVault 와는 양립 불가 — 집 서버 용도라 자동 로그인 쪽을 택했다).

**Windows 개발 PC.** `.env`에 `DEV_EMAIL=test@x.com`을 두고 `npm run dev`(또는 `.claude/launch.json`의 `finance-server`). 데이터는 로컬 `data/finance.db`, 암호화 키는 `%USERPROFILE%\.finance\secret.key`. 한투는 IP 제한이 없어 실키로 로컬 검증이 가능하고, 개발 PC가 Mac mini 와 같은 공유기(같은 공인 IP)면 키움·빗썸도 로컬에서 실검증된다.

## 7. 운영 치트시트 (Mac mini)

전부 Mac mini 터미널(또는 SSH) 기준. brew 경로가 PATH에 없으면 앞에 `export PATH=/opt/homebrew/bin:$PATH`.

| 하고 싶은 것 | 명령 |
|---|---|
| 서버 상태 | `pm2 status` (online / restarts 횟수) |
| 서버 **재시작** | `pm2 restart finance` — `~/.finance/env`를 고쳤을 때 반드시 (env 는 기동 시 한 번만 읽는다) |
| 서버 로그 | `pm2 logs finance --lines 50` (실시간은 `pm2 logs finance`, Ctrl+C 로 나감). 파일은 `~/.pm2/logs/finance-out.log`·`finance-error.log` |
| **코드 배포** (main 에 push 한 뒤) | `cd ~/projects/finance && git pull && npm ci && pm2 restart finance` — js/css/html 만 바뀌었으면 `git pull` 만으로 반영되지만(디스크에서 그대로 서빙) 재시작해도 손해 없다 |
| 환경변수 편집 | `nano ~/.finance/env` → 저장 → `pm2 restart finance`. `DEV_EMAIL` 은 절대 넣지 않는다 |
| 터널 상태 | `cloudflared tunnel info finance` (CONNECTOR 행이 있으면 연결됨) · `launchctl list \| grep cloudflare` (PID 와 종료코드 0) |
| 터널 로그 | `tail -50 ~/Library/Logs/com.cloudflare.cloudflared.err.log` |
| 터널 재시작 | `launchctl unload ~/Library/LaunchAgents/com.cloudflare.cloudflared.plist && launchctl load ~/Library/LaunchAgents/com.cloudflare.cloudflared.plist` |
| 재부팅 후 점검 | `pm2 status` 에 finance online · `cloudflared tunnel info finance` 에 커넥터 · 브라우저에서 fin.hansoljj.com. 둘 다 사용자 LaunchAgent 라 자동 로그인이 꺼져 있으면 안 올라온다 |
| 인증 진단 | 로그인된 브라우저에서 `fin.hansoljj.com/api/whoami` → `verifiedEmail` 에 이메일이 나와야 정상 |

**DB 보기** — `sqlite3 ~/projects/finance/data/finance.db` 로 들어가면 프롬프트가 뜬다(`.quit` 로 나감). 자주 쓰는 질의는 아래. 실행 중인 서버와 동시에 읽어도 안전하다(WAL).

```sql
.tables                                           -- portfolio / broker_connection / broker_token
select email, version, length(json), datetime(updated_at/1000,'unixepoch','localtime') from portfolio;  -- 누구의 어떤 버전이 언제
select email, id, provider, label, accounts from broker_connection;   -- 증권사 연결 (creds 는 enc:v1: 암호문)
select conn_id, datetime(expires_at/1000,'unixepoch','localtime') from broker_token;  -- 토큰 캐시 만료시각
select json from portfolio where version='latest' and email='<이메일>';  -- state 원문 (JSON 한 덩어리)
```

- 특정 날짜로 롤백하고 싶으면 앱에서 `fin.hansoljj.com/api/portfolio?version=YYYY-MM-DD` 를 열어 받은 JSON 을 설정 탭 "JSON에서 복원"으로 넣는 게 안전하다(DB 를 직접 UPDATE 하지 않는다).
- **백업** — 실행 중엔 `.db` 파일만 복사하면 WAL 내용이 빠진다. `sqlite3 ~/projects/finance/data/finance.db ".backup ~/finance-backup-$(date +%F).db"` 로 뜬다. 암호화 키 `~/.finance/secret.key` 는 별도 보관(둘이 같이 새면 복호화된다).
- 한 줄 실행은 `sqlite3 ~/projects/finance/data/finance.db "select count(*) from portfolio"` 처럼 따옴표로 감싼다.

- 테이블 구조·열 의미·쓰기 규칙·암호화 형식은 **[DB.md](DB.md)** 참고.

## 8. 자주 하는 작업 모음

| 하고 싶은 것 | 방법 |
|---|---|
| 사용자 추가 | ① 구글 콘솔 → Google 인증 플랫폼 → 대상 → 테스트 사용자 **Add users** 에 상대 지메일 추가(3절) ② 주소 공유 (fin.hansoljj.com). 계정별 데이터 분리라 서로 안 보임. "운영자는 열람 가능" 고지 권장 |
| 특정인 차단 | Access controls → Policies → everyone → Configure → Exclude에 Emails 추가 |
| 자리 수동 회수 | Team & Resources → Users → 체크 → Action → Remove users |
| 데이터 롤백 | `/api/portfolio?version=YYYY-MM-DD` 로 과거 버전 확인 → 설정 탭 "JSON에서 복원". DB 직접 조회는 7절 |
| 저장이 401일 때 | ① `/api/whoami`의 verifiedEmail 확인 → null이면 ② 정책이 Allow인지(Bypass 아님), ③ 앱 AUD와 코드 `APP_AUD` 일치 여부, ④ 터널·서버 상태(7절) 순서로 점검 |
| 구글 로그인 장애 시 | Applications → finance → Login methods에서 One-time PIN 임시로 다시 켜기 |
| 서버 재시작·로그·배포·DB | 7절 운영 치트시트 |
