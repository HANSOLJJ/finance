// ============================================================================
// 증권사 provider 레지스트리 — "증권사마다 다른 것"만 여기에 선언한다.
// 새 증권사 추가 = 이 파일에 항목 1개 + _lib/brokers.js 에 정규화 함수 1개.
// 저장 구조·설정 UI·diff·미리보기는 이 선언을 읽어 동작하므로 수정할 필요가 없다.
//
// [provider 항목 스펙]
//  label            표시 이름
//  credFields       자격증명 입력 정의 [{key, label, hint?}] — 설정 화면이 이걸로 폼을 그린다
//  accountMode      'fixed' = 조회 대상이 고정(키움 국내/미국, 빗썸)
//                   'user'  = 사용자가 계좌를 지정해야 함(한투 — 상품코드별로 계좌가 다름)
//  accounts         accountMode 'fixed' 일 때의 계좌 목록 [{code, category}]
//  accountCodeLabel/Hint  accountMode 'user' 일 때 입력 안내
//  discoverCodes    [계좌 찾기]가 순차 시도할 후보 코드 (accountMode 'user' 전용)
//  rateDelayMs      같은 연결 안에서 계좌를 연달아 조회할 때의 간격
//  cashCategory     예수금을 계좌 카테고리가 아닌 다른 섹션에 둬야 할 때만 선언
//  fetchAccount(ctx, code) → { holdings, cash } (실패 시 throw)
//                   ctx = { creds, env, email, connId }
//
// [보안] 조회 TR만 호출한다. 주문 계열 API는 어떤 provider 에도 추가하지 않는다.
// ============================================================================
import { normalizeKis, normalizeKwDomestic, normalizeKwUs, normalizeBithumb } from './brokers.js';

const KIS_BASE = 'https://openapi.koreainvestment.com:9443';
const KW_BASE = 'https://api.kiwoom.com';
const FETCH_TIMEOUT_MS = 8000;

export const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// 접근 토큰 캐시 — 연결(connId)마다 앱키가 다르므로 캐시 키도 연결 단위로 나눈다.
// KIS 는 토큰 발급이 1분 1회 제한이라 캐시가 사실상 필수.
async function cachedToken(ctx, issue, force = false) {
  const cacheKey = `user:${ctx.email}:broker:token:${ctx.connId}`;
  if (!force) {
    const cached = await ctx.env.KV.get(cacheKey);
    if (cached) return cached;
  }
  const token = await issue();
  await ctx.env.KV.put(cacheKey, token, { expirationTtl: 23 * 3600 });
  return token;
}

// 캐시된 토큰이 죽어 있을 수 있으므로 "실패 → 강제 재발급 → 1회 재시도" 공통 래퍼.
async function withToken(ctx, issue, call) {
  try {
    return await call(await cachedToken(ctx, issue, false));
  } catch (_) {
    return await call(await cachedToken(ctx, issue, true));
  }
}

// ---------------------------------------------------------------------------
// 한국투자증권 — 계좌번호 앞 8자리(cano)는 연결 단위, 뒤 2자리(상품코드)가 계좌 단위.
// 같은 앱키로 여러 상품코드를 조회하므로 accountMode 는 'user'.
// ---------------------------------------------------------------------------
async function kisIssueToken(creds) {
  const res = await fetch(`${KIS_BASE}/oauth2/tokenP`, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ grant_type: 'client_credentials', appkey: creds.appkey, appsecret: creds.appsecret }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const body = await res.json();
  if (!body.access_token) throw new Error(`토큰 발급 실패: ${body.error_description || body.error_code || res.status}`);
  return body.access_token;
}

