// fetch.js — 외부 시세·지표 수집 계층. 야후 파이낸스(주식/ETF 시세·환율·금 선물),
// 네이버 금융(한국주식 자동완성), 빗썸/업비트/코인게코(코인 KRW 시세),
// Frankfurter(ECB 환율 폴백), FRED(미국 M2)·BLS(미국 CPI)까지 앱의 네트워크 호출 전부를 담당한다.
// CORS를 차단하는 API는 같은 origin의 /api/proxy(서버 프록시)를 거치고, 실패 시 공개 프록시로 폴백.
// 주요 함수 그룹 — 프록시(CORS_PROXIES·fetchViaProxy), 환율(fetchExchangeRate·updateFxBadge),
// 시세 수집(fetchStockPrice·fetchCryptoPrice·fetchAndApplyGoldPrice·refreshHolding·refreshAllPrices),
// 검색 자동완성(searchQuotes·searchNaverFinance·onSearch 계열), 거시지표(fetchM2·fetchUSCPI).
// 로드 순서 constants→state→calc→render→charts→data-io→fetch→sync→broker→main 중 7번째.
// calc.js(num)·state.js(state·saveState)·render.js(render 계열)·data-io.js(toast)에 의존하고,
// data-io.js의 snapshot()이 이 파일의 fetchUSCPI/fetchM2를 호출한다.
// ==================== 외부 시세/환율 API ====================
// 프록시 응답이 진짜 JSON인지 검증한 뒤 파싱한다. 일부 공개 프록시는 실패 시에도
// HTTP 200으로 HTML 에러 페이지(Access Denied 등)를 돌려주므로,
// '<'로 시작하거나 에러 문구가 보이면 즉시 throw 해 fetchViaProxy가 다음 프록시로 넘어가게 한다.
function _validateJSON(text) {
  const trimmed = text.trimStart();
  if (trimmed.startsWith('<') || /access denied|forbidden|<html/i.test(trimmed.substring(0, 200))) {
    throw new Error('Proxy returned HTML/error page');
  }
  return JSON.parse(text);
}

