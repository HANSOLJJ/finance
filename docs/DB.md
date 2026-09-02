# DB 스키마 — data/finance.db

서버의 유일한 저장소. 엔진은 `node:sqlite`(의존성 0), 파일 위치는 repo 기준 `data/finance.db`(gitignore). **정본은 [server/lib/db.js](../server/lib/db.js) 의 `SCHEMA` 상수** — 테이블을 바꾸면 이 문서도 같이 갱신할 것. 조회·백업 명령은 [SETUP.md 7절](SETUP.md) 운영 치트시트 참고.

## 설정

- **WAL 모드** — 실행 중인 서버와 동시에 읽어도 안전. 대신 실행 중 `.db` 파일만 복사하면 WAL 내용이 빠지므로 백업은 `sqlite3 … ".backup <경로>"`.
- `busy_timeout=5000` — 후속 봇 프로세스가 같은 DB를 쓸 때 잠금 대기.
- **FK 없음(의도)** — 계좌 찾기(discover)가 연결 등록 전에 임시 conn_id(`discover:<provider>`)로 토큰 행을 만들기 때문에 일부러 안 걸었다.

## 테이블 3개

```sql
CREATE TABLE portfolio (          -- 사용자별 앱 state 원문
  email      TEXT    NOT NULL,    -- 소유자 (Access JWT 검증으로 얻은 이메일)
  version    TEXT    NOT NULL,    -- 'latest' = 현재본 · 'YYYY-MM-DD'(KST) = 그날 마지막 저장 스냅샷(만료 없음)
  json       TEXT    NOT NULL,    -- state JSON 문자열 그대로 (서버는 파싱하지 않고 저장·반환)
  updated_at INTEGER NOT NULL,    -- epoch ms
  PRIMARY KEY (email, version)
);

CREATE TABLE broker_connection (  -- 증권사 연결 (설정 탭 🔗에서 등록)
  email    TEXT NOT NULL,
  id       TEXT NOT NULL,         -- 연결 id (kis·kiwoom·bithumb …) — holdings 의 h.source 와 연결됨
  provider TEXT NOT NULL,         -- server/lib/providers.js 의 어댑터 키
  label    TEXT NOT NULL DEFAULT '',
  creds    TEXT NOT NULL,         -- 자격증명 암호문 'enc:v1:…' (아래 암호화 절)
  accounts TEXT NOT NULL DEFAULT '[]',  -- 조회할 계좌 목록 (JSON 배열)
  PRIMARY KEY (email, id)
);

CREATE TABLE broker_token (       -- 증권사 접근 토큰 캐시
  email      TEXT    NOT NULL,
  conn_id    TEXT    NOT NULL,    -- 연결 id. 계좌 찾기는 임시 'discover:<provider>'
  token      TEXT    NOT NULL,
  expires_at INTEGER NOT NULL,    -- 발급 + 23시간 (epoch ms). 지난 행은 조회 시 무시
  PRIMARY KEY (email, conn_id)
);
```

## 쓰기 동작 (라우트가 지키는 규칙)

- **포트폴리오 PUT** — 트랜잭션(`BEGIN IMMEDIATE`)으로 `latest` 와 오늘(KST) 날짜 행 **두 개를 upsert**. 날짜 행이 자동 롤백 스냅샷이 된다 (`GET /api/portfolio?version=YYYY-MM-DD`).
- **연결 PUT** — 해당 email 의 행 **전체 교체**(삭제 후 순서대로 INSERT, `ORDER BY rowid` 가 등록 순서). creds 가 바뀐 연결은 토큰 행도 같이 지워 재발급을 강제한다.
- **연결 DELETE** — 남은 행을 재암호화하지 않는다 (복호 실패 행의 암호문 보존).
- 빗썸은 요청마다 JWT 를 새로 서명하는 방식이라 `broker_token` 행이 생기지 않는다.

## 암호화 (creds 열)

- 형식 `enc:v1:` + base64(iv 12B ‖ GCM 태그 16B ‖ 암호문). AES-256-GCM, AAD = `email|id` — 다른 행의 암호문을 복사해 넣으면 복호가 실패한다(바꿔치기 차단).
- 키는 `~/.finance/secret.key`(hex 64자 텍스트, `data/` 밖) — DB 파일·백업만 새는 경우엔 복호화 불가. 키를 분실하면 연결만 "재등록 필요"로 표시되고 포트폴리오는 무관.
- 복호 실패 행은 서버가 500 대신 `credsError` 로 돌려준다 — DB 를 직접 고치지 말고 앱 설정 탭에서 재등록.

## 주의

- **DB 를 직접 UPDATE 하지 않는다.** 데이터 수정은 항상 앱(자동 저장)이나 설정 탭 "JSON에서 복원" 경유 — 서버가 날짜 스냅샷·암호화를 함께 처리하기 때문.
- 날짜 버전 행은 만료 없이 쌓인다 (하루 1행 × ~100KB = 연 36MB 수준, 정리 불필요).
