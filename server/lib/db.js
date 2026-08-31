// SQLite(node:sqlite) 연결·스키마·질의 함수 — Cloudflare KV 를 대체하는 유일한 저장소 계층.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// KV 키 4종 → 테이블 3개. portfolio 의 json 은 앱 state 원문 문자열 그대로(파싱·재직렬화 금지).
// FK 는 두지 않는다 — broker-discover 가 저장 전 연결을 'discover:<provider>' 임시 id 로 토큰 캐시하므로
// 부모 행 없는 토큰이 정상적으로 존재한다.
const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS portfolio (
  email      TEXT    NOT NULL,
  version    TEXT    NOT NULL,
  json       TEXT    NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (email, version)
);

CREATE TABLE IF NOT EXISTS broker_connection (
  email    TEXT NOT NULL,
  id       TEXT NOT NULL,
  provider TEXT NOT NULL,
  label    TEXT NOT NULL DEFAULT '',
  creds    TEXT NOT NULL,
  accounts TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY (email, id)
);

CREATE TABLE IF NOT EXISTS broker_token (
  email      TEXT    NOT NULL,
  conn_id    TEXT    NOT NULL,
  token      TEXT    NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (email, conn_id)
);
`;

export function openDb(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(SCHEMA);

  const stmt = {
    getPortfolio: db.prepare('SELECT json FROM portfolio WHERE email = ? AND version = ?'),
    putPortfolio: db.prepare(`
      INSERT INTO portfolio (email, version, json, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(email, version) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`),
  };

  // node:sqlite 에는 transaction 헬퍼가 없어 BEGIN/COMMIT 을 직접 감싼다. IMMEDIATE = 쓰기 락을 먼저 잡는다
  // (후속 봇 프로세스가 같은 DB 를 쓸 때 busy_timeout 과 함께 SQLITE_BUSY 를 막는다).
  function transaction(fn) {
    db.exec('BEGIN IMMEDIATE');
    try { const out = fn(); db.exec('COMMIT'); return out; }
    catch (err) { db.exec('ROLLBACK'); throw err; }
  }

  return {
    // version='latest' 가 현재본, 'YYYY-MM-DD'(KST) 가 롤백 스냅샷. 없으면 null.
    getPortfolio(email, version = 'latest') {
      const row = stmt.getPortfolio.get(email, version);
      return row ? row.json : null;
    },
    // latest 와 오늘 날짜 행을 한 트랜잭션으로 덮어쓴다 (같은 날 여러 번 저장하면 마지막 것만 남음).
    putPortfolio(email, json, kstDate) {
      const now = Date.now();
      transaction(() => {
        stmt.putPortfolio.run(email, 'latest', json, now);
        stmt.putPortfolio.run(email, kstDate, json, now);
      });
    },
    close() { db.close(); },
  };
}
