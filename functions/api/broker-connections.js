// ============================================================================
// 증권사 연결(connection) 관리 — /api/broker-connections
// 연결 하나 = { id, provider, label, creds, accounts[] } 이며 KV
// `user:<이메일>:broker:connections` 에 배열로 저장된다 (portfolio 와 동일한 per-user 규약).
// 같은 증권사의 연결을 여러 개 등록할 수 있다 — 한투처럼 계좌마다 앱키가 다른 경우.
// 클라이언트 상대는 설정 탭의 "증권사 연결" 카드(js/broker.js).
// [보안]
//  - GET 은 자격증명 원본을 절대 반환하지 않는다 (필드별 등록 여부 + 앞 4자 마스킹만).
//  - PUT 은 전체 배열을 받되, creds 값이 빈 문자열이면 기존 저장값을 유지한다
//    (수정 화면에서 안 건드린 칸을 비워 두면 그대로 남게 하기 위함).
//  - 연결을 지우거나 자격증명을 바꾸면 그 연결의 토큰 캐시를 함께 삭제한다.
//  - KV 평문 저장은 portfolio 와 동일한 신뢰 모델(README 고지: 계정 운영자는 열람 가능).
// [응답에 providers 메타 동봉] 설정 화면이 provider 별 입력칸·계좌 모드를 이 메타로
//  그리므로, 새 증권사를 추가해도 프론트 코드는 수정할 필요가 없다.
// ============================================================================
import { getVerifiedEmail } from '../_lib/access.js';
import { PROVIDERS, providerMeta } from '../_lib/providers.js';

const KEY = (email) => `user:${email}:broker:connections`;
const TOKEN_KEY = (email, connId) => `user:${email}:broker:token:${connId}`;

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

async function load(env, email) {
  const raw = await env.KV.get(KEY(email));
  try {
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}

// 자격증명 마스킹 — 값 자체는 내보내지 않고 "등록됨 + 앞 4자"만 알려준다.
const mask = (v) => {
  const s = String(v || '');
  return s ? `${s.slice(0, 4)}… (${s.length}자)` : '';
};

// GET — 연결 목록(마스킹) + provider 메타. 설정 화면이 이 응답 하나로 렌더된다.
export async function onRequestGet({ request, env }) {
  const email = await getVerifiedEmail(request);
  if (!email) return new Response('unauthenticated', { status: 401 });
  const list = await load(env, email);
  const connections = list.map(c => ({
    id: c.id, provider: c.provider, label: c.label || '',
    accounts: Array.isArray(c.accounts) ? c.accounts : [],
    credsMasked: Object.fromEntries(Object.entries(c.creds || {}).map(([k, v]) => [k, mask(v)])),
  }));
  return json({ ok: true, connections, providers: providerMeta() });
}

// PUT — 연결 배열 전체 저장. 빈 자격증명 값은 기존 저장값으로 채운다.
// 검증은 최소한만(알 수 없는 provider 거부, 필수 필드 존재) — 본인 데이터만 만지므로.
export async function onRequestPut({ request, env }) {
  const email = await getVerifiedEmail(request);
  if (!email) return new Response('unauthenticated', { status: 401 });
  let body;
  try { body = await request.json(); } catch { body = null; }
  if (!body || !Array.isArray(body.connections)) {
    return new Response('invalid body: expected { connections: [] }', { status: 400 });
  }

  const prev = await load(env, email);
  const prevById = Object.fromEntries(prev.map(c => [c.id, c]));
  const invalidated = [];
  const next = [];

  for (const c of body.connections) {
    const provider = PROVIDERS[c.provider];
    if (!provider) return json({ ok: false, error: `알 수 없는 증권사: ${c.provider}` }, 400);
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
    if (missing.length) return json({ ok: false, error: `${provider.label}: ${missing.join(', ')} 입력 필요` }, 400);

    // 계좌 목록 — fixed 모드는 provider 정의를 쓰므로 저장하지 않는다.
    const accounts = provider.accountMode === 'user'
      ? (Array.isArray(c.accounts) ? c.accounts : [])
          .map(a => ({ code: String(a.code || '').trim(), category: String(a.category || '').trim() }))
          .filter(a => a.code)
      : [];
    if (provider.accountMode === 'user' && !accounts.length) {
      return json({ ok: false, error: `${provider.label}: 조회할 계좌를 1개 이상 추가하세요` }, 400);
    }

    if (credsChanged) invalidated.push(id);
    next.push({ id, provider: c.provider, label: String(c.label || provider.label).trim(), creds, accounts });
  }

  // 삭제된 연결의 토큰 캐시도 정리
  for (const old of prev) if (!next.some(n => n.id === old.id)) invalidated.push(old.id);

  await env.KV.put(KEY(email), JSON.stringify(next));
  for (const id of invalidated) await env.KV.delete(TOKEN_KEY(email, id));
  return json({ ok: true, count: next.length });
}

// DELETE ?id=<connId> — 연결 1개 삭제 (id 없으면 전체 삭제).
export async function onRequestDelete({ request, env }) {
  const email = await getVerifiedEmail(request);
  if (!email) return new Response('unauthenticated', { status: 401 });
  const id = new URL(request.url).searchParams.get('id');
  const prev = await load(env, email);
  const next = id ? prev.filter(c => c.id !== id) : [];
  await env.KV.put(KEY(email), JSON.stringify(next));
  for (const c of prev) if (!next.some(n => n.id === c.id)) await env.KV.delete(TOKEN_KEY(email, c.id));
  return json({ ok: true, count: next.length });
}
