// ============================================================================
// 증권사 연결(connection) 관리 — /api/broker-connections (functions/api/broker-connections.js 이식판)
// 연결 하나 = { id, provider, label, creds, accounts[] } 이며 broker_connection 테이블에 사용자별로 저장된다
// (portfolio 와 동일한 per-user 규약). 같은 증권사의 연결을 여러 개 등록할 수 있다 — 한투처럼 계좌마다 앱키가 다른 경우.
// 클라이언트 상대는 설정 탭의 "증권사 연결" 카드(js/broker.js).
// [보안]
//  - GET 은 자격증명 원본을 절대 반환하지 않는다 (필드별 등록 여부 + 앞 4자 마스킹만).
//  - PUT 은 전체 배열을 받되, creds 값이 빈 문자열이면 기존 저장값을 유지한다
//    (수정 화면에서 안 건드린 칸을 비워 두면 그대로 남게 하기 위함).
//  - 연결을 지우거나 자격증명을 바꾸면 그 연결의 토큰 캐시를 함께 삭제한다.
//  - creds 는 lib/secret.js 로 암호화 저장(db.putConnections). 복호 실패 행은 credsError 로 표시되고
//    재입력 없이는 저장이 거부된다(필수 필드 검사) — 사용자가 다시 넣거나 삭제하면 된다.
// [응답에 providers 메타 동봉] 설정 화면이 provider 별 입력칸·계좌 모드를 이 메타로
//  그리므로, 새 증권사를 추가해도 프론트 코드는 수정할 필요가 없다.
// ============================================================================
import { Router } from 'express';
import { requireAuth } from '../lib/access.js';
import { PROVIDERS, providerMeta } from '../lib/providers.js';

// 자격증명 마스킹 — 값 자체는 내보내지 않고 "등록됨 + 앞 4자"만 알려준다.
const mask = (v) => {
  const s = String(v || '');
  return s ? `${s.slice(0, 4)}… (${s.length}자)` : '';
};

// 원본 request.json() 과 같은 모양 — 파싱 실패는 null.
function parseBody(req) {
  try { return JSON.parse(typeof req.body === 'string' ? req.body : ''); } catch { return null; }
}

export default function brokerConnectionsRoutes(db) {
  const r = Router();
  r.use(requireAuth);

  // GET — 연결 목록(마스킹) + provider 메타. 설정 화면이 이 응답 하나로 렌더된다.
  r.get('/', (req, res) => {
    const list = db.getConnections(req.email);
    const connections = list.map(c => ({
      id: c.id, provider: c.provider, label: c.label || '',
      accounts: Array.isArray(c.accounts) ? c.accounts : [],
      credsMasked: Object.fromEntries(Object.entries(c.creds || {}).map(([k, v]) => [k, mask(v)])),
      ...(c.credsError ? { credsError: c.credsError } : {}),
    }));
    res.json({ ok: true, connections, providers: providerMeta() });
  });

  // PUT — 연결 배열 전체 저장. 빈 자격증명 값은 기존 저장값으로 채운다.
  // 검증은 최소한만(알 수 없는 provider 거부, 필수 필드 존재) — 본인 데이터만 만지므로.
  r.put('/', (req, res) => {
    const body = parseBody(req);
    if (!body || !Array.isArray(body.connections)) {
      return res.status(400).type('text/plain').send('invalid body: expected { connections: [] }');
    }

    const prev = db.getConnections(req.email);
    const prevById = Object.fromEntries(prev.map(c => [c.id, c]));
    const invalidated = [];
    const next = [];

    for (const c of body.connections) {
      const provider = PROVIDERS[c.provider];
      if (!provider) return res.status(400).json({ ok: false, error: `알 수 없는 증권사: ${c.provider}` });
      const id = String(c.id || '').trim() || `c${Date.now().toString(36)}${next.length}`;
      const old = prevById[id];
      // 자격증명 병합 — 빈 값은 기존 유지. 값이 바뀌면 토큰 캐시를 버려야 한다.
      const creds = {};
      let credsChanged = false;
      for (const f of provider.credFields) {
        const incoming = String((c.creds || {})[f.key] || '').trim();
        const kept = String((old && old.creds && old.creds[f.key]) || '');
        creds[f.key] = incoming || kept;
        if (incoming && incoming !== kept) credsChanged = true;
      }
      const missing = provider.credFields.filter(f => !creds[f.key]).map(f => f.label);
      if (missing.length) return res.status(400).json({ ok: false, error: `${provider.label}: ${missing.join(', ')} 입력 필요` });

      // 계좌 목록 — fixed 모드는 provider 정의를 쓰므로 저장하지 않는다.
      const accounts = provider.accountMode === 'user'
        ? (Array.isArray(c.accounts) ? c.accounts : [])
            .map(a => ({ code: String(a.code || '').trim(), category: String(a.category || '').trim() }))
            .filter(a => a.code)
        : [];
      if (provider.accountMode === 'user' && !accounts.length) {
        return res.status(400).json({ ok: false, error: `${provider.label}: 조회할 계좌를 1개 이상 추가하세요` });
      }

      if (credsChanged) invalidated.push(id);
      next.push({ id, provider: c.provider, label: String(c.label || provider.label).trim(), creds, accounts });
    }

    // 삭제된 연결의 토큰 캐시도 정리
    for (const old of prev) if (!next.some(n => n.id === old.id)) invalidated.push(old.id);

    db.putConnections(req.email, next, invalidated);
    res.json({ ok: true, count: next.length });
  });

  // DELETE ?id=<connId> — 연결 1개 삭제 (id 없으면 전체 삭제).
  r.delete('/', (req, res) => {
    const id = typeof req.query.id === 'string' ? req.query.id : '';
    const count = db.deleteConnections(req.email, id || null);
    res.json({ ok: true, count });
  });

  return r;
}
