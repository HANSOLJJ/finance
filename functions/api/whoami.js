// 진단용 Pages Function — Access가 이 요청에 붙여준 인증 정보를 그대로 돌려준다.
// 브라우저에서 /api/whoami 를 열면 서버가 받은 인증 이메일 헤더를 확인할 수 있다.
// email 이 null 이면 Access 인증 헤더가 서버까지 도달하지 않고 있다는 뜻이다.
export async function onRequestGet({ request }) {
  return new Response(JSON.stringify({
    email: request.headers.get('Cf-Access-Authenticated-User-Email') || null,
    hasJwt: !!request.headers.get('Cf-Access-Jwt-Assertion'),
  }), { headers: { 'Content-Type': 'application/json' } });
}
