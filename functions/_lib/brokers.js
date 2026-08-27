// ============================================================================
// 증권사 API 응답 → 공통 잔고 형식 정규화 (네트워크 없는 순수 함수만).
// functions/api/broker.js 가 각 사 API를 호출한 뒤 이 모듈로 응답을 표준화한다.
// 네트워크·env 접근이 전혀 없어 Node 로 픽스처 단위 테스트가 가능하다 —
// 함수를 바꾸면 실측 캡처(config/API검증결과.md 기록) 기준으로 재검증할 것.
// [공통 출력 형식]
//   holdings: [{ symbol, name, quantity, avgPrice, price, currency }]
//     - symbol: 앱 매칭 키 (국내 6자리 코드 / 미국 티커 / 코인 심볼 대문자)
//     - avgPrice·price: 해당 통화 단가. 빗썸은 현재가 미제공이라 price 0
//   cash: { amount, currency } — D+2 결제 기준 예수금 (사용자 결정: 미결제 대금 배제)
// ============================================================================

// 증권사 응답의 숫자 파싱 — 키움은 zero-pad 문자열('000000000000010'),
// 한투는 소수 문자열('19368.9174')로 온다. 콤마·공백까지 안전 처리.
export function n(v) {
  const x = parseFloat(String(v ?? '').replace(/,/g, '').trim());
  return Number.isFinite(x) ? x : 0;
}

// 한투(KIS) 국내주식 잔고조회(TTTC8434R) 응답 정규화.
// output1[] = 보유 종목 (pdno 6자리 / prdt_name / hldg_qty / pchs_avg_pric / prpr),
// output2[0].prvs_rcdl_excc_amt = D+2 예수금. 잔량 0 행(전량 매도 후 잔재)은 제외.
export function normalizeKis(output1, output2) {
  const holdings = (Array.isArray(output1) ? output1 : [])
    .filter(o => n(o.hldg_qty) > 0)
    .map(o => ({
      symbol: String(o.pdno || '').trim(),
      name: String(o.prdt_name || '').trim(),
      quantity: n(o.hldg_qty),
      avgPrice: n(o.pchs_avg_pric),
      price: n(o.prpr),
      currency: 'KRW',
    }));
  const o2 = Array.isArray(output2) ? output2[0] : output2;
  return { holdings, cash: { amount: n(o2 && o2.prvs_rcdl_excc_amt), currency: 'KRW' } };
}

// 키움 국내주식 정규화 — 계좌평가잔고내역(kt00018) + 계좌평가현황(kt00004, D+2 예수금).
// 종목코드의 'A' 접두사(A000660)를 제거해 앱 6자리 코드와 맞춘다.
export function normalizeKwDomestic(balanceBody, statusBody) {
  const holdings = (Array.isArray(balanceBody && balanceBody.acnt_evlt_remn_indv_tot)
    ? balanceBody.acnt_evlt_remn_indv_tot : [])
    .filter(o => n(o.rmnd_qty) > 0)
    .map(o => ({
      symbol: String(o.stk_cd || '').trim().replace(/^A/, ''),
      name: String(o.stk_nm || '').trim(),
      quantity: n(o.rmnd_qty),
      avgPrice: n(o.pur_pric),
      price: n(o.cur_prc),
      currency: 'KRW',
    }));
  return { holdings, cash: { amount: n(statusBody && statusBody.d2_entra), currency: 'KRW' } };
}

// 키움 미국주식 정규화 — 원장잔고확인(ust21070) + 예수금 상세(ust21160, D+2 USD).
// 미국 종목코드는 티커 그대로(접두사 없음), 단가는 전부 USD.
export function normalizeKwUs(ledgerBody, depositBody) {
  const holdings = (Array.isArray(ledgerBody && ledgerBody.result_list)
    ? ledgerBody.result_list : [])
    .filter(o => n(o.poss_qty) > 0)
    .map(o => ({
      symbol: String(o.stk_cd || '').trim().toUpperCase(),
      name: String(o.frgn_stk_nm || '').trim(),
      quantity: n(o.poss_qty),
      avgPrice: n(o.frgn_stk_book_uv),
      price: n(o.now_pric),
      currency: 'USD',
    }));
  return { holdings, cash: { amount: n(depositBody && depositBody.d2_usd_fx_entr), currency: 'USD' } };
}

// 빗썸 자산 조회(/v1/accounts) 정규화 — KRW 항목은 예수금(cash)으로 분리하고
// 코인은 balance+locked 합산 수량 + 매수 평단(KRW)으로 표준화한다.
// 현재가는 응답에 없으므로 0 — 시세는 앱의 기존 암호화폐 갱신 체계가 담당.
// dust(평단 0·소액) 필터는 기존 행 매칭 여부를 알아야 하므로 프론트 diff 책임.
export function normalizeBithumb(accounts) {
  const list = Array.isArray(accounts) ? accounts : [];
  const holdings = list
    .filter(a => String(a.currency || '').toUpperCase() !== 'KRW')
    .map(a => ({
      symbol: String(a.currency || '').toUpperCase(),
      name: String(a.currency || '').toUpperCase(),
      quantity: n(a.balance) + n(a.locked),
      avgPrice: n(a.avg_buy_price),
      price: 0,
      currency: 'KRW',
    }))
    .filter(a => a.quantity > 0);
  const krw = list.find(a => String(a.currency || '').toUpperCase() === 'KRW');
  return { holdings, cash: { amount: krw ? n(krw.balance) + n(krw.locked) : 0, currency: 'KRW' } };
}
