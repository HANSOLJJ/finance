// ============================================================================
// 증권사 잔고 조회 프록시 — GET /api/broker
// 한투(연금저축·ISA)·키움(국내·미국)·빗썸의 잔고/예수금을 서버에서 조회해
// 공통 형식으로 정규화해 돌려준다. 클라이언트 상대는 js/broker.js(🏦 동기화 모달).
// [보안 모델]
//  - Access JWT 검증(getVerifiedEmail)으로 로그인 이메일을 얻는다.
//  - 증권사 API 키는 그 이메일 귀속 KV `user:<이메일>:broker:keys` 에서 로드
//    (등록은 /api/broker-keys — portfolio 와 동일한 per-user 저장 규약이라
//    사용자 간 구조적으로 격리되고, 친구도 자기 키를 등록하면 자기 계좌만 본다).
//  - 키가 등록되지 않은 증권사는 호출 자체를 생략하고 '미등록' 소스로 응답한다.
//  - KV에는 키 외에 접근 토큰 캐시(24h 파생물)만 저장 — KIS 토큰 발급이
//    1분 1회 제한이라 캐시가 필수다.
//  - 조회 TR만 호출한다. 주문 계열 API는 이 파일에 절대 추가하지 않는다.
// [응답] { ok, fetchedAt, sources: [{ id, label, category, ok, holdings, cash, error? }] }
//  - category 문자열은 js/constants.js CATEGORIES 의 key 와 정확히 일치해야 한다
//    (프론트 diff 가 이 값으로 섹션을 찾는다 — 커플링 주의).
//  - 에러 바디가 평문인 기존 관례와 달리 JSON({ok:false,error})을 쓴다 — 소스별
//    실패(rate limit/토큰/미등록)를 클라이언트가 구분 표시해야 하기 때문.
// ============================================================================
import { getVerifiedEmail } from '../_lib/access.js';
import { normalizeKis, normalizeKwDomestic, normalizeKwUs, normalizeBithumb } from '../_lib/brokers.js';

const KIS_BASE = 'https://openapi.koreainvestment.com:9443';
const KW_BASE = 'https://api.kiwoom.com';
const FETCH_TIMEOUT_MS = 8000;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// 토큰 관리 — KV 캐시 우선, 없으면 발급 후 23h TTL 저장(24h 유효에 1h 마진).
// 잔고 호출 실패 시 캐시 토큰이 죽었을 가능성이 있으므로 호출부에서
// 강제 재발급(force) → 1회 재시도한다. 캐시 키 규약은 broker-keys.js 와 공유.
// ---------------------------------------------------------------------------
async function getKisToken(env, email, keys, force = false) {
  const cacheKey = `user:${email}:broker:kis:token`;
  if (!force) {
    const cached = await env.KV.get(cacheKey);
    if (cached) return cached;
  }
  const res = await fetch(`${KIS_BASE}/oauth2/tokenP`, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ grant_type: 'client_credentials', appkey: keys.kisAppkey, appsecret: keys.kisAppsecret }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const body = await res.json();
  if (!body.access_token) throw new Error(`KIS 토큰 발급 실패: ${body.error_description || body.error_code || res.status}`);
  await env.KV.put(cacheKey, body.access_token, { expirationTtl: 23 * 3600 });
  return body.access_token;
}