// CORS 우회 프록시 목록(배열 순서 = 시도 우선순위). 야후·FRED 등 대다수 금융 API는
// 브라우저 직접 호출을 CORS로 차단하므로 서버가 대신 받아 전달해 줘야 한다.
// 1순위 '/api/proxy?url='은 같은 origin의 자체 서버 프록시 — 배포 환경에서는
// Cloudflare Pages Functions, 로컬 개발에서는 proxy_server.py가 이 경로를 처리한다.
// 나머지 셋(corsproxy.io·allorigins·codetabs)은 자체 프록시가 없는 환경용 공개 프록시 폴백.
// allorigins만 응답을 { contents: "..." }로 감싸므로 parse에서 한 겹 벗겨서 파싱한다.
const CORS_PROXIES = [
  {
    // 같은 origin의 /api/proxy — 배포(Cloudflare Pages Functions)와 로컬(proxy_server.py) 모두 이 경로
    name: 'api-proxy',
    build: url => `/api/proxy?url=${encodeURIComponent(url)}`,
    parse: async r => _validateJSON(await r.text()),
  },
  {
    name: 'corsproxy.io',
    build: url => `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
    parse: async r => _validateJSON(await r.text()),
  },
  {
    name: 'allorigins/get',
    build: url => `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`,
    parse: async r => {
      const wrapped = await r.json();
      if (!wrapped.contents) throw new Error('빈 응답');
      return _validateJSON(wrapped.contents);
    },
  },
  {
    name: 'codetabs',
    build: url => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
    parse: async r => _validateJSON(await r.text()),
  },
];

// CORS 우회 공통 진입점. CORS_PROXIES를 순서대로 시도해 첫 성공 JSON을 반환하고,
// HTTP 에러·HTML 응답·파싱 실패는 다음 프록시로 넘어가며 전부 실패하면 마지막 에러를 throw 한다.
// 야후·FRED 등 CORS 차단 API 호출이 전부 이 함수를 거친다(직접 호출 가능한 API는 예외).
async function fetchViaProxy(url) {
  let lastErr;
  for (const p of CORS_PROXIES) {
    try {
      const r = await fetch(p.build(url));
      if (!r.ok) { lastErr = new Error(`${p.name}: HTTP ${r.status}`); continue; }
      const data = await p.parse(r);
      if (data) return data;
    } catch (e) {
      lastErr = new Error(`${p.name}: ${e.message}`);
    }
  }
  throw lastErr || new Error('모든 프록시 실패');
}

// 문자열에 한글(음절·자모)이 있는지 검사. 검색어가 한글이면 네이버 우선 경로로 분기하는 데 쓴다.
function hasKorean(s) { return /[가-힯ᄀ-ᇿ㄰-㆏]/.test(s); }

// 네이버 자동완성 응답을 앱 공통 검색 결과 형식으로 변환한다.
// KOSPI/KOSDAQ 국내주식만 남기고 최대 10건으로 자른 뒤,
// 6자리 종목코드에 .KS/.KQ 접미사를 붙여 야후 시세 조회용 ticker를 미리 만들어 둔다.
function parseNaverResults(data) {
  const items = data?.result?.items || data?.items || [];
  return items
    .filter(it => {
      const tc = it.typeCode || '';
      const tn = it.typeName || '';
      return tc === 'KOSPI' || tc === 'KOSDAQ' || tn.includes('주식') || tn.includes('국내');
    })
    .slice(0, 10)
    .map(it => {
      const code = it.code || it.itemCode;
      let yahooSym;
      if (it.typeCode === 'KOSPI') yahooSym = code + '.KS';
      else if (it.typeCode === 'KOSDAQ') yahooSym = code + '.KQ';
      else yahooSym = code;
      return {
        name: it.name || it.itemName,
        ticker: yahooSym,
        symbol: code,
        exchange: it.typeCode || it.typeName || '',
      };
    });
}

// 네이버 모바일 금융 자동완성 API(m.stock.naver.com/front-api/search/autoComplete)로
// 한국주식을 검색한다. 한글 종목명 매칭이 야후보다 좋아 한글 쿼리의 1순위 소스.
// 직접 fetch를 먼저 시도하고(네이버가 CORS를 허용하는 경우가 있음), 막히면 프록시로 폴백한다.
async function searchNaverFinance(query) {
  const url = `https://m.stock.naver.com/front-api/search/autoComplete?query=${encodeURIComponent(query)}&target=stock,index,marketindicator`;
  // 1) 직접 호출 시도 (네이버가 CORS 허용해 줄 수도)
  try {
    const r = await fetch(url);
    if (r.ok) {
      const data = await r.json();
      const results = parseNaverResults(data);
      if (results.length > 0) return results;
    }
  } catch (e) {
    // CORS 에러 등 -> 프록시로 폴백
  }
  // 2) 프록시 폴백
  const data = await fetchViaProxy(url);
  return parseNaverResults(data);
}

// USD/KRW 환율 갱신. 1순위 야후 KRW=X 차트 API(실시간, 프록시 경유) →
// 실패 시 Frankfurter(ECB 공식 고시, 전일자, CORS 허용이라 직접 호출) 폴백.
// 성공하면 state.usdKrwRate·rateUpdatedAt·rateSource를 저장(localStorage)하고
// 환율에 의존하는 UI(환율 배지·KPI·목표·차트·보유목록)를 다시 렌더한다.
// showToast=true면 결과를 토스트로 알린다(수동 갱신 버튼 경로에서 사용).
async function fetchExchangeRate(showToast = false) {
  const badge = document.getElementById('fxBadge');
  badge.classList.add('loading');
  let rate = null;
  let source = '';
  // 1순위: Yahoo Finance KRW=X (실시간 환율, 프록시 경유)
  try {
    const url = 'https://query1.finance.yahoo.com/v8/finance/chart/KRW%3DX?interval=1d&range=1d';
    const data = await fetchViaProxy(url);
    const meta = data?.chart?.result?.[0]?.meta;
    const yPrice = meta?.regularMarketPrice;
    if (yPrice && isFinite(yPrice) && yPrice > 0) {
      rate = yPrice;
      source = 'Yahoo';
    }
  } catch (e) {
    console.warn('Yahoo 환율 실패, Frankfurter 폴백:', e.message);
  }
  // 2순위: Frankfurter (ECB 공식, 일 1회 갱신)
  if (!rate) {
    try {
      const res = await fetch('https://api.frankfurter.dev/v1/latest?base=USD&symbols=KRW');
      if (!res.ok) throw new Error('Frankfurter 응답 실패');
      const data = await res.json();
      rate = data?.rates?.KRW;
      source = 'ECB(전일)';
    } catch (e) {
      console.error('Frankfurter도 실패:', e);
    }
  }
  if (rate && isFinite(rate)) {
    state.usdKrwRate = rate;
    state.rateUpdatedAt = new Date().toISOString();
    state.rateSource = source;
    saveState();
    updateFxBadge();
    if (showToast) toast(`💱 1 USD = ${rate.toFixed(2)} KRW (${source})`);
    renderKPIs();
    renderAssetTypeTargets();
    renderExpTargets();
    renderCharts();
    renderHoldings();
  } else {
    if (showToast) toast('⚠️ 환율 갱신 실패 - 모든 소스 차단');
  }
  badge.classList.remove('loading');
}

// 상단 환율 배지(#fxRate/#fxMeta)에 현재 환율(소수 2자리)과 마지막 갱신 시각(HH:MM)을 표시한다.
// 갱신 이력이 없으면 '미갱신'으로 표시. DOM만 갱신하는 순수 표시 함수.
function updateFxBadge() {
  document.getElementById('fxRate').textContent = num(state.usdKrwRate).toFixed(2);
  if (state.rateUpdatedAt) {
    const dt = new Date(state.rateUpdatedAt);
    const hh = String(dt.getHours()).padStart(2, '0');
    const mm = String(dt.getMinutes()).padStart(2, '0');
    document.getElementById('fxMeta').textContent = `${hh}:${mm} 갱신`;
  } else {
    document.getElementById('fxMeta').textContent = '미갱신';
  }
}

// 코인 KRW 시세 수집. state.cryptoExchange 설정(기본 빗썸)에 따라
// 빗썸(public/ticker)·업비트(v1/ticker)·코인게코(simple/price) 중 한 API를 호출한다.
// 세 거래소 API 모두 CORS를 허용하므로 프록시 없이 직접 호출한다.
// 빗썸/업비트는 h.symbol(BTC 같은 티커), 코인게코는 h.ticker(coingecko id)가 필요한데
// 이 값들은 검색 자동완성으로 종목을 선택해야 채워진다(직접 타이핑만 하면 비어 있음).
// 성공 시 h.price(KRW)와 lastFetched를 갱신·저장하고 { ok, price }를 반환, 실패 시 토스트 알림.
async function fetchCryptoPrice(holdingId) {
  const h = state.holdings.find(x => x.id === holdingId);
  if (!h) return;
  const exch = state.cryptoExchange || 'bithumb';
  const symbol = String(h.symbol || '').toUpperCase();
  const coinId = String(h.ticker || '').toLowerCase();

  if (!symbol && !coinId) { toast('⚠️ 종목을 검색해서 선택하세요'); return; }

  try {
    let price;
    if (exch === 'bithumb') {
      if (!symbol) throw new Error('빗썸용 심볼 없음 (검색해서 선택 후 사용)');
      const r = await fetch(`https://api.bithumb.com/public/ticker/${symbol}_KRW`);
      const data = await r.json();
      if (data.status !== '0000') throw new Error('빗썸 응답: ' + (data.message || data.status));
      price = num(data.data.closing_price);
    } else if (exch === 'upbit') {
      if (!symbol) throw new Error('업비트용 심볼 없음');
      const r = await fetch(`https://api.upbit.com/v1/ticker?markets=KRW-${symbol}`);
      const data = await r.json();
      if (!Array.isArray(data) || !data[0]) throw new Error('업비트 응답 없음');
      price = num(data[0].trade_price);
    } else {
      // CoinGecko (글로벌 평균)
      if (!coinId) throw new Error('CoinGecko ID 없음');
      const r = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(coinId)}&vs_currencies=krw`);
      const data = await r.json();
      price = num(data?.[coinId]?.krw);
    }
    if (!price || price <= 0) throw new Error('시세 없음');
    h.price = String(price);
    h.lastFetched = new Date().toISOString();
    saveState();
    return { ok: true, price };
  } catch (e) {
    toast('⚠️ ' + (h.name || symbol || coinId) + ' 시세 실패: ' + e.message);
    console.error('Crypto fetch error:', e);
    return { ok: false };
  }
}

// ==================== 검색 (자동완성) ====================
let _searchTimer = null;

// 종목 검색 통합 진입점. 코인이면 코인게코 검색 API(CORS 허용, 직접 호출),
// 주식이면 한글 쿼리는 네이버 우선 → 실패·결과 없음 시 야후 검색 API(프록시 경유) 폴백.
// 야후 결과는 주식/ETF/펀드(EQUITY·ETF·MUTUALFUND)만 남기고 최대 10건으로 자른다.
// 반환 형식은 소스와 무관하게 { name, ticker, symbol, exchange } 공통 구조로 통일한다.
async function searchQuotes(query, isCrypto) {
  query = String(query || '').trim();
  if (query.length < 1) return [];
  if (isCrypto) {
    const r = await fetch(`https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(query)}`);
    const data = await r.json();
    return (data.coins || []).slice(0, 10).map(c => ({
      name: c.name,
      ticker: c.id,           // CoinGecko id (저장용)
      symbol: (c.symbol || '').toUpperCase(),  // 거래소용 심볼
      exchange: 'Crypto',
      thumb: c.thumb,
    }));
  } else {
    // 한글 쿼리는 네이버 우선. 실패 시 Yahoo 폴백.
    if (hasKorean(query)) {
      try {
        const naverResults = await searchNaverFinance(query);
        if (naverResults.length > 0) return naverResults;
      } catch (e) {
        console.warn('Naver 검색 실패, Yahoo로 폴백:', e.message);
      }
    }
    const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=10&newsCount=0`;
    const data = await fetchViaProxy(url);
    const wantedTypes = ['EQUITY', 'ETF', 'MUTUALFUND'];
    return (data.quotes || [])
      .filter(q => wantedTypes.includes(q.quoteType))
      .slice(0, 10)
      .map(q => ({
        name: q.shortname || q.longname || q.symbol,
        ticker: q.symbol,
        symbol: q.symbol,
        exchange: q.exchDisp || q.exchange || '',
      }));
  }
}

