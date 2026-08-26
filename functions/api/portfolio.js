// ============================================================================
// 포트폴리오 state를 사용자별로 KV에 저장/조회하는 Cloudflare Pages Function.
// GET /api/portfolio(?version=날짜) 은 조회, PUT /api/portfolio 는 저장을 담당하며
// 클라이언트 쪽 상대는 main.js bootstrap()(GET)과 sync.js savePortfolio()(PUT)다.
// [보안 모델] 인증은 Cloudflare Access가 엣지에서 수행 — 이 코드에 도달한 요청은
// 이미 로그인(구글/이메일 OTP)을 통과한 것이다. 사용자 식별은 Access가 붙여주는
// JWT(Cf-Access-Jwt-Assertion 헤더)를 _lib/access.js 에서 팀 공개키로 서명 검증한
// 뒤 그 안의 email 클레임으로 한다. 원래는 이메일 평문 헤더를 썼으나 새
// Cloudflare One UI 앱은 그 헤더를 안 붙여줘 JWT 검증 방식으로 교체(2026-08-26).
// 검증 실패·토큰 부재 시 401 — 서명을 확인하므로 가짜 토큰으로 남을 사칭할 수 없다.
// [KV 키 구조] user:<이메일>:portfolio:latest 가 최신본,
// user:<이메일>:portfolio:v:<KST날짜> 가 날짜별 롤백용 버전(90일 TTL).
// 키에 이메일이 들어가므로 사용자 간 데이터가 구조적으로 격리된다.
// ============================================================================
import { getVerifiedEmail } from '../_lib/access.js';

const MAX_BYTES = 5 * 1024 * 1024; // 5MB 상한 (현재 데이터 ~90KB)

// GET — 로그인 사용자의 저장본 조회. ?version=YYYY-MM-DD 를 주면 해당 날짜의
// 롤백용 버전을, 없으면 latest 를 돌려준다. 저장된 JSON 문자열을 파싱 없이
// 그대로 응답하므로 스키마 보정(migrateState)은 클라이언트가 수행한다.
export async function onRequestGet({ request, env }) {
  const email = await getVerifiedEmail(request);
  if (!email) return new Response('unauthenticated', { status: 401 });
  const version = new URL(request.url).searchParams.get('version');
  const key = version
    ? `user:${email}:portfolio:v:${version}`
    : `user:${email}:portfolio:latest`;
  const data = await env.KV.get(key);
  if (data === null) return new Response('not found', { status: 404 });
  return new Response(data, { headers: { 'Content-Type': 'application/json' } });
}

// PUT — 로그인 사용자의 state 전체를 저장. 크기 상한(5MB)과 최소한의 형태 검증
// (holdings 배열 존재)만 하고 latest 와 날짜 버전 두 키에 나눠 쓴다.
// 응답의 version(KST 날짜)은 클라이언트가 저장 확인용으로만 쓴다.
export async function onRequestPut({ request, env }) {
  const email = await getVerifiedEmail(request);
  if (!email) return new Response('unauthenticated', { status: 401 });
  const body = await request.text();
  if (new TextEncoder().encode(body).length > MAX_BYTES) {
    return new Response('too large', { status: 413 });
  }
  // 앱 state 형태인지 확인 — 깨진 데이터로 latest 를 덮어써 복구 불능이 되는
  // 사고 방지. 필드 단위 정밀 검증은 하지 않는다 (본인 데이터만 만질 수 있으므로).
  let state;
  try { state = JSON.parse(body); } catch { state = null; }
  if (!state || !Array.isArray(state.holdings)) {
    return new Response('invalid body: expected app state', { status: 400 });
  }
  const kstDate = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  await env.KV.put(`user:${email}:portfolio:latest`, body);
  // 날짜별 버전 (롤백용, 90일 자동 만료 — 같은 날 여러 번 저장하면 마지막 것만 남음)
  await env.KV.put(`user:${email}:portfolio:v:${kstDate}`, body, { expirationTtl: 90 * 24 * 3600 });
  return new Response(JSON.stringify({ ok: true, version: kstDate }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
