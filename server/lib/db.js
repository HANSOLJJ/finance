// SQLite(node:sqlite) 연결·스키마·질의 함수 — Cloudflare KV 를 대체하는 유일한 저장소 계층.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { encrypt, decrypt } from './secret.js';

const CREDS_ERROR = '자격증명을 읽을 수 없습니다 — 재등록 필요';
const TOKEN_TTL_MS = 23 * 3600 * 1000; // 원본 KV expirationTtl 23h

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

// secretKey: broker_connection.creds 암·복호화용 32바이트 (lib/secret.js loadOrCreateKey).
export function openDb(dbPath, secretKey) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(SCHEMA);

  const stmt = {
    getPortfolio: db.prepare('SELECT json FROM portfolio WHERE email = ? AND version = ?'),
    putPortfolio: db.prepare(`
      INSERT INTO portfolio (email, version, json, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(email, version) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`),
    // ORDER BY rowid — 원본(KV 배열)의 저장 순서를 보존한다. putConnections 가 순서대로 INSERT 한다.
    listConn: db.prepare('SELECT id, provider, label, creds, accounts FROM broker_connection WHERE email = ? ORDER BY rowid'),
    delConnAll: db.prepare('DELETE FROM broker_connection WHERE email = ?'),
    delConnOne: db.prepare('DELETE FROM broker_connection WHERE email = ? AND id = ?'),
    insConn: db.prepare('INSERT INTO broker_connection (email, id, provider, label, creds, accounts) VALUES (?, ?, ?, ?, ?, ?)'),
    countConn: db.prepare('SELECT count(*) AS n FROM broker_connection WHERE email = ?'),
    getToken: db.prepare('SELECT token, expires_at FROM broker_token WHERE email = ? AND conn_id = ?'),
    putToken: db.prepare(`
      INSERT INTO broker_token (email, conn_id, token, expires_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(email, conn_id) DO UPDATE SET token = excluded.token, expires_at = excluded.expires_at`),
    delToken: db.prepare('DELETE FROM broker_token WHERE email = ? AND conn_id = ?'),
  };
  // AAD — 남의 행(다른 email·id)에 암호문을 옮겨 넣으면 복호화가 실패하게 묶는다.
  const aad = (email, id) => `${email}|${id}`;

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

    // 증권사 연결 목록. creds 는 복호화된 객체이며, 복호 실패 행(키 교체·파일 손상)은 creds:null + credsError 로
    // 돌려줘 라우트가 500 없이 "재등록 필요"로 처리한다 — 키가 바뀌어도 앱 전체가 안 뜨면 안 된다.
    getConnections(email) {
      return stmt.listConn.all(email).map(row => {
        let accounts;
        try { accounts = JSON.parse(row.accounts); } catch { accounts = []; }
        if (!Array.isArray(accounts)) accounts = [];
        let creds = null, credsError = null;
        try {
          const obj = JSON.parse(decrypt(secretKey, row.creds, aad(email, row.id)));
          creds = obj && typeof obj === 'object' ? obj : {};
        } catch { credsError = CREDS_ERROR; }
        return { id: row.id, provider: row.provider, label: row.label, accounts, creds, credsError };
      });
    },
    // 목록 통째 교체(원본 KV put 과 동일 의미) + 무효화할 토큰 삭제를 한 트랜잭션으로. creds 는 여기서 암호화.
    putConnections(email, list, invalidatedIds = []) {
      transaction(() => {
        stmt.delConnAll.run(email);
        for (const c of list) {
          stmt.insConn.run(email, c.id, c.provider, c.label || '',
            encrypt(secretKey, JSON.stringify(c.creds || {}), aad(email, c.id)), JSON.stringify(c.accounts || []));
        }
        for (const id of invalidatedIds) stmt.delToken.run(email, id);
      });
    },
    // 연결 삭제(id 가 null 이면 전체) + 그 토큰 삭제. 나머지 행은 건드리지 않는다(복호 실패 행의 암호문 보존). 남은 개수 반환.
    deleteConnections(email, id) {
      return transaction(() => {
        const ids = id ? [id] : stmt.listConn.all(email).map(r => r.id);
        for (const x of ids) { stmt.delConnOne.run(email, x); stmt.delToken.run(email, x); }
        return stmt.countConn.get(email).n;
      });
    },

    // 접근 토큰 캐시 — 만료는 읽을 때 검사(범용 TTL 계층 없음). 값은 평문 토큰 문자열.
    getToken(email, connId) {
      const row = stmt.getToken.get(email, connId);
      return row && row.expires_at > Date.now() ? row.token : null;
    },
    putToken(email, connId, token) {
      stmt.putToken.run(email, connId, token, Date.now() + TOKEN_TTL_MS);
    },
    deleteToken(email, connId) { stmt.delToken.run(email, connId); },

    close() { db.close(); },
  };
}