// 종목명 입력 핸들러. 입력값을 h.name에 즉시 저장해 직접 타이핑한 이름도 유지하고,
// 300ms 디바운스 뒤 searchQuotes()로 자동완성 드롭다운을 갱신한다.
// 결과 클릭은 blur보다 먼저 잡히도록 mousedown에 바인딩한다(선택 시 시세 갱신으로 이어짐).
function onSearchInput(e) {
  const id = e.target.getAttribute('data-search');
  const h = state.holdings.find(x => x.id === id);
  if (!h) return;
  const value = e.target.value;
  // name 도 동기 저장 (사용자가 원하면 직접 타이핑한 이름 유지)
  h.name = value;
  saveState();

  const dropdown = document.querySelector(`[data-dropdown="${id}"]`);
  if (!dropdown) return;

  const q = value.trim();
  if (q.length < 1) {
    dropdown.classList.remove('show');
    return;
  }

  // 디바운스
  if (_searchTimer) clearTimeout(_searchTimer);
  dropdown.innerHTML = '<div class="loading">검색 중...</div>';
  dropdown.classList.add('show');

  _searchTimer = setTimeout(async () => {
    const cat = CATEGORY_MAP[h.category];
    try {
      const results = await searchQuotes(q, !!cat?.isCrypto);
      if (!results.length) {
        dropdown.innerHTML = '<div class="empty">결과 없음</div>';
        return;
      }
      dropdown.innerHTML = results.map((r, i) => `
        <div class="result" data-idx="${i}">
          <div class="result-name">${escapeHtml(r.name)}</div>
          <div class="result-meta">
            <span class="sym">${escapeHtml(r.symbol || r.ticker)}</span>
            ${r.exchange ? `<span class="exch">${escapeHtml(r.exchange)}</span>` : ''}
          </div>
        </div>
      `).join('');
      dropdown._results = results;
      dropdown._holdingId = id;
      dropdown.querySelectorAll('.result').forEach(el => {
        el.addEventListener('mousedown', (ev) => {
          ev.preventDefault();
          const idx = parseInt(el.getAttribute('data-idx'));
          selectSearchResult(id, dropdown._results[idx]);
        });
      });
    } catch (err) {
      dropdown.innerHTML = `<div class="empty">검색 실패: ${escapeHtml(err.message)}</div>`;
    }
  }, 300);
}

