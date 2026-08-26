// ============================================================================
// Cloudflare Access JWT 검증 헬퍼 — Pages Functions 공용 모듈 (라우팅 제외 디렉토리).
// Access는 로그인 통과 요청에 Cf-Access-Jwt-Assertion 헤더(JWT)를 붙여준다.
// 새 Cloudflare One UI로 만든 앱은 이메일 평문 헤더를 안 붙여주므로, 이 JWT에서
// 이메일을 꺼내되 위조를 막기 위해 팀 공개키(RS256)로 서명을 검증한다.
// 검증 항목 — 서명, 발급자(iss), 대상 앱(aud), 유효기간(exp/nbf), email 존재.
// 공개키는 팀 도메인의 /cdn-cgi/access/certs 에서 받아 1시간 캐시하고,
// kid 미일치 시(키 회전) 1회 강제 재조회한다.
// ============================================================================

// Zero Trust 팀 도메인과 이 앱의 audience 태그 — 둘 다 비밀 아님 (로그인 리다이렉트
// URL에 그대로 노출되는 값). 앱을 다시 만들면 aud 가 바뀌므로 여기도 갱신할 것.
const TEAM_DOMAIN = 'https://tight-star-46f3.cloudflareaccess.com';
const APP_AUD = '9c1dd2243d688b0602906e04aa2183b3e8e21239775c51913c23e81737508bfd';

// 공개키 캐시 — 같은 isolate 가 살아있는 동안 재사용해 요청마다 certs 조회를 피한다.
let _certs = { keys: null, at: 0 };

// base64url 문자열을 바이트 배열로 디코드 (JWT 각 조각의 원형 복원용).
function b64urlToBytes(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// JWT 조각(base64url)을 JSON 객체로 디코드.
function decodePart(s) {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));
}

// 팀 도메인에서 서명 검증용 공개키(JWK) 목록을 받아온다. 실패 시 null.
async function fetchKeys() {
  const res = await fetch(`${TEAM_DOMAIN}/cdn-cgi/access/certs`);
  if (!res.ok) return null;
  const data = await res.json();
  return data.keys || null;
}

// 캐시 우선으로 공개키 목록을 돌려준다. force=true 면 캐시를 무시하고 재조회.
async function getKeys(force) {
  const now = Date.now();
  if (!force && _certs.keys && now - _certs.at < 3600 * 1000) return _certs.keys;
  const keys = await fetchKeys();
  if (keys) _certs = { keys, at: now };
  return _certs.keys;
}

// 요청의 Access JWT를 검증하고 인증된 사용자 이메일을 돌려준다.
// 토큰 부재·형식 오류·검증 실패 등 모든 이상 상황은 null (호출부에서 401 처리).
export async function getVerifiedEmail(request) {
  try {
    const jwt = request.headers.get('Cf-Access-Jwt-Assertion');
    if (!jwt) return null;
    const parts = jwt.split('.');
    if (parts.length !== 3) return null;
    const header = decodePart(parts[0]);
    const payload = decodePart(parts[1]);
    // 발급자·대상 앱 확인 — 다른 팀/다른 앱용 토큰 재사용 차단.
    if (payload.iss !== TEAM_DOMAIN) return null;
    const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!aud.includes(APP_AUD)) return null;
    // 유효기간 확인 (nbf 는 시계 오차 60초 허용).
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && now > payload.exp) return null;
    if (payload.nbf && now < payload.nbf - 60) return null;
    if (!payload.email) return null;
    // 서명 검증 (RS256) — kid 에 맞는 공개키를 찾고, 없으면 키 회전 대비 1회 재조회.
    let keys = await getKeys(false);
    let jwk = keys && keys.find(k => k.kid === header.kid);
    if (!jwk) {
      keys = await getKeys(true);
      jwk = keys && keys.find(k => k.kid === header.kid);
    }
    if (!jwk) return null;
    const key = await crypto.subtle.importKey(
      'jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']
    );
    const signed = new TextEncoder().encode(parts[0] + '.' + parts[1]);
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlToBytes(parts[2]), signed);
    return ok ? payload.email : null;
  } catch (_) {
    return null;
  }
}
