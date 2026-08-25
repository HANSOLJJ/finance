// 외부 시세 수집 — 프록시 경유 야후/네이버/코인/환율/FRED/BLS + 검색 자동완성
// ==================== 외부 시세/환율 API ====================
// 여러 프록시를 순차 시도. allorigins는 /get (CORS 지원), 응답이 contents 필드에 wrap 되어 있어 별도 파싱
// JSON이 아닌 HTML 에러 페이지 거부 (Access Denied 등)
function _validateJSON(text) {
  const trimmed = text.trimStart();
  if (trimmed.startsWith('<') || /access denied|forbidden|<html/i.test(trimmed.substring(0, 200))) {
    throw new Error('Proxy returned HTML/error page');
  }
  return JSON.parse(text);
}

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

// 한글 포함 여부 검사
function hasKorean(s) { return /[가-힯ᄀ-ᇿ㄰-㆏]/.test(s); }

// 네이버 모바일 금융 자동완성 (한국주식 검색용 - 한글 지원 우수)
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

function onSearchFocus(e) {
  // 포커스 시 기존 드롭다운 표시 (있으면)
  const id = e.target.getAttribute('data-search');
  const dropdown = document.querySelector(`[data-dropdown="${id}"]`);
  if (dropdown && dropdown.innerHTML.trim() && e.target.value.trim().length > 0) {
    dropdown.classList.add('show');
  }
}

function onSearchBlur(e) {
  // mousedown 으로 처리되도록 약간 지연
  const id = e.target.getAttribute('data-search');
  const dropdown = document.querySelector(`[data-dropdown="${id}"]`);
  setTimeout(() => {
    if (dropdown) dropdown.classList.remove('show');
  }, 200);
}

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

// FRED API 키 (St. Louis Fed)
// 공개 배포용: 하드코딩 제거. 로컬에서만 아래 한 줄을 콘솔에 붙여넣어 설정:
//   localStorage.setItem('FRED_API_KEY', '여기에_본인_키')
const FRED_API_KEY = localStorage.getItem('FRED_API_KEY') || '';

// 미국 M2 통화공급 (FRED Series: M2SL, Billions $, SA)
// FRED는 브라우저 직접 호출 시 CORS 차단되므로 바로 프록시 사용
// limit=13으로 12개월 전 값까지 받아서 YoY 같이 계산
async function fetchM2() {
  const url = `https://api.stlouisfed.org/fred/series/observations?series_id=M2SL&api_key=${FRED_API_KEY}&file_type=json&sort_order=desc&limit=13`;
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

// 미국 CPI Index (BLS Public API). 키 없이 25 req/day 무료
// 시리즈: CUUR0000SA0 = CPI-U All Items, NSA, 1982-84=100
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

async function refreshAllPrices() {
  const btn = document.getElementById('refreshAllBtn');
  btn.disabled = true;
  btn.textContent = '⏳ 갱신 중...';
  // 환율 먼저
  await fetchExchangeRate(false);
  // 시세 가능한 모든 행 (주식/암호화폐)
  const targets = state.holdings.filter(h => {
    const cat = CATEGORY_MAP[h.category];
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
}

