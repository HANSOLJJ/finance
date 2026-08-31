// ============================================================================
// 계좌 찾기 — POST /api/broker-discover (functions/api/broker-discover.js 이식판)
// 한투처럼 "앱키 하나 밑에 여러 계좌(상품코드)"가 있는 증권사에서, 사용자가 상품코드를
// 몰라도 되게 후보 코드를 순차 조회해 실제로 응답하는 계좌만 돌려준다.
// 보유 종목 이름을 함께 주므로 사용자는 "아 이게 ISA구나" 하고 카테고리만 고르면 된다.
// (검증 단계에서 상품코드 스윕으로 계좌 지도를 실측했던 방식을 기능으로 옮긴 것.)
// [요청] { provider, creds } 또는 { provider, connId } — 저장된 연결을 수정 중이면
//        creds 를 다시 보내지 않아도 되도록 connId 로 기존 자격증명을 쓴다.
// [응답] { ok, accounts: [{ code, holdingCount, sampleNames[], cash }] }
// 틀린 코드는 증권사가 에러를 돌려줄 뿐이라 무해하다(조회 전용).
// ============================================================================
import { Router } from 'express';
import { requireAuth } from '../lib/access.js';
import { PROVIDERS, sleep } from '../lib/providers.js';

function parseBody(req) {
  try { return JSON.parse(typeof req.body === 'string' ? req.body : ''); } catch { return null; }
}

export default function brokerDiscoverRoutes(db) {
  const r = Router();
  r.use(requireAuth);

  r.post('/', async (req, res) => {
    const body = parseBody(req);
    if (!body || !body.provider) return res.status(400).json({ ok: false, error: 'provider 누락' });

    const provider = PROVIDERS[body.provider];
    if (!provider) return res.status(400).json({ ok: false, error: `알 수 없는 증권사: ${body.provider}` });
    if (!Array.isArray(provider.discoverCodes) || !provider.discoverCodes.length) {
      return res.status(400).json({ ok: false, error: `${provider.label}은 계좌 찾기를 지원하지 않습니다 (계좌가 고정)` });
    }

    // 자격증명 — 요청에 있으면 그것, 없으면 저장된 연결에서 (수정 화면에서 재입력 불필요)
    let creds = body.creds || {};
    if (body.connId) {
      const saved = db.getConnections(req.email).find(c => c.id === body.connId);
      if (saved) creds = { ...(saved.creds || {}), ...Object.fromEntries(Object.entries(creds).filter(([, v]) => v)) };
    }
    const missing = provider.credFields.filter(f => !creds[f.key]).map(f => f.label);
    if (missing.length) return res.status(400).json({ ok: false, error: `${missing.join(', ')} 입력 필요` });

    // 토큰 캐시는 연결 단위 — 아직 저장 전이면 임시 id 를 쓴다(부모 행 없이 broker_token 에만 남고 23시간 뒤 만료).
    const ctx = { creds, db, email: req.email, connId: body.connId || `discover:${body.provider}` };
    const accounts = [];
    const errors = [];
    for (let i = 0; i < provider.discoverCodes.length; i++) {
      const code = provider.discoverCodes[i];
      try {
        const data = await provider.fetchAccount(ctx, code);
        accounts.push({
          code,
          holdingCount: data.holdings.length,
          sampleNames: data.holdings.slice(0, 3).map(h => h.name),
          cash: data.cash ? data.cash.amount : 0,
        });
      } catch (err) {
        errors.push(`${code}: ${err.message || err}`);
      }
      if (i < provider.discoverCodes.length - 1 && provider.rateDelayMs) await sleep(provider.rateDelayMs);
    }

    // 전부 실패면 자격증명 자체가 틀렸을 가능성이 높으므로 에러를 그대로 보여준다 (원본대로 HTTP 200).
    if (!accounts.length) return res.status(200).json({ ok: false, error: `조회된 계좌가 없습니다 — ${errors.slice(0, 2).join(' / ')}` });
    res.json({ ok: true, accounts });
  });

  return r;
}