// 국내주식 잔고조회(TTTC8434R). 페이지네이션은 미구현 — 개인 계좌 규모(50건 미만)에서 1페이지로 충분.
async function kisBalance(creds, token, prdtCd) {
  const params = new URLSearchParams({
    CANO: creds.cano, ACNT_PRDT_CD: prdtCd,
    AFHR_FLPR_YN: 'N', OFL_YN: '', INQR_DVSN: '02', UNPR_DVSN: '01',
    FUND_STTL_ICLD_YN: 'N', FNCG_AMT_AUTO_RDPT_YN: 'N', PRCS_DVSN: '00',
    CTX_AREA_FK100: '', CTX_AREA_NK100: '',
  });
  const res = await fetch(`${KIS_BASE}/uapi/domestic-stock/v1/trading/inquire-balance?${params}`, {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      authorization: `Bearer ${token}`,
      appkey: creds.appkey, appsecret: creds.appsecret,
      tr_id: 'TTTC8434R', custtype: 'P',
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const body = await res.json();
  if (body.rt_cd !== '0') throw new Error((body.msg1 || `rt_cd=${body.rt_cd}`).trim());
  return normalizeKis(body.output1, body.output2);
}

// ---------------------------------------------------------------------------
// 키움증권 — 계좌번호가 토큰에 묶여 있어 요청 본문에 계좌 지정이 불필요하다.
// 조회 대상이 국내/미국 둘로 고정이므로 accountMode 는 'fixed'.
// ---------------------------------------------------------------------------
async function kwIssueToken(creds) {
  // 시크릿 필드명이 한투(appsecret)와 달리 secretkey 다 — 실측 확인.
  const res = await fetch(`${KW_BASE}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json;charset=UTF-8' },
    body: JSON.stringify({ grant_type: 'client_credentials', appkey: creds.appkey, secretkey: creds.secretkey }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const body = await res.json();
  if (body.return_code !== 0 || !body.token) throw new Error(`토큰 발급 실패: ${body.return_msg || res.status}`);
  return body.token;
}

// 키움 공통 TR 호출 — api-id 헤더로 TR을 고른다.
async function kwCall(token, url, apiId, body) {
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
  if (out.return_code !== 0) throw new Error(`${apiId}: ${out.return_msg || res.status}`);
  return out;
}

// ---------------------------------------------------------------------------
// 빗썸 — API 2.0(업비트식 JWT HS256). 토큰 발급 절차 없이 요청마다 서명한다.
// ---------------------------------------------------------------------------
async function bithumbJwt(creds) {
  const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const enc = new TextEncoder();
  const header = b64u(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const payload = b64u(enc.encode(JSON.stringify({
    access_key: creds.key, nonce: crypto.randomUUID(), timestamp: Date.now(),
  })));
  const cryptoKey = await crypto.subtle.importKey(
    'raw', enc.encode(creds.secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = b64u(await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(`${header}.${payload}`)));
  return `${header}.${payload}.${sig}`;
}

// ---------------------------------------------------------------------------
// 레지스트리 — 여기 항목을 추가하는 것이 "새 증권사 지원"의 전부다.
// (토스증권은 2026-05 개인 API 출시했으나 호출 IP allowlist 요구 — Workers 는 고정 IP가
//  아니라 보류. 삼성증권은 기관 전용이라 개인 연동 불가.)
// ---------------------------------------------------------------------------
export const PROVIDERS = {
  kis: {
    label: '한국투자증권',
    credFields: [
      { key: 'appkey', label: '앱키' },
      { key: 'appsecret', label: '앱시크릿' },
      { key: 'cano', label: '계좌번호 앞 8자리', hint: '예: 12345678' },
    ],
    accountMode: 'user',
    accountCodeLabel: '상품코드',
    accountCodeHint: '계좌번호 뒤 2자리 — 22=연금저축, 01=ISA, 29=IRP',
    discoverCodes: ['01', '22', '29', '21', '25', '63'],
    rateDelayMs: 1100, // 실측: 250ms 간격에도 "초당 거래건수 초과" 발생
    async fetchAccount(ctx, code) {
      return withToken(ctx, () => kisIssueToken(ctx.creds), (t) => kisBalance(ctx.creds, t, code));
    },
  },

  kiwoom: {
    label: '키움증권',
    credFields: [
      { key: 'appkey', label: '앱키' },
      { key: 'secretkey', label: '시크릿키' },
    ],
    accountMode: 'fixed',
    accounts: [
      { code: 'kr', category: '국내주식' },
      { code: 'us', category: '해외주식' },
    ],
    rateDelayMs: 300,
    async fetchAccount(ctx, code) {
      return withToken(ctx, () => kwIssueToken(ctx.creds), async (t) => {
        if (code === 'kr') {
          const balance = await kwCall(t, '/api/dostk/acnt', 'kt00018', { qry_tp: '1', dmst_stex_tp: 'KRX' });
          await sleep(300);
          const status = await kwCall(t, '/api/dostk/acnt', 'kt00004', { qry_tp: '0', dmst_stex_tp: 'KRX' });
          return normalizeKwDomestic(balance, status);
        }
        const ledger = await kwCall(t, '/api/us/acnt', 'ust21070', { stex_tp: '', stk_cd: '' });
        await sleep(300);
        const deposit = await kwCall(t, '/api/us/acnt', 'ust21160', {});
        return normalizeKwUs(ledger, deposit);
      });
    },
  },

  bithumb: {
    label: '빗썸',
    credFields: [
      { key: 'key', label: '액세스 키' },
      { key: 'secret', label: '시크릿 키' },
    ],
    accountMode: 'fixed',
    accounts: [{ code: 'spot', category: '암호화폐' }],
    // 원화 예수금은 암호화폐 섹션(자산타입 고정)에 넣으면 코인 비중이 왜곡되므로 현금 섹션으로.
    cashCategory: '현금',
    rateDelayMs: 0,
    async fetchAccount(ctx) {
      const res = await fetch('https://api.bithumb.com/v1/accounts', {
        headers: { Authorization: `Bearer ${await bithumbJwt(ctx.creds)}` },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      const body = await res.json();
      if (!Array.isArray(body)) throw new Error((body && body.error && body.error.message) || `HTTP ${res.status}`);
      return normalizeBithumb(body);
    },
  },
};

// 설정 화면이 폼을 그리는 데 필요한 메타만 추린다 (fetchAccount 같은 함수는 제외).
export function providerMeta() {
  const out = {};
  for (const [id, p] of Object.entries(PROVIDERS)) {
    out[id] = {
      label: p.label,
      credFields: p.credFields,
      accountMode: p.accountMode,
      accounts: p.accounts || null,
      accountCodeLabel: p.accountCodeLabel || null,
      accountCodeHint: p.accountCodeHint || null,
      discoverable: Array.isArray(p.discoverCodes) && p.discoverCodes.length > 0,
    };
  }
  return out;
}
