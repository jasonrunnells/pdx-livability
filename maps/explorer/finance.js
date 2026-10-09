/* PDX Livability: monthly cost of a home (shared by the map and the Homes page).
   Settings are shared between both of you (Supabase table finance_settings, one row id = 1); defaults are below.

   How the monthly estimate is worked out:
     Loan            = price - down payment
     Loan payment    = the fixed monthly amount that pays the loan off over the loan length at the interest rate
                       (30-year rate, 15-year rate, or the jumbo rate when the loan is over the $832,750 limit)
     Property tax    = the county estimate (assessed value x local tax rate) / 12
     Home insurance  = rebuild cost (sq ft x rebuild $/sq ft) priced on NerdWallet's Oregon coverage table, x the city's
                       adjustment, / 12
     PMI             = loan x PMI rate / 12, only when the loan is over 80% of the price (rate from the PMI table below);
                       it can be removed once the loan is paid down to 80% of the price
     Monthly total   = loan payment + property tax + home insurance + PMI
*/
(function () {
  const DEFAULTS = {
    down: 130000,        // down payment ($)
    term: 30,            // loan length (years): 30 or 15
    rate30: 7.50,        // % (Mortgage News Daily, 30-year fixed, Oct 8 2026)
    rate15: 7.17,        // % (Mortgage News Daily, 15-year fixed, Oct 8 2026)
    rateJumbo: 7.65,     // % (Mortgage News Daily, 30-year jumbo, Oct 8 2026), used for loans over the limit below
    rebuild: 200,        // rebuild cost, $ per sq ft
    pmi85: 0.25,         // PMI % per year when the loan is 80-85% of the price (rate card 0.19%, rounded up)
    pmi90: 0.35,         // 85-90% (rate card 0.28%, rounded up)
    pmi95: 0.38,         // 90-95%
    pmi97: 0.58,         // 95-97%
  };
  const JUMBO_LIMIT = 832750;   // FHFA 2026 conforming loan limit
  // NerdWallet Oregon averages: dwelling coverage -> yearly price
  const INS = [[300000, 1395], [400000, 1705], [500000, 2065], [600000, 2435], [700000, 2800]];
  // City price vs. the Oregon average ($2,065); cities not listed use Portland's
  const CITY = { hillsboro: 0.86, beaverton: 0.88, 'lake oswego': 0.89, 'forest grove': 0.89, portland: 0.90, tualatin: 0.89,
    wilsonville: 0.91, 'west linn': 0.93, 'oregon city': 0.94, 'happy valley': 0.94, gresham: 0.96 };

  let S = { ...DEFAULTS }, sbRef = null, loaded = null;
  const subs = new Set();
  const cacheKey = 'pdx-finance';
  try { const c = JSON.parse(localStorage.getItem(cacheKey) || 'null'); if (c) S = { ...DEFAULTS, ...c }; } catch { /* no storage */ }
  const keep = () => { try { localStorage.setItem(cacheKey, JSON.stringify(S)); } catch { /* no storage */ } };
  const tell = () => subs.forEach((f) => { try { f(S); } catch { /* ignore */ } });

  function load(sb) {
    if (sb) sbRef = sb;
    return (loaded ||= (async () => {
      if (!sbRef) return S;
      try {
        const { data, error } = await sbRef.from('finance_settings').select('data').eq('id', 1).maybeSingle();
        if (!error && data && data.data) { S = { ...DEFAULTS, ...data.data }; keep(); tell(); }
      } catch { /* table not set up yet: use defaults */ }
      return S;
    })());
  }
  async function save(next) {
    S = { ...DEFAULTS, ...next }; keep(); tell();
    if (!sbRef) return { error: null };
    const { error } = await sbRef.from('finance_settings').upsert({ id: 1, data: S, updated_at: new Date().toISOString() });
    return { error };
  }
  const reset = () => save({ ...DEFAULTS });
  const reload = () => { loaded = null; return load(); };

  function insurance(sqft, city) {
    if (!(sqft > 0)) return 0;
    const cover = sqft * S.rebuild;
    let yr;
    if (cover <= INS[0][0]) yr = INS[0][1] - (INS[0][0] - cover) * (INS[1][1] - INS[0][1]) / 100000;
    else if (cover >= INS[INS.length - 1][0]) { const a = INS[INS.length - 2], b = INS[INS.length - 1]; yr = b[1] + (cover - b[0]) * (b[1] - a[1]) / (b[0] - a[0]); }
    else for (let i = 1; i < INS.length; i++) if (cover <= INS[i][0]) { const a = INS[i - 1], b = INS[i]; yr = a[1] + (cover - a[0]) * (b[1] - a[1]) / (b[0] - a[0]); break; }
    const f = CITY[String(city || '').trim().toLowerCase()] || CITY.portland;
    return { yr: Math.max(400, yr) * f, cover };
  }
  const pmiRate = (ltv) => (ltv <= 0.80 ? 0 : ltv <= 0.85 ? S.pmi85 : ltv <= 0.90 ? S.pmi90 : ltv <= 0.95 ? S.pmi95 : S.pmi97) / 100;

  // o: { price, taxYr, sqft, city }
  function calc(o) {
    const price = +o.price || 0; if (!(price > 0)) return null;
    const down = Math.min(price, Math.max(0, +S.down || 0)), loan = price - down, n = (+S.term === 15 ? 15 : 30) * 12;
    const jumbo = loan > JUMBO_LIMIT, ratePct = n === 180 ? S.rate15 : jumbo ? S.rateJumbo : S.rate30, r = ratePct / 100 / 12;
    const pay = loan <= 0 ? 0 : r ? loan * r / (1 - Math.pow(1 + r, -n)) : loan / n;
    const ltv = loan / price, pmiPct = pmiRate(ltv), pmi = loan * pmiPct / 12;
    // Walk the loan month by month: year-end balances (chart), year-1 split, and the month PMI can come off (80% of price)
    let bal = loan, pmiEnd = pmi > 0 ? null : 0, int1 = 0, prin1 = 0, yi = 0, yp = 0, even = null; const years = [loan], split = [];
    for (let m = 1; m <= n; m++) {
      const i = bal * r, p = Math.min(bal, pay - i); bal -= p; yi += i; yp += p;
      if (m <= 12) { int1 += i; prin1 += p; }
      if (pmiEnd == null && bal <= price * 0.80) pmiEnd = m;
      if (even == null && p >= i) even = Math.ceil(m / 12);
      if (m % 12 === 0) { years.push(Math.max(0, bal)); split.push([yi, yp]); yi = yp = 0; }
    }
    const ins = insurance(+o.sqft, o.city), tax = (+o.taxYr || 0) / 12, insMo = ins ? ins.yr / 12 : 0;
    return { price, down, loan, ltv, term: n / 12, ratePct, jumbo, pay, tax, ins: insMo, cover: ins ? ins.cover : 0, pmi, pmiPct, pmiEnd,
      int1, prin1, years, split, even, total: pay + tax + insMo + pmi, totalInterest: pay * n - loan, over97: ltv > 0.97 };
  }

  // Where each year's payments go: one bar per year, split into interest and paying down the loan
  function chartSVG(c) {
    if (!c || !(c.loan > 0) || !c.split.length) return '';
    const n = c.split.length, W = 320, H = 104, L = 2, R = 2, T = 6, B = 18, w = W - L - R, h = H - T - B;
    const gap = n > 20 ? 1.5 : 3, bw = (w - gap * (n - 1)) / n, top = Math.max(...c.split.map(([i, p]) => i + p));
    let bars = '';
    c.split.forEach(([i, p], k) => {
      const x = (L + k * (bw + gap)).toFixed(1), hi = (i / top) * h, hp = (p / top) * h;
      bars += `<g data-i="${k}"><rect class="fc-hit" x="${x}" y="${T}" width="${(bw + gap).toFixed(1)}" height="${h}"/><rect class="fc-int" x="${x}" y="${(T + h - hi).toFixed(1)}" width="${bw.toFixed(1)}" height="${hi.toFixed(1)}"/>`
        + `<rect class="fc-prin" x="${x}" y="${(T + h - hi - hp).toFixed(1)}" width="${bw.toFixed(1)}" height="${hp.toFixed(1)}"/></g>`;
    });
    const xc = (yr) => (L + (yr - 1) * (bw + gap) + bw / 2).toFixed(1);
    const mid = Math.round(n / 2);
    const data = c.split.map(([i, p]) => [Math.round(i), Math.round(p)]).join(';');
    return `<div class="fin-chart-wrap" data-split="${data}"><div class="fin-y1"><span class="fv-y">Year 1</span>: <b class="fv-i">$${Math.round(c.split[0][0]).toLocaleString()}</b> interest · <b class="fv-p">$${Math.round(c.split[0][1]).toLocaleString()}</b> toward the loan</div>
      <div class="fin-legend"><span><i class="fl-prin"></i>Toward the loan</span><span><i class="fl-int"></i>Interest</span></div>
      <svg class="fin-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Each year's payments split into interest and paying down the loan">${bars}
      <text class="fc-ax" x="${xc(1)}" y="${H - 4}" text-anchor="start">Year 1</text><text class="fc-ax" x="${xc(mid)}" y="${H - 4}" text-anchor="middle">Year ${mid}</text>
      <text class="fc-ax" x="${xc(n)}" y="${H - 4}" text-anchor="end">Year ${n}</text></svg>
</div>`;
  }

  // Hover (desktop) or slide a finger (phone) across the bars to read each year's split in the legend
  function wireChart(root) {
    const wrap = root && root.querySelector('.fin-chart-wrap'); if (!wrap || wrap.dataset.wired) return;
    wrap.dataset.wired = '1';
    const svg = wrap.querySelector('svg'), rows = wrap.dataset.split.split(';').map((r) => r.split(',').map(Number));
    const $ = (q) => wrap.querySelector(q), money = (v) => '$' + v.toLocaleString();
    let on = -1;
    const show = (k) => {
      if (k === on) return; on = k;
      svg.querySelectorAll('g[data-i]').forEach((g) => g.classList.toggle('dim', k >= 0 && +g.dataset.i !== k));
      const r = rows[Math.max(0, k)];
      $('.fv-y').textContent = 'Year ' + (Math.max(0, k) + 1);
      $('.fv-p').textContent = money(r[1]); $('.fv-i').textContent = money(r[0]);
    };
    const at = (e) => { const b = svg.getBoundingClientRect(); return Math.max(0, Math.min(rows.length - 1, Math.floor(((e.clientX - b.left) / b.width) * rows.length))); };
    svg.addEventListener('pointermove', (e) => show(at(e)));
    svg.addEventListener('pointerdown', (e) => show(at(e)));
    svg.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') show(-1); });
  }

  window.PDXFinance = { wireChart, DEFAULTS, JUMBO_LIMIT, load, reload, save, reset, calc, chartSVG, get: () => S, onChange: (f) => (subs.add(f), () => subs.delete(f)) };
})();
