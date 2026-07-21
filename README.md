# 자산 포트폴리오 — GitHub Pages 배포

개인 자산 포트폴리오 추적 앱. GitHub 같은 **공개 저장소에 올려도 안전**하도록 데이터를 브라우저에서 암호화하고, 어느 기기에서든 접속·수정·실시간 시세 갱신이 되도록 구성했다.

- 저장소에는 **암호문(`portfolio.enc`)만** 올라간다. 평문 자산 데이터는 절대 커밋되지 않는다.
- 복호화는 **브라우저 안에서만**, 비밀번호를 입력할 때만 일어난다. 비밀번호는 저장소에도 서버에도 남지 않는다.
- 암호화 방식: `AES-256-GCM`, 키는 `PBKDF2-SHA256`(25만 회 반복)로 비밀번호에서 유도.

**접속 주소**
- 커스텀 도메인: `https://finance.dcom.co.kr`
- 기본 주소: `https://hansoljj.github.io/finance/`

---

## 전체 구조 한눈에

```
[내 PC 로컬 index.html]  --수정--> ☁️ 업로드(GitHub API) --> [GitHub repo: portfolio.enc]
                                                                      |
                                                            GitHub Pages 배포
                                                                      v
[아무 기기 브라우저] --URL+비번--> 복호화(메모리) --> 화면 표시
                                          |
                              🔄 시세 갱신 --> [Cloudflare Worker 프록시] --> Yahoo 등
```

- **읽기(보기):** 어디서든 URL + 비번 → 복호화해서 봄 (데이터는 메모리에만, 새로고침하면 재입력)
- **쓰기(수정):** 설정 탭의 ☁️ 업로드 버튼으로 GitHub에 바로 반영
- **실시간 시세:** Cloudflare Worker 프록시가 CORS를 우회해 배포 사이트에서도 🔄 작동

---

## 이 폴더(=git repo)에 들어가는 파일

| 파일 | 커밋? | 설명 |
|---|---|---|
| `index.html` | ✅ | 앱 본체. 개인정보 없음(코드만). |
| `portfolio.enc` | ✅ | 암호화된 데이터. ☁️ 업로드 또는 🔐 스냅샷으로 생성. |
| `CNAME` | ✅ | 커스텀 도메인(`finance.dcom.co.kr`). GitHub이 자동 생성 — 지우지 말 것. |
| `README.md` / `.gitignore` | ✅ | 문서 / 커밋 제외 규칙. |
| `portfolio_*.json`, `*.backup` | ❌ | 평문 데이터. `.gitignore`가 자동 차단. |
| `포트폴리오_업데이트.bat` | ❌ | 로컬 전용 수동 업로드 스크립트(`*.bat` 무시됨). |

> ⚠️ push할 때 `CNAME` 파일이 사라지면 커스텀 도메인이 풀린다. 없어졌으면 `finance.dcom.co.kr` 한 줄로 다시 만들 것.

---

## 데이터 갱신 (앞으로 매번)

### 방법 1 — ☁️ 앱에서 바로 업로드 (권장)
GitHub 토큰을 **브라우저당 한 번** 등록해두면 버튼 하나로 끝난다. 서버 불필요.

