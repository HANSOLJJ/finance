// 진단용 Pages Function — Access가 이 요청에 붙여준 인증 정보를 그대로 돌려준다.
// 브라우저에서 /api/whoami 를 열면 서버가 받은 인증 이메일 헤더와
// Access JWT(인증 토큰)의 내용물(claims)을 확인할 수 있다.
// email 이 null 인데 hasJwt 가 true 면 토큰은 오는데 이메일 헤더만 빠진 상태다.

// JWT의 payload(가운데 조각)를 서명 검증 없이 디코드한다 — 진단 표시 전용.
function decodeJwtPayload(jwt) {
  try {
    const b64 = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(b64));
  } catch (_) {
    return null;
  }
}

export async function onRequestGet({ request }) {
  const jwt = request.headers.get('Cf-Access-Jwt-Assertion');
  return new Response(JSON.stringify({
    email: request.headers.get('Cf-Access-Authenticated-User-Email') || null,
    hasJwt: !!jwt,
    claims: jwt ? decodeJwtPayload(jwt) : null,
  }, null, 2), { headers: { 'Content-Type': 'application/json' } });
}
