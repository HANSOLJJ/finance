# HANDOVER — Cloudflare에서 Mac mini 자립 서버로 이전

작성 2026-08-27. 다음 세션(사람/에이전트)이 이 문서만 읽고 이어받을 수 있게 쓴 인수인계다.
**공개 repo이므로 계좌번호·API 키·개인 IP는 이 문서에 적지 않는다** (실측 상세는 gitignore된 `config/API검증결과.md` 참조).

## 0. 왜 옮기나 — 목표가 바뀌었다

원래는 "자산 포트폴리오 조회 앱"이었고 Cloudflare(Pages·KV·Functions)로 충분했다. 그런데 최종 목표가 **트레이딩 봇**으로 확정되면서 Cloudflare로는 불가능한 요구가 생겼다.

| 봇이 요구하는 것 | Cloudflare Workers |
|---|---|
| 24/7 상시 실행 (조건 감시) | ❌ 요청이 올 때만 실행 |
| WebSocket 실시간 시세 유지 | ❌ 장시간 연결 유지 불가 |
| 고정 출발 IP | ❌ 엣지마다 다르고 IPv6 |

세 번째가 이미 실제 장애로 드러났다 — 증권사 API가 **호출 IP 사전 등록**을 요구하는데 Workers는 IP가 고정되지 않는다.

## 1. 현재 동작 상태 (2026-08-27 기준)

**되는 것**
- 앱 전체(대시보드·자산입력·분석·이력·설정), 모바일 대응 완료
- 서버 자동 저장(KV), Access 구글 로그인, 날짜별 버전 90일 보관
- **한국투자증권 잔고 동기화** — 연금저축·ISA 실동작 확인 완료

**막힌 것**
- **키움증권** — `8050 지정단말기 인증에 실패했습니다` (등록 IP 불일치)
- **빗썸** — `invalid ip format` (Cloudflare가 IPv6로 나가는데 allowlist는 IPv4만, 등록 슬롯 5개)

**검토했다가 기각한 우회책**
- 브라우저에서 증권사 직접 호출 — 실험상 CORS·IP 모두 통과했으나(키움 잔고조회까지 성공) **키움 앱키가 주문 권한을 포함**해 브라우저 노출 시 계좌 탈취 위험. 채택 불가.
- Cloudflare + VPS 중계 — 관리 지점이 둘로 늘어 얻는 것 대비 손해(사용자 판단).

## 2. 확정된 방향

**Mac mini(보유 중, 24/7 가동 가능, 집 공인 IP 고정)를 자립 서버로.** 외부 접속은 Cloudflare Tunnel.

```
[인터넷] → Cloudflare (DNS · Access 로그인 · Tunnel)
              ↓ 아웃바운드 터널 (공유기 포트 개방 불필요)
         [Mac mini] Node 서버
           ├─ 정적 서빙 (index.html·css·js — 무변경)
           ├─ /api/* → 기존 functions/api/* 그대로 호출
           ├─ data/ (portfolio·connections·날짜 버전)
           └─ (후속) 트레이딩 봇 상주 프로세스
              ↓ 아웃바운드 = 집 고정 공인 IP
         [한투 · 키움 · 빗썸]
```

**얻는 것** — ①증권사 3사 자동 동기화(IP 1개만 등록) ②API 키가 Mac mini 파일에만 존재 ③봇 상주 실행 기반 ④Cron 자동 스냅샷(기존 백로그 해소) ⑤비용 0.

**봇 범위(사용자 결정)** — 1단계는 조건 감시 + 알림, 검증 후 자동주문 전환. 알림 단계에서는 서버가 잠깐 죽어도 손실이 없으므로 집 서버로 충분하다.

## 3. 핵심 발견 — 서버 코드는 무수정 재사용

`functions/_lib/access.js`(crypto.subtle·fetch·atob)와 `functions/api/*.js`(Request/Response/URL/fetch)가 쓰는 API는 **전부 Node 18+ 전역**이다. 따라서 얇은 어댑터 2개만 만들면 기존 서버 파일 6개를 **그대로 import 해서 쓴다.**

