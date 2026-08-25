# 자산 포트폴리오 — fin.hansoljj.com

개인 자산 포트폴리오 추적 앱. Cloudflare 올인원 체제(Pages + Access + KV)로 운영한다.

- **접속**: <https://fin.hansoljj.com> — **Cloudflare Access(이메일 인증)** 관문을 통과해야 앱 자체가 보인다.
- **데이터**: 브라우저에서 `AES-256-GCM`(PBKDF2-SHA256, 25만 회)으로 암호화한 뒤 **Cloudflare KV**에 저장. 서버는 평생 암호문만 만진다. 비밀번호는 어디에도 저장되지 않는다(기기별 "기억" 선택 시 그 브라우저 localStorage에만).
- **배포**: 이 repo에 push하면 Cloudflare Pages가 수십 초 안에 자동 배포한다.

## 아키텍처

```
[GitHub repo]  index.html + functions/api/  ← 코드만. 데이터 없음
      │ push = 자동 배포
      ▼
[Cloudflare]  fin.hansoljj.com
   ├─ Access: 이메일 인증 관문 (미인증 = 앱 접근 불가, 세션 30일)
   ├─ Pages: index.html 정적 서빙
   ├─ Functions (/api/*):
   │    ├─ GET/PUT /api/portfolio → KV (암호문 + 날짜별 버전 90일 보관)
   │    └─ GET /api/proxy?url=    → 시세 프록시 (화이트리스트 도메인만)
   └─ KV(finance-data): portfolio:latest / portfolio:v:YYYY-MM-DD
[브라우저]  암복호화는 여기서만. 새 기기 최초 1회 비번 입력("이 기기에서 기억" 시 이후 무프롬프트)
```

## repo 구성

| 경로 | 설명 |
|---|---|
| `index.html` | 앱 본체 (UI + 로직 + 스타일 단일 파일). 개인정보 없음 |
| `functions/api/portfolio.js` | KV 암호문 저장/조회 API (인증은 Access가 엣지에서 전담 — 코드에 인증 없음) |
| `functions/api/proxy.js` | 시세 CORS 프록시 (야후·네이버·FRED·BLS·빗썸·업비트·KRX 화이트리스트). FRED 요청엔 서버 보관 키(`FRED_API_KEY`) 자동 주입 |
| `backups/` | 평문 JSON 백업 (**git 제외** — 비번 분실 시 유일한 복구 수단, 삭제 금지) |
| `checklist.md` / `context-notes.md` | 로컬 작업 노트 (git 제외) |

## 일상 사용

- **보기**: 아무 기기에서 fin.hansoljj.com → Access 인증 → (최초 1회) 비번 → 데이터 표시
- **수정·저장**: 데이터 수정 후 설정 탭 → **☁️ 서버에 저장** → 즉시 반영. 다른 기기에선 새로고침만 하면 최신
- **시세 갱신**: 🔄 버튼 (같은 도메인 `/api/proxy` 경유라 별도 설정 불필요)
- **백업**: 설정 탭 → 💾 JSON 백업 다운로드를 주기적으로 (`backups/`에 보관 권장). 🔐 암호화 스냅샷은 비상용

## Cloudflare 설정 (대시보드에서 관리)

- **Pages 프로젝트** `finance` — repo 연결, 빌드 없음, 커스텀 도메인 fin.hansoljj.com
- **Bindings**: KV namespace `finance-data` → 변수명 `KV` (**Production 환경만** — 프리뷰 배포는 데이터 접근 불가)
- **Secrets**: `FRED_API_KEY` (M2 지표용)
- **Zero Trust → Access**: 앱 `finance`, 정책 = 소유자 이메일만 Allow, 세션 30일
- 바인딩/시크릿 변경 시 **Retry deployment** 필요 (새 배포부터 적용)

## 복구 시나리오

- **비밀번호 분실**: 복구 불가(암호화의 본질). `backups/`의 최신 평문 JSON을 "📂 JSON에서 복원"으로 불러와 새 비번으로 다시 저장
- **잘못 저장/데이터 사고**: KV에 날짜별 버전이 90일 보관됨 — `GET /api/portfolio?version=YYYY-MM-DD`로 조회하거나 대시보드 KV 브라우저에서 `portfolio:v:날짜` 값을 확인해 복원
- **기기 분실/공용 PC 사용 후**: 설정 탭 → "🔒 이 기기에서 비번 잊기" (Access 세션은 Zero Trust 대시보드에서 revoke 가능)

## 히스토리

- ~2026-08: GitHub Pages(my.dcom.co.kr) + repo 내 암호문(portfolio.enc) 커밋 방식. 상세는 git 히스토리 참고
- 2026-08-25: Cloudflare 체제로 이전 — 진짜 인증(Access) 도입, 데이터를 git에서 KV로 분리, 저장 즉시 반영화. 구 히스토리에 남아있는 portfolio.enc 커밋들은 암호문이므로 공개돼도 비번 없이는 무용