// 검색칸 재포커스 시 직전 검색 결과 드롭다운을 다시 연다. 재검색 없이 DOM에 남은 내용만 복원.
function onSearchFocus(e) {
  // 포커스 시 기존 드롭다운 표시 (있으면)
  const id = e.target.getAttribute('data-search');
  const dropdown = document.querySelector(`[data-dropdown="${id}"]`);
  if (dropdown && dropdown.innerHTML.trim() && e.target.value.trim().length > 0) {
    dropdown.classList.add('show');
  }
}

// 검색칸 블러 시 드롭다운을 닫는다. 결과 항목의 mousedown 핸들러가 먼저 실행될 시간을
// 확보하려고 200ms 지연 후 닫는다(즉시 닫으면 클릭 선택이 무시됨).
function onSearchBlur(e) {
  // mousedown 으로 처리되도록 약간 지연
  const id = e.target.getAttribute('data-search');
  const dropdown = document.querySelector(`[data-dropdown="${id}"]`);
  setTimeout(() => {
    if (dropdown) dropdown.classList.remove('show');
  }, 200);
}

// 자동완성 결과 선택 처리. 선택한 종목의 이름·ticker·symbol을 holdings에 반영·저장하고
// 전체 재렌더한 뒤 refreshHolding()으로 곧바로 해당 종목 시세까지 받아온다.
async function selectSearchResult(holdingId, result) {
  const h = state.holdings.find(x => x.id === holdingId);
  if (!h) return;
  h.name = result.name;
  h.ticker = result.ticker;
  h.symbol = result.symbol || result.ticker;
  saveState();
  render();
  // 자동으로 시세 가져오기
  await refreshHolding(holdingId);
}