**Access 로그인도 그대로 유지된다** — Tunnel을 지나도 `Cf-Access-Jwt-Assertion` 헤더가 오리진까지 전달되므로 `access.js`의 JWT 검증과 `APP_AUD` 상수가 수정 없이 동작한다. 로그인 코드를 새로 만들 필요가 없다는 뜻이다.

## 4. 신설할 것 (server/, 200줄 내외)

| 파일 | 역할 |
|---|---|
| `server/kv-file.js` | `env.KV` 인터페이스 셰임 `{get, put, delete}`. `data/kv/` 아래 파일 저장(키의 `:`는 `__`로 치환), TTL은 만료시각을 메타에 적고 읽을 때 검사 |
| `server/adapter.js` | Express req ↔ Web `Request`/`Response` 변환. `onRequestGet/Put/Post/Delete/onRequest` 시그니처를 그대로 호출 |
| `server/index.js` | Express 앱 — 정적 서빙 + `/api/*` 매핑 + `env = { KV, FRED_API_KEY }` 주입. 로컬 개발용 `DEV_EMAIL`(설정 시 Access 검증 우회, **운영에서는 절대 설정 금지**) |
| `ecosystem.config.cjs` | pm2 설정(자동 재시작·부팅 시 기동) |

`.gitignore`에 `data/` 추가 필수(실데이터·자격증명).

## 5. 사용자가 직접 해야 하는 일

1. Mac mini에 Node 20+, repo clone, `npm i express`, `npm i -g pm2`
2. `brew install cloudflared` → `cloudflared tunnel login` → 터널 생성 → `fin.hansoljj.com`을 터널로 라우팅
3. 증권사 포털에서 **집 공인 IP 등록** (키움·빗썸)
4. API 키를 Mac mini로 옮기고 앱 설정 탭에서 증권사 연결 재등록

## 6. 데이터 이전

브라우저에서 `/api/portfolio?download=1`로 받은 JSON을 `data/kv/user__<이메일>__portfolio__latest`로 배치하면 끝(형식 동일). 증권사 연결은 자격증명이 들어 있으니 **재등록**이 안전하다.

## 7. 검증 순서

1. **로컬**: `DEV_EMAIL=test@x.com node server/index.js` → 부트·저장·시세 프록시 확인, `data/kv/`에 파일 생성·재시작 후 유지 확인
2. **Mac mini**: 같은 방식 기동 → 집 IP로 나가므로 **키움·빗썸 연결 등록 후 🏦 동기화 3사 전부 성공**(이번 이전의 핵심 성공 기준)
3. **Tunnel**: 도메인 접속 → 구글 로그인 → `/api/whoami`의 verifiedEmail 확인(JWT가 오리진까지 오는지) → 저장·동기화 재확인
4. 재부팅 후 pm2 자동 기동 + cloudflared 자동 재연결
5. 모바일 375px 회귀

## 8. 리스크

- **Mac mini 다운/정전** — 알림 단계라 손실 없음. 자동주문 전환 전에 재검토
- **집 IP 변경** — 고정이지만 통신사 사정으로 바뀔 수 있음. 바뀌면 증권사 재등록 필요(감지 스크립트는 후속)
- **데이터 유실** — KV의 90일 자동 버전이 사라지므로 `data/` 날짜 버전 + 정기 백업으로 대체
- **롤백** — Cloudflare DNS를 Pages로 되돌리면 즉시 복구. **그래서 안정화 전까지 Pages·KV를 지우지 않는다**

## 9. 이 작업의 비목표 (후속 과제)

트레이딩 봇 본체 · Cron 자동 스냅샷 · IP 변경 감지 · 자동주문 전환 · 퇴직연금(DC)·금현물 수동 유지(증권사 API 미지원)

## 10. 참고 문서

- `CLAUDE.md` — 아키텍처 불변 조건(스크립트 로드 순서, 동기화 소유권 마커, 증권사 추가는 어댑터 1곳)
- `SETUP.md` — Cloudflare·Google 설정 전체, 6.5절이 증권사 연결 등록
- `README.md` — 파일별 역할
- `config/API검증결과.md` (gitignore) — 3사 실계좌 검증 결과·계좌 지도·TR 스펙
- `checklist.md`·`context-notes.md` (gitignore) — 진행 기록과 결정 이유
