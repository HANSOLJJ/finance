# 자산 포트폴리오 — GitHub Pages 배포

개인 자산 포트폴리오 추적 앱. GitHub 같은 **공개 저장소에 올려도 안전**하도록 데이터를 브라우저에서 암호화한다.

- 저장소에는 **암호문(`portfolio.enc`)만** 올라간다. 평문 자산 데이터는 절대 커밋되지 않는다.
- 복호화는 **네 브라우저 안에서만**, 비밀번호를 입력할 때만 일어난다. 비밀번호는 저장소에도 서버에도 남지 않는다.
- 암호화 방식: `AES-256-GCM`, 키는 `PBKDF2-SHA256`(25만 회 반복)로 비밀번호에서 유도.

배포 주소(예정): `https://hansoljj.github.io/finance/`

---

## 이 폴더에 들어가는 파일

| 파일 | 커밋? | 설명 |
|---|---|---|
| `index.html` | ✅ | 앱 본체. 개인정보 없음(코드만). |
| `portfolio.enc` | ✅ | **네가 직접 생성**하는 암호화된 데이터. |
| `README.md` / `.gitignore` | ✅ | 문서/커밋 제외 규칙. |
| `portfolio_*.json`, `*.backup` | ❌ | 평문 데이터. `.gitignore`가 자동 차단. |

---

## 최초 배포 (repo `HANSOLJJ/finance` 이미 있음)

### 1. 암호화 데이터 파일(`portfolio.enc`) 만들기
1. 이 폴더의 `index.html`을 브라우저로 그냥 연다 (더블클릭, `file://`).
2. **설정 탭 → `📂 JSON에서 복원`** 으로 최신 백업(`portfolio_2026-07-20.json` 등)을 불러온다.
3. **설정 탭 → `🔐 암호화 스냅샷 (GitHub 배포용)`** 클릭.
4. **긴 패스프레이즈(15자 이상)** 를 입력 → `portfolio.enc` 가 다운로드된다.
5. 그 파일을 이 폴더로 옮긴다.

### 2. repo에 올리기
로컬에 clone이 있다면 이 폴더의 `index.html`, `portfolio.enc`, `README.md`, `.gitignore` 를 repo 폴더에 복사한 뒤:
```bash
git add index.html portfolio.enc README.md .gitignore
git commit -m "portfolio: 암호화 배포"
git push
```
> 커밋 전 `git status` 로 **`.json` 파일이 목록에 없는지** 꼭 확인. `.gitignore`가 막아주지만 눈으로 재확인.

### 3. GitHub Pages 켜기
repo → **Settings → Pages → Build and deployment → Source: `Deploy from a branch` → Branch: `main` / `/ (root)`** → Save.
1~2분 뒤 `https://hansoljj.github.io/finance/` 접속 → 비밀번호 입력 → 데이터 표시.

---

## 데이터 갱신 (앞으로 매번)
1. 평소처럼 로컬 앱에서 데이터 수정 → `💾 JSON 백업 다운로드`.
2. 이 `index.html` 열고 → `📂 JSON에서 복원`(방금 받은 JSON) → `🔐 암호화 스냅샷` → 새 `portfolio.enc`.
3. `portfolio.enc` 교체 후 `git add portfolio.enc && git commit -m "update" && git push`.

---

## 보안 메모
- **비밀번호가 유일한 방어선.** 짧거나 흔한 비번은 공개 저장소에서 오프라인 크래킹 위험 → 반드시 긴 패스프레이즈.
- 배포 페이지에서 복호화한 데이터는 **메모리에만** 있고 그 기기에 저장되지 않는다. 새로고침하면 다시 비번을 묻는다(공용 PC 안전).
- 내 원래 PC(기존 `localStorage`에 데이터 있음)에서는 잠금 화면 없이 지금까지처럼 그대로 열린다.
- **FRED API 키**는 공개 노출 방지를 위해 하드코딩을 제거했다. 로컬에서 M2 지표를 쓰려면 브라우저 콘솔에서 한 번:
  ```js
  localStorage.setItem('FRED_API_KEY', '본인_FRED_키')
  ```
  (기존에 쓰던 키는 공개 이력에 남았을 수 있으니 [FRED 계정](https://fredaccount.stlouisfed.org/apikeys)에서 새로 발급받길 권장.)
- CPI/M2/금값 **실시간 fetch는 로컬 프록시**(`proxy_server.py`)가 있어야 동작 → 배포 페이지에서는 안 돌아간다. 배포판은 "이미 저장된 데이터 보기" 용도.

---

## 비밀번호를 잊으면?
복구 불가능하다(그게 암호화의 핵심). 원본 데이터는 로컬 `portfolio_*.json` 백업에 그대로 있으니, 새 비번으로 `portfolio.enc`를 다시 만들면 된다.