// 주식/ETF 시세 수집. 야후 차트 API(v8/finance/chart/{ticker})를 프록시 경유로 호출해
// meta.regularMarketPrice(현재가)를 읽는다. 야후는 CORS 차단이라 항상 프록시를 거친다.
// 6자리 숫자 티커는 코스피(.KS)를 자동으로 붙인다(코스닥 종목은 사용자가 .KQ로 고쳐야 함).
// 해외주식(isUSD 카테고리)은 h.priceUSD(USD)에, 나머지는 h.price(KRW)에 저장하고
// lastFetched 기록 후 { ok, price, currency }를 반환한다. 실패 시 토스트로 알린다.
async function fetchStockPrice(holdingId) {
  const h = state.holdings.find(x => x.id === holdingId);
  if (!h) return;
  let ticker = String(h.ticker || '').trim().toUpperCase();
  if (!ticker) { toast('⚠️ 종목코드를 입력하세요'); return; }
  // 한국 거래소: 6자리 숫자면 .KS 자동 추가 (코스닥은 .KQ로 변경 가능)
  if (/^\d{6}$/.test(ticker)) ticker = ticker + '.KS';
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1d`;
  try {
    const data = await fetchViaProxy(url);
    const result = data?.chart?.result?.[0];
    if (!result) throw new Error('데이터 없음');
    const price = result.meta?.regularMarketPrice;
    const currency = result.meta?.currency;
    if (!price) throw new Error('시세 없음');
    const cat = CATEGORY_MAP[h.category];
    if (cat?.isUSD) {
      h.priceUSD = String(price);
    } else {
      h.price = String(price);
    }
    h.lastFetched = new Date().toISOString();
    saveState();
    return { ok: true, price, currency };
  } catch (e) {
    toast('⚠️ ' + (h.ticker || h.name) + ' 시세 실패: ' + e.message);
    console.error('Stock fetch error for', ticker, e);
    return { ok: false };
  }
}

// 단일 종목 시세 갱신 진입점. 카테고리의 isCrypto/hasTicker 플래그에 따라
// fetchCryptoPrice/fetchStockPrice로 분기하고, 진행 중엔 해당 행 갱신 버튼에 스피너를 돌린다.
// 완료 후 전체 재렌더로 평가액·차트까지 반영한다.
async function refreshHolding(holdingId) {
  const h = state.holdings.find(x => x.id === holdingId);
  if (!h) return;
  const cat = CATEGORY_MAP[h.category];
  const btn = document.querySelector(`[data-refresh="${holdingId}"]`);
  if (btn) btn.classList.add('spinning');
  let result;
  if (cat?.isCrypto) {
    result = await fetchCryptoPrice(holdingId);
  } else if (cat?.hasTicker) {
    result = await fetchStockPrice(holdingId);
  }
  if (btn) btn.classList.remove('spinning');
  render();
  return result;
}

// ==================== 벤치마크 지수 (S&P500 · 나스닥) ====================
// 이력 차트에 시장 대비 성과 비교선을 그리기 위한 지수 종가 수집.
// 값은 CPI/M2 와 같은 방식으로 스냅샷(s.spx/s.ndx)에 저장되어 오프라인 렌더가 가능하다.

// 야후 v8 chart API 로 지수 일별 종가 시계열을 받는다 (fromDate ~ 오늘, CORS라 프록시 경유).
// 반환 { spx: {YYYY-MM-DD: 종가}, ndx: {...} } — ^GSPC=S&P500, ^IXIC=나스닥 종합.
// 주말·휴장일 보정을 위해 fromDate 앞 7일 여유를 두고 받는다.
async function fetchBenchmarkSeries(fromDate) {
  const p1 = Math.floor(new Date(fromDate + 'T00:00:00').getTime() / 1000) - 7 * 86400;
  const p2 = Math.floor(Date.now() / 1000) + 86400;
  const symbols = { spx: '^GSPC', ndx: '^IXIC' };
  const out = {};
  for (const [key, sym] of Object.entries(symbols)) {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?period1=${p1}&period2=${p2}&interval=1d`;
    const data = await fetchViaProxy(url);
    const res = data?.chart?.result?.[0];
    const ts = res?.timestamp || [];
    const closes = res?.indicators?.quote?.[0]?.close || [];
    const map = {};
    ts.forEach((t, i) => {
      const c = closes[i];
      if (c !== null && c !== undefined && isFinite(c)) map[localDateStr(new Date(t * 1000))] = c;
    });
    out[key] = map;
  }
  return out;
}

