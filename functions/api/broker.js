// ============================================================================
// 증권사 잔고 조회 — GET /api/broker
// 사용자가 등록한 연결(connections)을 순회하며 각 provider 어댑터로 잔고를 조회하고,
// 공통 형식으로 정규화해 돌려준다. 클라이언트 상대는 js/broker.js(🏦 동기화 모달).
// [보안 모델]
//  - Access JWT 검증(getVerifiedEmail)으로 로그인 이메일을 얻는다.
//  - 자격증명은 그 이메일 귀속 KV `user:<이메일>:broker:connections` 에서 로드
//    (등록은 /api/broker-connections — portfolio 와 동일한 per-user 저장 규약이라
//    사용자 간 구조적으로 격리되고, 친구도 자기 연결을 등록하면 자기 계좌만 본다).
//  - 접근 토큰은 연결 단위로 KV 에 23시간 캐시 (_lib/providers.js).
//  - 조회 TR만 호출한다.
// [응답] { ok, fetchedAt, sources: [{ id, label, category, cashCategory, ok, holdings, cash, error? }] }
//  - id = `<connId>:<accountCode>` (예 c1:22) — 프론트의 동기화 마커 값이 된다.
//  - category 는 js/constants.js CATEGORIES 의 key 와 일치해야 한다(사용자가 등록 시 선택).
//  - 에러 바디가 평문인 기존 관례와 달리 JSON({ok:false,error})을 쓴다 — 소스별
//    실패(rate limit/토큰/미등록)를 클라이언트가 구분 표시해야 하기 때문.
// ============================================================================
import { getVerifiedEmail } from '../_lib/access.js';
import { PROVIDERS, sleep } from '../_lib/providers.js';

export const CONNECTIONS_KEY = (email) => `user:${email}:broker:connections`;

// 저장된 연결 목록 로드 — 형식이 깨졌으면 빈 배열로 취급한다(조회가 죽지 않게).
export async function loadConnections(env, email) {
  const raw = await env.KV.get(CONNECTIONS_KEY(email));
  try {
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}

// 한 연결의 계좌들을 순차 조회 — 같은 연결 안에서는 provider 의 rateDelayMs 간격을 지킨다
// (KIS 는 실측상 250ms 간격에도 rate limit 에 걸린다). 계좌 하나가 실패하면 그 계좌만
// ok:false 로 남기고 나머지는 계속 조회한다 — 실패 소스는 프론트 diff 가 통째로 스킵하므로
// 실패를 빈 holdings 로 위장하지 말 것(삭제 오판 방지).
async function fetchConnection(env, email, conn) {
  const provider = PROVIDERS[conn.provider];
  const sources = [];
  if (!provider) {
    return [{
      id: `${conn.id}:?`, label: conn.label || conn.provider, category: '',
      ok: false, error: `알 수 없는 증권사(${conn.provider})`, holdings: [], cash: null,
    }];
  }
  const accounts = provider.accountMode === 'fixed'
    ? provider.accounts
    : (Array.isArray(conn.accounts) ? conn.accounts : []);
  const ctx = { creds: conn.creds || {}, env, email, connId: conn.id };

  for (let i = 0; i < accounts.length; i++) {
    const acc = accounts[i];
    // 카테고리는 사용자가 지정한 값(user 모드) 또는 provider 고정값(fixed 모드)
    const category = acc.category || '';
    const base = {
      id: `${conn.id}:${acc.code}`,
      label: `${conn.label || provider.label}${accounts.length > 1 ? ` · ${category || acc.code}` : ''}`,
      category,
      cashCategory: provider.cashCategory || category,
    };
    if (!category) {
      sources.push({ ...base, ok: false, error: '카테고리 미지정 (설정에서 연결을 수정하세요)', holdings: [], cash: null });
      continue;
    }
    try {
      const data = await provider.fetchAccount(ctx, acc.code);
      sources.push({ ...base, ok: true, holdings: data.holdings, cash: data.cash });
    } catch (err) {
      sources.push({ ...base, ok: false, error: err.message || String(err), holdings: [], cash: null });
    }
    if (i < accounts.length - 1 && provider.rateDelayMs) await sleep(provider.rateDelayMs);
  }
  return sources;
}

export async function onRequestGet({ request, env }) {
  const email = await getVerifiedEmail(request);
  if (!email) return new Response('unauthenticated', { status: 401 });

  const connections = await loadConnections(env, email);
  if (!connections.length) {
    return json({ ok: true, fetchedAt: new Date().toISOString(), sources: [],
      note: '등록된 증권사 연결이 없습니다. 설정 탭에서 연결을 추가하세요.' });
  }

  // 연결 단위로는 병렬(서로 다른 증권사라 rate limit 이 독립적), 연결 안에서는 순차.
  const settled = await Promise.allSettled(connections.map(c => fetchConnection(env, email, c)));
  const sources = [];
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled') sources.push(...r.value);
    else {
      const conn = connections[i];
      sources.push({
        id: `${conn.id}:?`, label: conn.label || conn.provider, category: '', cashCategory: '',
        ok: false, error: (r.reason && r.reason.message) || String(r.reason), holdings: [], cash: null,
      });
    }
  });

  return json({ ok: true, fetchedAt: new Date().toISOString(), sources });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}