async function getKwToken(env, email, keys, force = false) {
  const cacheKey = `user:${email}:broker:kw:token`;
  if (!force) {
    const cached = await env.KV.get(cacheKey);
    if (cached) return cached;
  }
  // 키움은 시크릿 필드명이 appsecret 이 아니라 secretkey 다 (한투와 다름 — 실측 확인).
  const res = await fetch(`${KW_BASE}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json;charset=UTF-8' },
    body: JSON.stringify({ grant_type: 'client_credentials', appkey: keys.kwAppkey, secretkey: keys.kwSecretkey }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const body = await res.json();
  if (body.return_code !== 0 || !body.token) throw new Error(`키움 토큰 발급 실패: ${body.return_msg || res.status}`);
  await env.KV.put(cacheKey, body.token, { expirationTtl: 23 * 3600 });
  return body.token;
}

// 빗썸 API 2.0 인증 — 업비트식 JWT(HS256). 토큰 발급 절차 없이 요청마다 서명 생성.
async function bithumbJwt(keys) {
  const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const enc = new TextEncoder();
  const header = b64u(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const payload = b64u(enc.encode(JSON.stringify({
    access_key: keys.bithumbKey, nonce: crypto.randomUUID(), timestamp: Date.now(),
  })));
  const cryptoKey = await crypto.subtle.importKey(
    'raw', enc.encode(keys.bithumbSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = b64u(await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(`${header}.${payload}`)));
  return `${header}.${payload}.${sig}`;
}

// ---------------------------------------------------------------------------
// 개별 TR 호출
// ---------------------------------------------------------------------------

// 한투 국내주식 잔고조회(TTTC8434R). 상품코드(22=연금저축, 01=ISA)로 계좌를 가른다.
// 페이지네이션(tr_cont)은 미구현 — 개인 계좌 규모(50건 미만)에서는 1페이지로 충분.
async function kisInquireBalance(keys, token, prdtCd) {
  const params = new URLSearchParams({
    CANO: keys.kisCano, ACNT_PRDT_CD: prdtCd,
    AFHR_FLPR_YN: 'N', OFL_YN: '', INQR_DVSN: '02', UNPR_DVSN: '01',
    FUND_STTL_ICLD_YN: 'N', FNCG_AMT_AUTO_RDPT_YN: 'N', PRCS_DVSN: '00',
    CTX_AREA_FK100: '', CTX_AREA_NK100: '',
  });
  const res = await fetch(`${KIS_BASE}/uapi/domestic-stock/v1/trading/inquire-balance?${params}`, {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      authorization: `Bearer ${token}`,
      appkey: keys.kisAppkey, appsecret: keys.kisAppsecret,
      tr_id: 'TTTC8434R', custtype: 'P',
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const body = await res.json();
  if (body.rt_cd !== '0') throw new Error(`KIS 잔고조회(${prdtCd}) 실패: ${(body.msg1 || '').trim()}`);
  return normalizeKis(body.output1, body.output2);
}

// 키움 공통 TR 호출 — api-id 헤더로 TR을 고른다. 계좌번호는 토큰에 묶여 body 불필요.
async function kwCall(keys, token, url, apiId, body) {
  const res = await fetch(`${KW_BASE}${url}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json;charset=UTF-8',
      authorization: `Bearer ${token}`,
      'api-id': apiId, 'cont-yn': 'N', 'next-key': '',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const out = await res.json();
  if (out.return_code !== 0) throw new Error(`키움 ${apiId} 실패: ${out.return_msg || res.status}`);
  return out;
}

// 토큰 캐시가 죽어 있을 수 있으므로 "실패 → 강제 재발급 → 1회 재시도" 공통 래퍼.
async function withTokenRetry(getToken, call) {
  let token = await getToken(false);
  try {
    return await call(token);
  } catch (_) {
    token = await getToken(true);
    return await call(token);
  }
}

// ---------------------------------------------------------------------------
// 증권사 그룹별 조회 — 성공 시 [{id, data:{holdings,cash}}], 실패 시 throw.
// ---------------------------------------------------------------------------
async function fetchKisSources(env, email, keys) {
  // KIS 는 rate limit 이 빡빡해(실측: 250ms 간격에도 초과) 두 계좌를 1.1초 간격 순차 호출.
  const get = (force) => getKisToken(env, email, keys, force);
  const pension = await withTokenRetry(get, (t) => kisInquireBalance(keys, t, '22'));
  await sleep(1100);
  const isa = await withTokenRetry(get, (t) => kisInquireBalance(keys, t, '01'));
  return [{ id: 'kis-pension', data: pension }, { id: 'kis-isa', data: isa }];
}

async function fetchKwSources(env, email, keys) {
  const get = (force) => getKwToken(env, email, keys, force);
  const kr = await withTokenRetry(get, async (t) => {
    const balance = await kwCall(keys, t, '/api/dostk/acnt', 'kt00018', { qry_tp: '1', dmst_stex_tp: 'KRX' });
    await sleep(300);
    const status = await kwCall(keys, t, '/api/dostk/acnt', 'kt00004', { qry_tp: '0', dmst_stex_tp: 'KRX' });
    return normalizeKwDomestic(balance, status);
  });
  await sleep(300);
  const us = await withTokenRetry(get, async (t) => {
    const ledger = await kwCall(keys, t, '/api/us/acnt', 'ust21070', { stex_tp: '', stk_cd: '' });
    await sleep(300);
    const deposit = await kwCall(keys, t, '/api/us/acnt', 'ust21160', {});
    return normalizeKwUs(ledger, deposit);
  });
  return [{ id: 'kw-kr', data: kr }, { id: 'kw-us', data: us }];
}

async function fetchBithumbSource(keys) {
  const jwt = await bithumbJwt(keys);
  const res = await fetch('https://api.bithumb.com/v1/accounts', {
    headers: { Authorization: `Bearer ${jwt}` },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const body = await res.json();
  if (!Array.isArray(body)) throw new Error(`빗썸 조회 실패: ${(body && body.error && body.error.message) || res.status}`);
  return [{ id: 'bithumb', data: normalizeBithumb(body) }];
}

// 소스 메타 — label 은 표시용, category 는 프론트 CATEGORIES key 와 일치(커플링).
const SOURCE_META = {
  'kis-pension': { label: '한투 연금저축', category: '연금저축펀드' },
  'kis-isa': { label: '한투 ISA', category: 'ISA' },
  'kw-kr': { label: '키움증권', category: '국내주식' },
  'kw-us': { label: '키움증권 (미국)', category: '해외주식' },
  bithumb: { label: '빗썸', category: '암호화폐' },
};

// GET /api/broker — 로그인 사용자의 등록 키로 3사를 병렬(각 사 내부는 순차) 조회.
// 소스별로 에러를 격리해 돌려준다 — 한 증권사가 죽어도 나머지는 정상 반환.
// 실패 소스는 프론트 diff 가 통째로 스킵(특히 삭제 오판 방지)하므로
// 실패를 빈 holdings 로 위장하지 말 것.
export async function onRequestGet({ request, env }) {
  const email = await getVerifiedEmail(request);
  if (!email) return new Response('unauthenticated', { status: 401 });

  const raw = await env.KV.get(`user:${email}:broker:keys`);
  let keys = {};
  try { keys = raw ? JSON.parse(raw) : {}; } catch { keys = {}; }

  const groups = [
    {
      ids: ['kis-pension', 'kis-isa'],
      ready: keys.kisAppkey && keys.kisAppsecret && keys.kisCano,
      run: () => fetchKisSources(env, email, keys),
    },
    {
      ids: ['kw-kr', 'kw-us'],
      ready: keys.kwAppkey && keys.kwSecretkey,
      run: () => fetchKwSources(env, email, keys),
    },
    {
      ids: ['bithumb'],
      ready: keys.bithumbKey && keys.bithumbSecret,
      run: () => fetchBithumbSource(keys),
    },
  ];

  const settled = await Promise.allSettled(groups.map(g =>
    g.ready ? g.run() : Promise.reject(new Error('미등록 (설정 탭에서 API 키를 등록하세요)'))));

  const sources = [];
  groups.forEach((g, i) => {
    const r = settled[i];
    if (r.status === 'fulfilled') {
      for (const { id, data } of r.value) {
        sources.push({ id, ...SOURCE_META[id], ok: true, holdings: data.holdings, cash: data.cash });
      }
    } else {
      const msg = (r.reason && r.reason.message) || String(r.reason);
      for (const id of g.ids) {
        sources.push({ id, ...SOURCE_META[id], ok: false, error: msg, holdings: [], cash: null });
      }
    }
  });

  return new Response(JSON.stringify({ ok: true, fetchedAt: new Date().toISOString(), sources }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