// 날짜→종가 맵에서 date 이하의 가장 가까운 종가를 찾는다 (주말·휴장일이면 직전 영업일 값).
// 범위 내 값이 없으면 null — "데이터 없음"으로 확정 저장되어 재조회 대상에서 빠진다.
function _closeOnOrBefore(map, date) {
  if (map[date] !== undefined) return map[date];
  const keys = Object.keys(map).filter(d => d <= date).sort();
  return keys.length ? map[keys[keys.length - 1]] : null;
}

// 스냅샷 이력에 벤치마크 종가(spx/ndx)를 채워 넣는다 — 값이 빠진(undefined) 스냅샷이
// 있을 때만 네트워크를 탄다. refreshAllPrices 완료 시 호출되어 새 스냅샷 기록과
// 과거 스냅샷 소급 보정(backfill)을 동시에 처리한다. 실패는 조용히 넘기고 다음
// 시세 갱신 때 자연히 재시도된다 (undefined 로 남아 있으므로).
async function applyBenchmarksToHistory() {
  const snaps = state.history || [];
  const missing = snaps.filter(s => s.spx === undefined || s.ndx === undefined);
  if (missing.length === 0) return;
  const firstDate = [...snaps].sort((a, b) => a.date.localeCompare(b.date))[0].date;
  try {
    const series = await fetchBenchmarkSeries(firstDate);
    snaps.forEach(s => {
      if (s.spx === undefined) s.spx = _closeOnOrBefore(series.spx, s.date);
      if (s.ndx === undefined) s.ndx = _closeOnOrBefore(series.ndx, s.date);
    });
    saveState();
  } catch (e) {
    console.warn('벤치마크 지수 수집 실패 (다음 시세 갱신 때 재시도):', e.message);
  }
}

