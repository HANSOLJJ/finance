// /api/whoami — 진단용. Access 가 이 요청에 붙여준 인증 정보를 그대로 돌려준다 (인증 게이트 없음, 항상 200).
// Tunnel 뒤에서 JWT 가 오리진까지 오는지 확인하는 용도 — verifiedEmail 에 이메일이 나오면
// 저장/조회 API 의 인증도 동일하게 성공한다.
import { Router } from 'express';
import { getVerifiedEmail } from '../lib/access.js';

// JWT의 payload(가운데 조각)를 서명 검증 없이 디코드한다 — 진단 표시 전용.
function decodeJwtPayload(jwt) {
  try {
    const b64 = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(b64));
  } catch (_) {
    return null;
  }
}

export default function whoamiRoutes() {
  const r = Router();
  r.get('/', async (req, res) => {
    const jwt = req.get('Cf-Access-Jwt-Assertion');
    res.set('Content-Type', 'application/json').send(JSON.stringify({
      email: req.get('Cf-Access-Authenticated-User-Email') || null,
      verifiedEmail: await getVerifiedEmail(req),
      hasJwt: !!jwt,
      claims: jwt ? decodeJwtPayload(jwt) : null,
    }, null, 2));
  });
  return r;
}