**최초 1회 — 토큰 등록**
1. [Fine-grained 토큰 발급](https://github.com/settings/personal-access-tokens/new) → Repository access는 `finance`만, Permissions → **Contents: Read and write**, 만료일 설정.
2. 생성 직후 값(`github_pat_…`)을 **바로 복사** (한 번만 표시됨).
3. 설정 탭 → **🔑 토큰 설정** → 붙여넣기. (토큰은 그 브라우저 localStorage에만 저장, repo엔 안 올라감)

**매번**
1. 데이터 수정 (필요하면 🔄로 시세 갱신)
2. 설정 탭 → **☁️ GitHub에 업로드** → 비밀번호(사이트 접속 비번과 동일) 2회 입력
3. 1~2분 뒤 사이트에서 `Ctrl+Shift+R`

> ☁️ 업로드/토큰 UI는 어느 기기에서든 뜬다. **공용 PC라면 작업 후 반드시 [토큰 지우기]** 로 흔적을 지운다.

### 방법 2 — 수동 (토큰 없이)
1. 설정 탭 → `🔐 암호화 스냅샷` → 비번 → `portfolio.enc` 다운로드
2. `포트폴리오_업데이트.bat` 더블클릭 (Downloads의 최신 enc를 repo로 복사 후 자동 push)
   또는 직접: `git add portfolio.enc && git commit -m "update" && git push`
3. 1~2분 뒤 `Ctrl+Shift+R`

---

## Cloudflare Worker 시세 프록시

**왜 필요한가.** GitHub Pages는 정적 호스팅이라 브라우저가 Yahoo Finance 등에 직접 붙으면 CORS로 막힌다. 로컬에선 `proxy_server.py`가 우회해주지만 배포 사이트엔 그 서버가 없다. 그래서 배포판에서 🔄 시세 갱신이 안 됐다. (공개 CORS 프록시 corsproxy.io/allorigins 등은 자주 차단됨 — 403.)

**해결.** Cloudflare Worker(서버리스, 무료)로 **전용 CORS 프록시**를 두었다. 배포 사이트가 Worker에게 요청하면 Worker가 대신 Yahoo에서 받아 CORS 헤더를 붙여 돌려준다.

- **Worker 주소:** `https://broad-waterfall-7379.noblein12.workers.dev`
- **앱 연동:** `index.html`의 `CORS_PROXIES` 배열에 `cf-worker` 항목으로 등록. 순서는 `local`(로컬 전용, 배포 시 건너뜀) → **`cf-worker`** → 공개 프록시(폴백).
- **보안:** Worker 코드에 **허용 도메인 화이트리스트**를 둬서(야후·FRED·BLS·프랑크푸르터·코인게코·빗썸·업비트·KRX·네이버) 아무 URL로나 악용되는 걸 막는다.
- **무료 한도:** 하루 10만 요청. 실제 사용은 하루 수십 건 수준이라 여유가 크다.

**Worker 코드 (Cloudflare 대시보드 → 이 Worker → Edit code):**
```js
export default {
  async fetch(request) {
    const ALLOW = [
      'query1.finance.yahoo.com','query2.finance.yahoo.com','m.stock.naver.com',
      'api.stlouisfed.org','api.bls.gov','api.frankfurter.app',
      'api.coingecko.com','api.bithumb.com','api.upbit.com','data.krx.co.kr',
    ];
    const CORS = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': '*',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const target = new URL(request.url).searchParams.get('url');
    if (!target) return new Response('missing url', { status: 400, headers: CORS });
    let t; try { t = new URL(target); } catch { return new Response('bad url', { status: 400, headers: CORS }); }
    if (!ALLOW.includes(t.hostname)) return new Response('host not allowed', { status: 403, headers: CORS });
    const init = { method: request.method, headers: { 'User-Agent': 'Mozilla/5.0' } };
    if (request.method === 'POST') init.body = await request.text();
    const resp = await fetch(t.toString(), init);
    const headers = new Headers(CORS);
    headers.set('Content-Type', resp.headers.get('Content-Type') || 'application/json');
    return new Response(resp.body, { status: resp.status, headers });
  }
};
```

**Worker 주소가 바뀌면** `index.html`의 `cf-worker` 항목 `build` URL을 새 주소로 고친다.

**동작 모니터링 (Cloudflare 대시보드):**
- **Workers & Pages → 이 Worker → Metrics** : 시간대별 요청 수·에러율·subrequest 수. 무료 한도 대비 사용량 확인.
- **같은 Worker → Logs → Begin log stream** : 실시간 로그. 켜둔 채 사이트에서 🔄 누르면 요청이 실시간으로 뜬다.

---

## 최초 배포 절차 (참고)

1. **암호화 파일 만들기:** 로컬 `index.html` → `📂 JSON에서 복원`(최신 백업) → `🔐 암호화 스냅샷` → 긴 비번 → `portfolio.enc`.
2. **repo에 올리기:**
   ```bash
   git add index.html portfolio.enc README.md .gitignore
   git commit -m "deploy"
   git push
   ```
   (원격이 앞서 있으면 `git pull --no-rebase --no-edit origin main` 먼저.)
3. **Pages 켜기:** repo → Settings → Pages → Source `Deploy from a branch` → `main` / `/ (root)`.
4. **커스텀 도메인:** Settings → Pages → Custom domain에 `finance.dcom.co.kr`. DNS(도메인 관리)에 CNAME `finance` → `hansoljj.github.io`. 검사 통과 후 Enforce HTTPS.

---

## 보안 메모
- **비밀번호가 유일한 방어선.** 짧거나 흔한 비번은 공개 저장소에서 오프라인 크래킹 위험 → 반드시 긴 패스프레이즈(15자+).
- 복호화 데이터는 **메모리에만** 있고 기기에 저장되지 않는다. 새로고침하면 다시 비번을 묻는다(공용 PC 안전).
- **GitHub 토큰**은 코드/ repo에 절대 넣지 않는다. 오직 `🔑 토큰 설정`으로 브라우저 localStorage에만 저장. Fine-grained + `finance` 한정 + Contents 쓰기만 + 만료일로 위험 최소화. 값이 새면 [토큰 페이지](https://github.com/settings/personal-access-tokens)에서 Revoke/Regenerate.
- **FRED API 키**는 하드코딩을 제거했다. 로컬에서 M2 지표를 쓰려면 브라우저 콘솔에서 한 번:
  ```js
  localStorage.setItem('FRED_API_KEY', '본인_FRED_키')
  ```
- 원본 데이터의 **유일한 평문 백업은 로컬 `portfolio_*.json`**. 이 파일들은 지우지 말 것 — 비번을 잊으면 이게 유일한 복구 수단이다.

---

## 비밀번호를 잊으면?
복구 불가능하다(그게 암호화의 핵심). 대신 로컬 `portfolio_*.json` 백업으로 새 비번의 `portfolio.enc`를 다시 만들면 된다.