// 미국 M2 통화공급량 조회. FRED observations API(series_id=M2SL, 단위 Billions $, 계절조정)를 쓴다.
// FRED는 브라우저 직접 호출을 CORS로 차단하므로 처음부터 프록시를 거친다.
// API 키는 브라우저가 모른다 — 요청에 api_key 를 붙이지 않으면 서버 프록시(/api/proxy)가 자기 키를
// 끼워 넣는다. (예전엔 localStorage 의 FRED_API_KEY 를 붙였는데, 거기 아무 값이나 남아 있으면 서버 주입이
// 꺼져 M2 수집이 통째로 실패하는 함정이라 2026-08-31 제거.)
// sort_order=desc&limit=13으로 최신 13개월치를 받아 최신값과 12개월 전 값으로 YoY를 함께 계산한다.
// 반환 { value: 십억 달러, date, label: "YYYY-MM", yoyPct: 전년 동월 대비 증가율(소수 비율) }.
// data-io.js의 snapshot()이 호출해 자산 이력에 M2를 같이 기록한다(실질가치 비교용).
async function fetchM2() {
  const url = 'https://api.stlouisfed.org/fred/series/observations?series_id=M2SL&file_type=json&sort_order=desc&limit=13';
  const data = await fetchViaProxy(url);
  if (!data.observations || !data.observations.length) throw new Error('M2 데이터 없음');
  const latest = data.observations[0];
  const value = parseFloat(latest.value);
  if (!isFinite(value)) throw new Error('M2 값 없음 (.)');
  // YoY: 12개월 전 (index 12) - sort_order=desc라 0이 최신, 12가 1년 전
  let yoyPct = null;
  if (data.observations.length >= 13) {
    const prev = parseFloat(data.observations[12].value);
    if (isFinite(prev) && prev > 0) {
      yoyPct = (value / prev) - 1;
    }
  }
  return {
    value,
    date: latest.date,  // YYYY-MM-DD (월말 기준)
    label: latest.date.slice(0, 7),  // YYYY-MM
    yoyPct,             // 전년 동월 대비 M2 증가율
  };
}

// 미국 CPI 지수 조회. BLS Public API v1(키 없이 일 25회 무료)로
// 시리즈 CUUR0000SA0(CPI-U 전 품목, 비계절조정, 1982-84=100)을 작년~올해 범위로 받는다.
// BLS는 CORS를 허용하는 경우가 있어 직접 호출을 먼저 시도하고 실패 시 프록시로 폴백한다.
// 최신 월 지수와 전년 동월 값으로 YoY(뉴스의 "미국 CPI n% 상승"과 동일 지표)를 계산해
// { index, year, period, periodName, label, yoyPct }를 반환한다. snapshot()이 이력 기록에 사용.
async function fetchUSCPI() {
  const year = new Date().getFullYear();
  const url = `https://api.bls.gov/publicAPI/v1/timeseries/data/CUUR0000SA0?startyear=${year - 1}&endyear=${year}`;
  let data;
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    data = await r.json();
  } catch (e) {
    // CORS 등 직접 호출 실패 시 프록시 폴백
    console.warn('BLS 직접 호출 실패, 프록시로:', e.message);
    data = await fetchViaProxy(url);
  }
  if (data.status !== 'REQUEST_SUCCEEDED') throw new Error('BLS: ' + data.status);
  const series = data.Results?.series?.[0];
  if (!series?.data?.length) throw new Error('CPI 데이터 없음');
  // 가장 최근 월 데이터
  const sorted = [...series.data].sort((a, b) =>
    (b.year + b.period).localeCompare(a.year + a.period));
  const latest = sorted[0];
  // YoY (전년 동월 대비): 같은 period(월) + year - 1 찾기
  // 뉴스에서 보는 "미국 CPI 3.5% 상승" 과 동일한 지표
  const prevYearSamePeriod = sorted.find(d =>
    d.period === latest.period && parseInt(d.year) === parseInt(latest.year) - 1);
  let yoyPct = null;
  if (prevYearSamePeriod) {
    const cur = parseFloat(latest.value);
    const prev = parseFloat(prevYearSamePeriod.value);
    if (isFinite(cur) && isFinite(prev) && prev > 0) {
      yoyPct = (cur / prev) - 1;
    }
  }
  return {
    index: parseFloat(latest.value),
    year: latest.year,
    period: latest.period,           // M01-M12
    periodName: latest.periodName,   // January-December
    label: `${latest.year}-${latest.period.slice(1)}`, // "2024-12"
    yoyPct,                          // 전년 동월 대비 (뉴스 인플레율)
  };
}

