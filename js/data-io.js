// 데이터 입출력 — JSON 백업/복원·스냅샷·과거 이력 보정·더미 데이터·리셋
// ==================== 액션 ====================
// ==================== 과거 이력 보정 (빠진 자산 소급 추가) ====================
// 모든 과거 스냅샷 + 현재 holdings에 동일 금액 적용
function openHistoricalAddModal() {
  const existing = document.getElementById('histAddBackdrop');
  if (existing) existing.remove();

  const snapCount = state.history.length;
  if (snapCount === 0) {
    alert('저장된 스냅샷이 없습니다. 먼저 이력 탭에서 스냅샷을 찍으세요.');
    return;
  }

  const backdrop = document.createElement('div');
  backdrop.id = 'histAddBackdrop';
  backdrop.className = 'memo-modal-backdrop';
  backdrop.innerHTML = `
    <div class="memo-modal" style="width:min(540px,94vw);">
      <div class="memo-modal-head">
        <div>
          <div class="memo-modal-title">📋 빠진 자산 소급 추가</div>
          <div class="memo-modal-sub">모든 과거 스냅샷 ${snapCount}개 + 현재 holdings에 동일 금액 적용</div>
        </div>
        <button class="memo-modal-x" id="histAddCloseBtn" title="닫기">×</button>
      </div>
      <div class="memo-modal-hint" style="border-left-color:#dc2626;background:#fef2f2;">
        ⚠️ 이 작업은 과거 스냅샷을 수정합니다. 적용 전에 설정 탭에서 "백업 다운로드"로 JSON 백업을 받아두세요. 롤백 안 됩니다.
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
        <label style="font-size:12px;">
          <div style="color:var(--text-muted);margin-bottom:4px;">카테고리</div>
          <select id="histAddCategory" class="inp" style="width:100%;border:1px solid var(--border);padding:6px 8px;">
            ${CATEGORIES.map(c => `<option value="${c.key}">${c.key}</option>`).join('')}
          </select>
        </label>
        <label style="font-size:12px;">
          <div style="color:var(--text-muted);margin-bottom:4px;">자산명</div>
          <input id="histAddName" class="inp" placeholder="예: 주택청약저축" style="border:1px solid var(--border);padding:6px 8px;width:100%;" />
        </label>
        <label style="font-size:12px;">
          <div style="color:var(--text-muted);margin-bottom:4px;">계좌/거래소 (선택)</div>
          <input id="histAddAccount" class="inp" placeholder="예: 우리은행" style="border:1px solid var(--border);padding:6px 8px;width:100%;" />
        </label>
        <label style="font-size:12px;">
          <div style="color:var(--text-muted);margin-bottom:4px;">금액 (KRW)</div>
          <input id="histAddAmount" class="inp right" placeholder="0" inputmode="numeric" style="border:1px solid var(--border);padding:6px 8px;width:100%;" />
        </label>
        <label style="font-size:12px;">
          <div style="color:var(--text-muted);margin-bottom:4px;">통화노출</div>
          <select id="histAddExposure" class="inp" style="width:100%;border:1px solid var(--border);padding:6px 8px;">
            ${EXPOSURES.map(e => `<option value="${e}">${e}</option>`).join('')}
          </select>
        </label>
        <label style="font-size:12px;">
          <div style="color:var(--text-muted);margin-bottom:4px;">유동성</div>
          <select id="histAddLiquidity" class="inp" style="width:100%;border:1px solid var(--border);padding:6px 8px;">
            <option value="liquid">💧 유동 (즉시 인출 가능)</option>
            <option value="locked">🔒 묶임 (제도/제약)</option>
          </select>
        </label>
      </div>
      <div class="memo-modal-hint" id="histAddPreview" style="border-left-color:#0e7490;background:#ecfeff;">
        금액을 입력하면 적용 결과 미리보기가 표시됩니다.
      </div>
      <div class="memo-modal-foot">
        <span class="memo-modal-help">카테고리 변경 시 통화노출/유동성 기본값 자동 설정</span>
        <div style="display:flex;gap:8px;">
          <button class="btn" id="histAddCancelBtn">취소</button>
          <button class="btn primary" id="histAddApplyBtn">적용 (${snapCount}개 스냅샷)</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);

  const catEl = document.getElementById('histAddCategory');
  const expEl = document.getElementById('histAddExposure');
  const liqEl = document.getElementById('histAddLiquidity');
  const amtEl = document.getElementById('histAddAmount');
  const nameEl = document.getElementById('histAddName');
  const accEl = document.getElementById('histAddAccount');
  const previewEl = document.getElementById('histAddPreview');

  // 카테고리 변경 시 노출/유동성 기본값 동기화
  const syncDefaults = () => {
    const cat = catEl.value;
    expEl.value = DEFAULT_EXPOSURE_BY_CAT[cat] || '원화';
    liqEl.value = DEFAULT_LIQUIDITY_BY_CAT[cat] || 'liquid';
  };
  catEl.addEventListener('change', syncDefaults);
  syncDefaults();
  // 사용자가 가장 많이 빠뜨릴 카테고리부터 기본 선택 (현금)
  catEl.value = '현금'; syncDefaults();

  // 금액 입력 시 미리보기
  const updatePreview = () => {
    const amt = num(amtEl.value);
    if (!amt || amt <= 0) {
      previewEl.textContent = '금액을 입력하면 적용 결과 미리보기가 표시됩니다.';
      return;
    }
    const sortedSnaps = [...state.history].sort((a, b) => a.date.localeCompare(b.date));
    const first = sortedSnaps[0];
    const last = sortedSnaps[sortedSnaps.length - 1];
    previewEl.innerHTML = `각 스냅샷에 <b>${fmtKRWshort(amt)}</b>씩 더합니다.<br/>
      • 첫 스냅샷(${first.date}): ${fmtKRWshort(first.total || 0)} → <b>${fmtKRWshort((first.total || 0) + amt)}</b><br/>
      • 마지막 스냅샷(${last.date}): ${fmtKRWshort(last.total || 0)} → <b>${fmtKRWshort((last.total || 0) + amt)}</b><br/>
      • 현재 자산 입력에도 같은 자산이 새로 추가됩니다.`;
  };
  amtEl.addEventListener('input', updatePreview);

  const close = () => backdrop.remove();
  // 입력 검증 → 최종 확인(confirm) → 소급 적용 실행
  const apply = () => {
    const data = {
      category: catEl.value,
      name: (nameEl.value || '').trim(),
      account: (accEl.value || '').trim(),
      amount: num(amtEl.value),
      exposure: expEl.value,
      liquidity: liqEl.value,
    };
    if (!data.name) { alert('자산명을 입력하세요.'); nameEl.focus(); return; }
    if (!data.amount || data.amount <= 0) { alert('금액을 입력하세요.'); amtEl.focus(); return; }
    const ok = confirm(`적용하시겠습니까?\n\n자산: ${data.name}\n금액: ${fmtKRW(data.amount)}\n대상 스냅샷: ${snapCount}개 (모두 동일 금액 가산)\n\n현재 holdings에도 같은 자산이 추가됩니다.\n적용 후 롤백 불가 — 백업 받아두셨나요?`);
    if (!ok) return;
    applyHistoricalAsset(data);
    close();
    toast(`📋 ${data.name} 소급 적용 완료 — ${snapCount}개 스냅샷 + 현재 holdings`);
  };

  document.getElementById('histAddCloseBtn').onclick = close;
  document.getElementById('histAddCancelBtn').onclick = close;
  document.getElementById('histAddApplyBtn').onclick = apply;
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  setTimeout(() => nameEl.focus(), 30);
}

// 실제 데이터 변경: holdings에 추가 + 모든 스냅샷에 동일 금액 가산
function applyHistoricalAsset(data) {
  const cat = CATEGORY_MAP[data.category];
  const assetType = (cat && cat.assetTypeFixed) || '주식';

  // 1. 현재 holdings에 추가 (amount-only로 처리: price=금액, quantity=1)
  // 카테고리가 amountOnly가 아니어도 단순화 위해 quantity=1, price=금액으로 저장
  // (퇴직연금/연금저축은 hasTicker인데 사용자 편의상 amount 입력으로 처리)
  const isAmountOnly = !!(cat && cat.amountOnly);
  state.holdings.push({
    id: uid(),
    category: data.category,
    name: data.name,
    account: data.account || '',
    ticker: '',
    symbol: '',
    quantity: '1',
    price: String(data.amount),
    priceUSD: '',
    avgPrice: '',
    avgPriceUSD: '',
    exposure: data.exposure,
    memo: '소급 추가',
    assetType,
    liquidity: data.liquidity,
    lastFetched: '',
  });

  // 2. 모든 스냅샷에 동일 금액 가산
  state.history.forEach(snap => {
    const amt = data.amount;
    snap.total = (snap.total || 0) + amt;
    if (snap.fxRate) snap.totalUSD = snap.total / snap.fxRate;
    if (data.exposure === '원화') {
      snap.krw = (snap.krw || 0) + amt;
    } else {
      snap.usd = (snap.usd || 0) + amt;
      snap.usdTotal = snap.usd;
    }
    if (snap.byCategory) {
      snap.byCategory[data.category] = (snap.byCategory[data.category] || 0) + amt;
    }
    if (snap.byAssetType) {
      snap.byAssetType[assetType] = (snap.byAssetType[assetType] || 0) + amt;
    }
    if (data.liquidity === 'liquid') {
      snap.liquid = (snap.liquid || 0) + amt;
      if (snap.fxRate) snap.liquidUSD = snap.liquid / snap.fxRate;
    } else {
      snap.locked = (snap.locked || 0) + amt;
      if (snap.fxRate) snap.lockedUSD = snap.locked / snap.fxRate;
    }
  });

  saveState();
  render();
}

// 현재 state 전체를 JSON 파일로 다운로드 (백업). 성공 시 lastBackupAt 기록
function exportJSON() {
  console.log('[Export] 시작');
  try {
    state.lastUpdated = localDateStr();
    const json = JSON.stringify(state, null, 2);
    const filename = `portfolio_${state.lastUpdated}.json`;
    console.log('[Export] JSON 크기:', json.length, 'bytes, 파일명:', filename);

    const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    console.log('[Export] Blob URL 생성:', url);

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    a.textContent = '다운로드';
    document.body.appendChild(a);
    console.log('[Export] <a> 추가 완료, 클릭 시도');

    a.click();
    console.log('[Export] a.click() 호출 완료');

    setTimeout(() => {
      try { document.body.removeChild(a); } catch (_) {}
      URL.revokeObjectURL(url);
      console.log('[Export] cleanup 완료');
    }, 1000);

    // 백업 시점 기록
    state.lastBackupAt = new Date().toISOString();
    saveState();
    renderSettings();

    toast(`💾 ${filename} 다운로드 시작 (Downloads 폴더 확인)`);
  } catch (err) {
    console.error('[Export] 에러:', err);
    alert('내보내기 실패: ' + err.message);
  }
}

// 파일 선택 input에서 백업 JSON을 읽어 복원 시작. input value 초기화는 같은 파일 재선택 허용용
function importJSON(e) {
  console.log('[Import] 호출됨, event:', e);
  const file = e && e.target && e.target.files && e.target.files[0];
  if (!file) {
    console.warn('[Import] 파일 없음');
    return;
  }
  console.log('[Import] 파일:', file.name, file.size, 'bytes');
  const reader = new FileReader();
  reader.onload = (ev) => applyImportedJSON(ev.target.result, file.name);
  reader.onerror = (err) => {
    console.error('[Import] FileReader 에러:', err);
    alert('파일 읽기 실패');
  };
  reader.readAsText(file, 'UTF-8');
  if (e.target) e.target.value = '';
}

// 백업 JSON 텍스트 검증(holdings·목표비중 필수) 후 state 교체. 구버전 형식은 migrateState로 흡수
function applyImportedJSON(text, fileName) {
  try {
    if (!text) throw new Error('파일이 비어있습니다');
    const data = JSON.parse(text);
    if (!data.holdings || !Array.isArray(data.holdings)) throw new Error('잘못된 형식: holdings 배열 없음');
    // assetTypeTargets 또는 (레거시) catTargets 중 하나는 있어야 함
    if (!data.assetTypeTargets && !data.catTargets) throw new Error('잘못된 형식: 목표 비중 없음');
    state = migrateState({ ...defaultState(), ...data });
    saveState();
    render();
    updateFxBadge();
    toast(`📂 ${fileName} 불러오기 완료 (${data.holdings.length}개 종목)`);
  } catch (err) {
    console.error('Import 실패:', err);
    alert('파일을 읽을 수 없습니다: ' + err.message);
  }
}

// 현재 자산 총계를 오늘 날짜 스냅샷으로 저장 (같은 날짜는 덮어씀)
// CPI·M2는 자동 수집하되, 실패해도 마지막 캐시값으로 대체하고 스냅샷 자체는 계속 진행
async function snapshot() {
  const date = localDateStr();
  const total = grandTotal();
  const krw = exposureTotal('원화');
  const usd = exposureTotal('달러(노출)');
  const fxRate = num(state.usdKrwRate) || 1380;
  const totalUSD = total / fxRate;

  // 미국 CPI + M2 자동 fetch (실패 시 마지막 캐시값 사용)
  // YoY (전년 동월 대비)도 같은 API 응답에서 함께 추출 → 사용자 이력 짧아도 작동
  let cpiIndex = null, cpiLabel = null, cpiYoYPct = null;
  let m2Value = null, m2Label = null, m2YoYPct = null;
  try {
    const cpi = await fetchUSCPI();
    cpiIndex = cpi.index;
    cpiLabel = cpi.label;
    cpiYoYPct = cpi.yoyPct;
    state.lastCPI = { index: cpiIndex, label: cpiLabel, yoyPct: cpiYoYPct, fetchedAt: new Date().toISOString() };
  } catch (e) {
    console.warn('CPI fetch 실패, 마지막 캐시 사용:', e.message);
    if (state.lastCPI) {
      cpiIndex = state.lastCPI.index;
      cpiLabel = state.lastCPI.label;
      cpiYoYPct = state.lastCPI.yoyPct ?? null;
    }
  }
  try {
    const m2 = await fetchM2();
    m2Value = m2.value;
    m2Label = m2.label;
    m2YoYPct = m2.yoyPct;
    state.lastM2 = { value: m2Value, label: m2Label, yoyPct: m2YoYPct, fetchedAt: new Date().toISOString() };
  } catch (e) {
    console.warn('M2 fetch 실패, 마지막 캐시 사용:', e.message);
    if (state.lastM2) {
      m2Value = state.lastM2.value;
      m2Label = state.lastM2.label;
      m2YoYPct = state.lastM2.yoyPct ?? null;
    }
  }

  // 같은 날짜가 있으면 덮어쓰기
  state.history = state.history.filter(h => h.date !== date);
  const liquidKRW = liquidityTotal('liquid');
  const lockedKRW = liquidityTotal('locked');
  state.history.push({
    id: uid(), date, total, totalUSD, fxRate,
    cpiIndex, cpiLabel, cpiYoYPct,
    m2: m2Value, m2Label, m2YoYPct,
    krw, usd, usdTotal: usd,
    liquid: liquidKRW, locked: lockedKRW,
    liquidUSD: fxRate ? liquidKRW / fxRate : null,
    lockedUSD: fxRate ? lockedKRW / fxRate : null,
    byAssetType: Object.fromEntries(ASSET_TYPES.map(t => [t, assetTypeTotal(t)])),
    byCategory: Object.fromEntries(CATEGORIES.map(c => [c.key, categoryTotal(c.key)]))
  });
  render();
  const cpiNote = cpiIndex ? ` · CPI ${cpiIndex.toFixed(2)}` : '';
  const m2Note = m2Value ? ` · M2 ${(m2Value/1000).toFixed(1)}T` : '';
  toast(`📸 ${date} ${fmtUSD(totalUSD)}${cpiNote}${m2Note}`);
}

// 데모용 더미 자산 holdings (한국인 개인투자자 기준 현실적 포트폴리오)
// 부동산 + 주식 + 코인 + 금 + 현금 골고루
function generateDummyHoldings() {
  const dummyHoldings = [
    // === 현금 (총 약 8천만 KRW + USD $5,000) ===
    { category: '현금', name: '신한 CMA', account: '신한은행', quantity: '1', price: '35000000',
      exposure: '원화', memo: '비상금', assetType: '현금' },
    { category: '현금', name: '토스뱅크 파킹', account: '토스뱅크', quantity: '1', price: '25000000',
      exposure: '원화', memo: '단기자금', assetType: '현금' },
    { category: '현금', name: 'KB Star통장 (USD)', account: 'KB국민은행', quantity: '1', price: '5000',
      exposure: '달러(노출)', memo: '해외 결제용', assetType: '현금' },

    // === 국내주식 (3종목) - 평단가 입력해서 P&L 보이게 ===
    { category: '국내주식', name: '삼성전자', ticker: '005930.KS', symbol: '005930',
      quantity: '40', price: '78500', avgPrice: '72000',
      exposure: '원화', memo: '코어', assetType: '주식' },
    { category: '국내주식', name: 'SK하이닉스', ticker: '000660.KS', symbol: '000660',
      quantity: '15', price: '195000', avgPrice: '145000',
      exposure: '원화', memo: 'AI 메모리', assetType: '주식' },
    { category: '국내주식', name: 'LG에너지솔루션', ticker: '373220.KS', symbol: '373220',
      quantity: '6', price: '385000', avgPrice: '420000',
      exposure: '원화', memo: '2차전지', assetType: '주식' },

    // === 해외주식 (4종목, USD 입력) ===
    { category: '해외주식', name: 'Apple Inc.', ticker: 'AAPL', symbol: 'AAPL',
      quantity: '20', priceUSD: '195.50', avgPriceUSD: '170.00',
      exposure: '달러(노출)', memo: '코어 빅테크', assetType: '주식' },
    { category: '해외주식', name: 'Microsoft', ticker: 'MSFT', symbol: 'MSFT',
      quantity: '10', priceUSD: '420.00', avgPriceUSD: '380.00',
      exposure: '달러(노출)', memo: 'AI 코파일럿', assetType: '주식' },
    { category: '해외주식', name: 'NVIDIA', ticker: 'NVDA', symbol: 'NVDA',
      quantity: '15', priceUSD: '880.00', avgPriceUSD: '450.00',
      exposure: '달러(노출)', memo: 'AI 인프라', assetType: '주식' },
    { category: '해외주식', name: 'Tesla', ticker: 'TSLA', symbol: 'TSLA',
      quantity: '8', priceUSD: '245.00', avgPriceUSD: '290.00',
      exposure: '달러(노출)', memo: '반등 기다림', assetType: '주식' },

    // === 암호화폐 (3종목) ===
    { category: '암호화폐', name: 'Bitcoin', ticker: 'bitcoin', symbol: 'BTC',
      quantity: '0.08', price: '95000000', avgPrice: '65000000',
      exposure: '달러(노출)', memo: '장기 보유', assetType: '암호화폐' },
    { category: '암호화폐', name: 'Ethereum', ticker: 'ethereum', symbol: 'ETH',
      quantity: '2.5', price: '4800000', avgPrice: '3200000',
      exposure: '달러(노출)', memo: 'L2 스테이킹', assetType: '암호화폐' },
    { category: '암호화폐', name: 'Solana', ticker: 'solana', symbol: 'SOL',
      quantity: '40', price: '280000', avgPrice: '180000',
      exposure: '달러(노출)', memo: '', assetType: '암호화폐' },

    // === 연금저축펀드 (2종목) ===
    { category: '연금저축펀드', name: 'TIGER 미국S&P500', ticker: '360750.KS', symbol: '360750',
      quantity: '120', price: '18500', avgPrice: '15800',
      exposure: '원화', memo: '연금 코어', assetType: '주식' },
    { category: '연금저축펀드', name: 'KODEX 200', ticker: '069500.KS', symbol: '069500',
      quantity: '80', price: '34800', avgPrice: '33500',
      exposure: '원화', memo: '국내 코어', assetType: '주식' },

    // === 퇴직연금 (2종목) ===
    { category: '퇴직연금', name: 'TIGER 미국나스닥100', ticker: '133690.KS', symbol: '133690',
      quantity: '40', price: '95000', avgPrice: '78000',
      exposure: '원화', memo: '회사DC', assetType: '주식' },
    { category: '퇴직연금', name: 'KODEX MSCI Korea TR', ticker: '278530.KS', symbol: '278530',
      quantity: '60', price: '15800', avgPrice: '15200',
      exposure: '원화', memo: '회사DC', assetType: '주식' },

    // === ISA (2종목) ===
    { category: 'ISA', name: 'KODEX 미국S&P500', ticker: '379780.KS', symbol: '379780',
      quantity: '90', price: '17500', avgPrice: '14200',
      exposure: '원화', memo: '비과세 한도', assetType: '주식' },
    { category: 'ISA', name: 'TIGER 미국배당다우존스', ticker: '458730.KS', symbol: '458730',
      quantity: '50', price: '11200', avgPrice: '10500',
      exposure: '원화', memo: '배당 ETF', assetType: '주식' },

    // === 금 (2종목) ===
    { category: '금', name: 'KRX 금현물', account: '한국투자증권', quantity: '30', price: '132000', avgPrice: '95000',
      exposure: '달러(노출)', memo: 'KRX 시장 거래', assetType: '금' },
    { category: '금', name: '골드바 보관', account: '집 금고', quantity: '20', price: '132000', avgPrice: '85000',
      exposure: '달러(노출)', memo: '실물 보관', assetType: '금' },

    // === 부동산 (1건, 큰 비중) ===
    { category: '부동산', name: '잠실엘스 84A', quantity: '1', price: '1900000000',
      exposure: '원화', memo: '실거주', assetType: '부동산' },
  ];

  // id, ticker(없으면 빈), 기타 기본 필드 채워서 holdings 형식 맞추기
  state.holdings = dummyHoldings.map(h => ({
    id: uid(),
    category: h.category,
    name: h.name || '',
    account: h.account || '',
    ticker: h.ticker || '',
    symbol: h.symbol || '',
    quantity: h.quantity || '',
    price: h.price || '',
    priceUSD: h.priceUSD || '',
    avgPrice: h.avgPrice || '',
    avgPriceUSD: h.avgPriceUSD || '',
    exposure: h.exposure,
    memo: h.memo || '',
    assetType: h.assetType,
    lastFetched: '',
  }));

  // 자산타입 목표 비중도 데모용으로 설정 (부동산이 큰 비중인 자산가 타입)
  state.assetTypeTargets = {
    '현금': 0.05, '주식': 0.20, '채권': 0.00, '금': 0.05,
    '원자재': 0.00, '부동산': 0.60, '암호화폐': 0.10,
  };
  state.expTargets = { '원화': 0.65, '달러(노출)': 0.35 };
}

// 테스트용 더미 12개월 이력 생성 (자산 holdings도 함께 채움)
function generateDummyHistory() {
  const hasData = state.history.length > 0
    || state.holdings.some(h => num(h.price) > 0 || num(h.priceUSD) > 0);
  if (hasData) {
    if (!confirm('기존 자산내역과 이력이 있습니다.\n모두 지우고 데모용 더미 데이터(자산 + 12개월 이력)로 교체할까요?')) return;
  }
  // 1) 더미 holdings 먼저 채우기
  generateDummyHoldings();
  // 2) 그 다음 12개월 이력 생성
  state.history = [];

  const now = new Date();
  const baseUSD = 50000;
  const baseCPI = 305.0;
  const baseM2 = 21000;  // 21조 달러 (대략 최근 M2 수준, billions)
  const numMonths = 14;  // 14개월 → 최근 2~3개월은 YoY 비교 가능
  // 시나리오: 자산 월평균 +0.8% 성장(연 ~10%) + 약간의 변동
  // 인플레이션 월 +0.28% (연 약 3.4%)
  // 환율 1300 ~ 1500 사이 변동

  for (let i = numMonths - 1; i >= 0; i--) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 15);
    const dateStr = localDateStr(date);
    const monthsElapsed = numMonths - 1 - i;

    // 자산 USD 성장 (약간 랜덤)
    const baseGrowth = Math.pow(1.008, monthsElapsed);
    const noise = 1 + (Math.random() - 0.5) * 0.06;
    const totalUSD = baseUSD * baseGrowth * noise;

    // 환율: 사인 웨이브 + 약간 랜덤
    const fxRate = 1380 + Math.sin(monthsElapsed / 12 * Math.PI * 2) * 80 + (Math.random() - 0.5) * 30;
    const total = totalUSD * fxRate;

    // CPI: 안정적으로 매월 0.28% 상승
    const cpiIndex = baseCPI * Math.pow(1.0028, monthsElapsed);
    const cpiLabel = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    // M2: 매월 약 0.4% 증가 (연 ~5%)
    const m2Value = baseM2 * Math.pow(1.004, monthsElapsed);
    const m2Label = cpiLabel;

    // 자산타입 비중 (약간 변동, 합 = 1.0)
    const cashShare = 0.05 + (Math.random() - 0.5) * 0.01;
    const stockShare = 0.30 + (Math.random() - 0.5) * 0.05;
    const goldShare = 0.05 + (Math.random() - 0.5) * 0.01;
    const commodityShare = 0.05;
    const realestateShare = 0.45 + (Math.random() - 0.5) * 0.04;
    const cryptoShare = 1 - cashShare - stockShare - goldShare - commodityShare - realestateShare;

    const byAssetType = {
      '현금': total * cashShare,
      '주식': total * stockShare,
      '금': total * goldShare,
      '원자재': total * commodityShare,
      '부동산': total * realestateShare,
      '암호화폐': total * cryptoShare,
    };

    // 통화노출 비중
    const krwShare = 0.55;
    const usdShare = 0.45;

    state.history.push({
      id: uid(), date: dateStr, total, totalUSD, fxRate,
      cpiIndex, cpiLabel,
      m2: m2Value, m2Label,
      krw: total * krwShare,
      usd: total * usdShare,
      usdTotal: total * usdShare,
      byAssetType,
      byCategory: {},
      isDummy: true,
    });
  }

  saveState();
  render();
  toast(`🧪 데모 데이터 생성됨 · 자산 ${state.holdings.length}종목 + ${numMonths}개월 이력 (자산 +${((Math.pow(1.008, numMonths-1)-1)*100).toFixed(1)}% / CPI +${((Math.pow(1.0028, numMonths-1)-1)*100).toFixed(1)}%)`);
}

// 확인 후 모든 데이터(자산·이력·설정)를 기본값으로 초기화
function resetAll() {
  if (!confirm('정말 모든 데이터를 초기화하시겠습니까?\n저장된 이력과 입력값이 모두 사라집니다.')) return;
  state = defaultState();
  saveState();
  render();
  toast('🔄 초기화 완료');
}

// 하단 토스트 메시지를 2.2초간 표시
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2200);
}