// 금 시세 갱신. 야후에서 COMEX 금 선물(GC=F, USD/트로이온스)을 프록시 경유로 받아
// 환율을 곱하고 31.1034768g(1 트로이온스)으로 나눠 KRW/g 단가로 환산한 뒤,
// '금' 카테고리 모든 행의 price에 일괄 적용·저장하고 전체 재렌더한다.
// 환율이 없거나 1시간 이상 묵었으면 fetchExchangeRate를 먼저 호출해 최신화한다.
// 국제 시세 환산값이라 KRX 국내 금시세와 약간의 괴리가 있을 수 있음 — 의도된 동작.
async function fetchAndApplyGoldPrice(btn) {
  const original = btn?.textContent;
  if (btn) { btn.disabled = true; btn.textContent = '⏳ 갱신 중...'; }
  try {
    // 환율 우선 갱신 (없거나 오래되었으면)
    const rateStale = !state.rateUpdatedAt
      || (Date.now() - new Date(state.rateUpdatedAt).getTime()) > 3600 * 1000;
    if (rateStale) await fetchExchangeRate(false);

    // GC=F: COMEX 금 선물 (USD/oz)
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/GC%3DF?interval=1d&range=1d`;
    const data = await fetchViaProxy(url);
    const usdPerOz = data?.chart?.result?.[0]?.meta?.regularMarketPrice;
    if (!usdPerOz) throw new Error('금 시세 없음');
    const rate = num(state.usdKrwRate || 0);
    if (!rate) throw new Error('환율 데이터 없음');
    // 1 troy oz = 31.1034768 g
    const krwPerGram = Math.round((usdPerOz * rate) / 31.1034768);

    // 모든 금 카테고리 행에 적용
    let count = 0;
    state.holdings.forEach(h => {
      if (h.category === '금') {
        h.price = String(krwPerGram);
        h.lastFetched = new Date().toISOString();
        count++;
      }
    });
    saveState();
    render();
    toast(`🥇 금 1g = ₩${krwPerGram.toLocaleString('ko-KR')} · ${count}개 행 적용 (국제 금시세 환산)`);
  } catch (e) {
    toast('⚠️ 금 시세 갱신 실패: ' + e.message);
    console.error('Gold fetch error:', e);
    if (btn) { btn.disabled = false; btn.textContent = original; }
  }
}

// 전체 시세 일괄 갱신 버튼 핸들러. 환율을 먼저 갱신해 평가액 환산 기준을 확보한 뒤,
// 티커가 있는 주식/코인 행을 순차로 갱신한다. 요청 간 250ms 간격은
// 야후·거래소 API의 rate limit 회피용(병렬로 쏘면 429가 잦음).
// 금 보유분이 있으면 금 시세도 이어서 갱신하고, 성공/실패 건수를 토스트로 요약 후 전체 재렌더.
async function refreshAllPrices() {
  const btn = document.getElementById('refreshAllBtn');
  btn.disabled = true;
  btn.textContent = '⏳ 갱신 중...';
  // 환율 먼저
  await fetchExchangeRate(false);
  // 시세 가능한 모든 행 (주식/암호화폐).
  // 증권사 동기화가 만든 예수금 행(source '<id>:cash')은 티커가 없는 금액 행이라 제외.
  const targets = state.holdings.filter(h => {
    const cat = CATEGORY_MAP[h.category];
    if (String(h.source || '').endsWith(':cash')) return false;
    return cat?.hasTicker && (h.ticker || h.name);
  });
  let ok = 0, fail = 0;
  for (const h of targets) {
    const cat = CATEGORY_MAP[h.category];
    let result;
    if (cat?.isCrypto) result = await fetchCryptoPrice(h.id);
    else result = await fetchStockPrice(h.id);
    if (result?.ok) ok++; else fail++;
    await new Promise(r => setTimeout(r, 250));
  }
  // 금 카테고리에 보유분이 있으면 같이 갱신
  const hasGold = state.holdings.some(h => h.category === '금' && (num(h.quantity) > 0 || h.name));
  if (hasGold) {
    try { await fetchAndApplyGoldPrice(null); ok++; }
    catch { fail++; }
  }
  btn.disabled = false;
  btn.textContent = '🔄 전체 시세 갱신';
  toast(`✓ ${ok}개 갱신${fail ? ` · ${fail}개 실패` : ''}`);
  render();
  // 방금 갱신된 최신 시세 기준으로 오늘 이력 스냅샷을 자동 기록하고(같은 날짜 덮어쓰기)
  // 디바운스 없이 즉시 서버에 저장한다 — 스냅샷은 시세가 갱신됐을 때만 의미가 있으므로
  // 이 완료 지점이 자동 이력 기록의 트리거다 (계획: 3차 개편).
  await snapshot(true);
  flushServerSave();
}

