(() => {
'use strict';
const $ = (s) => document.querySelector(s);
const sb = supabase.createClient('https://qstztxydqhuahgivpztx.supabase.co', 'sb_publishable_5MfonGtWBM7R3rgYtEDdkg_TnUOeWJx');
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const truncate = (s, max) => { if (s.length <= max) return s; const cut = s.slice(0, max), sp = cut.lastIndexOf(' '); return (sp > 0 ? cut.slice(0, sp) : cut).trim() + '…'; };
const usd = (v) => (v == null ? '–' : '$' + Math.round(v).toLocaleString());
const DATA = 'maps/explorer/data/';
const ICON = {
  home: '<path d="M4.75 10.4 12 4.5l7.25 5.9V18.5a1 1 0 0 1-1 1H5.75a1 1 0 0 1-1-1z"/>',
  observation: '<path d="M2.75 12S6 6 12 6s9.25 6 9.25 6S18 18 12 18s-9.25-6-9.25-6Z"/><circle cx="12" cy="12" r="2.75"/>',
  explore: '<circle cx="12" cy="12" r="8"/><path d="m15.2 8.8-1.9 4.5-4.5 1.9 1.9-4.5z"/>',
  check: '<path d="m5.5 12.5 4 4 9-9"/>',
  flag: '<path d="M5.5 20.5v-16M5.5 4.75h11.25l-2.5 4 2.5 4H5.5"/>',
  cross: '<path d="M7 7l10 10M17 7 7 17"/>',
  info: '<circle cx="12" cy="12" r="8.25"/><path d="M12 11v5M12 8v.01"/>',
};
const ic = (k) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${ICON[k]}</svg>`;
const KIND = {
  observation: { label: 'Observation', color: 'var(--hood)' },
  explore: { label: 'Explore', color: '#E07A10' },
  home: { label: 'Home', color: 'var(--teal)' },
};
const gate = $('#gate'), authed = $('#authed');
let user = null;

const photoSrc = (u) => (/^https?:\/\//i.test(u) ? u : 'maps/explorer/' + u);
const dateStr = (d) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

/* ---------- Cards ---------- */
function updateCard(r) {
  const k = KIND[r.kind] || { label: r.kind, color: 'var(--ink-soft)' };
  const t = r.kind === 'home' ? (r.address || 'Home') : (r.title || truncate(r.note || '', 60) || k.label);
  const who = [r.created_by_name, dateStr(r.created_at)].filter(Boolean).join(' · ');
  const photo = (r.photos || [])[0];
  return `<a class="card" style="--dot:${k.color}" href="maps/explorer/index.html?pin=${r.id}">
    <div class="imgwrap">${photo ? `<img loading="lazy" alt="" src="${esc(photoSrc(photo))}">` : `<div class="ph">${ic(ICON[r.kind] ? r.kind : 'explore')}</div>`}
      <span class="chip"><i></i>${k.label}</span>${r.kind === 'home' && r.priority ? `<span class="prio">${ic('flag')}Priority</span>` : ''}</div>
    <div class="body"><div class="t">${esc(t)}</div><div class="w">${esc(who)}</div></div>
  </a>`;
}
function homeCard(r) {
  const specs = [r.beds != null ? `${r.beds} bd` : null, r.baths != null ? `${r.baths} ba` : null, r.sqft ? `${r.sqft.toLocaleString()} sq ft` : null].filter(Boolean).join(' · ');
  const photo = (r.photos || [])[0];
  return `<a class="card home-card" style="--dot:${KIND.home.color}" href="maps/explorer/index.html?pin=${r.id}">
    <div class="imgwrap">${photo ? `<img loading="lazy" alt="" src="${esc(photoSrc(photo))}">` : `<div class="ph">${ic('home')}</div>`}
      ${r.visited ? `<span class="visited">${ic('check')}Visited</span>` : ''}${r.priority ? `<span class="prio">${ic('flag')}Priority</span>` : ''}
      ${specs ? `<div class="specbar">${specs}</div>` : ''}</div>
    <div class="body"><div class="price">${r.price ? usd(r.price) : 'No price'}</div><div class="addr">${esc(r.address || '')}</div></div>
  </a>`;
}
function render(rows) {
  const h = rows.filter((r) => r.kind === 'home');
  $('#updatesGrid').innerHTML = rows.length ? rows.slice(0, 12).map(updateCard).join('') : '<p class="empty">Nothing logged yet.</p>';
  requestAnimationFrame(() => navUpdaters.forEach((u) => u()));
  renderStats(h);
}

/* ---------- Home card panel: the map's own home card, embedded (same as on the Homes page) ---------- */
let cardY = 0;
function openCard(id) {
  const panel = $('#cardPanel'), scrim = $('#cardScrim');
  $('#cardFrame').src = `maps/explorer/index.html?pin=${encodeURIComponent(id)}&embed=1${matchMedia('(min-width: 800px)').matches ? '&wide=1' : ''}`;
  if (panel.hidden) { panel.hidden = false; scrim.hidden = false; cardY = scrollY; Object.assign(document.body.style, { position: 'fixed', top: -cardY + 'px', left: '0', right: '0' }); }
}
function closeCard() {
  const panel = $('#cardPanel'); if (!panel || panel.hidden) return;
  panel.hidden = true; $('#cardScrim').hidden = true; $('#cardFrame').src = 'about:blank';
  Object.assign(document.body.style, { position: '', top: '', left: '', right: '' }); scrollTo(0, cardY);
}
document.addEventListener('click', (e) => { if (e.target.id === 'cardScrim') closeCard(); });
addEventListener('keydown', (e) => { if (e.key === 'Escape') closeCard(); });
addEventListener('message', (e) => { if (e.origin === location.origin && e.data?.type === 'pdx-close-card') closeCard(); });

/* ---------- Home stats: quick numbers about the saved homes ---------- */
/* Price bands: homes grouped into even price ranges, one bar per range. Tap (or click) a band to list its homes;
   each listed home opens on the map. Stays readable with any number of homes. */
const kUsd = (v) => (v >= 1e6 ? '$' + String(+(v / 1e6).toFixed(2)) + 'M' : '$' + Math.round(v / 1000) + 'k');
const placeOf = new Map();   // home id -> { hood, hoodId, city }, looked up once from the map's boundary files
const openBand = {};   // which band is open in each chart (kept when the page re-renders)
// One bar chart card: a row per group (label, bar, count). Tap a row to list its homes (up to 4, then scrolls);
// tap a home for a peek card. Used by "Price bands" and "Ratings".
function bandChart(el, id, title, headRight, groups) {
  const max = Math.max(1, ...groups.map((g) => g.homes.length));
  el.hidden = false;
  el.innerHTML = `<div class="spread-head"><span>${title}</span><small>${headRight}</small></div>
    <div class="bands">${groups.map((g, k) => (!g.homes.length ? '' : `
      <button type="button" class="band${openBand[id] === g.key ? ' open' : ''}${g.cls ? ' ' + g.cls : ''}" data-k="${k}" aria-expanded="${openBand[id] === g.key}">
        <span class="band-lbl">${g.label}</span>
        <span class="band-bar"><i style="width:${Math.max(6, (g.homes.length / max) * 100)}%"></i></span>
        <span class="band-n">${g.homes.length}</span>
      </button>
      <div class="band-list" ${openBand[id] === g.key ? '' : 'hidden'}>${g.homes.map((r) => `
        <button type="button" class="band-home" data-id="${esc(r.id)}" aria-expanded="false"><b>${r.price ? usd(r.price) : 'No price'}</b><span>${esc(r.address || 'Home')}</span><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="m9.5 6 6 6-6 6"/></svg></button>
        <div class="peek" hidden></div>`).join('')}
      </div>`)).join('')}</div>`;
  el.querySelectorAll('.band').forEach((btn) => btn.addEventListener('click', () => {
    const g = groups[+btn.dataset.k], willOpen = openBand[id] !== g.key;
    openBand[id] = willOpen ? g.key : null;
    el.querySelectorAll('.band').forEach((x) => { const on = willOpen && x === btn; x.classList.toggle('open', on); x.setAttribute('aria-expanded', on); x.nextElementSibling.hidden = !on; });
  }));
  el.querySelectorAll('.band-home').forEach((btn) => btn.addEventListener('click', () => openCard(btn.dataset.id)));
}
// Price bands: even price ranges ("nice" size giving about 4–7 bands); empty ranges are left out
function renderSpread(homes, avg) {
  const el = $('#spread'), list = homes.filter((r) => +r.price > 0).sort((a, b) => a.price - b.price);
  if (list.length < 2) { el.hidden = true; return; }
  const lo = list[0].price, hi = list.at(-1).price;
  const raw = Math.max(1, (hi - lo) / 6), steps = [25e3, 50e3, 100e3, 150e3, 200e3, 250e3, 500e3, 1e6];
  const step = steps.find((x) => x >= raw) || 1e6, start = Math.floor(lo / step) * step;
  const n = Math.max(1, Math.floor((hi - start) / step) + 1);
  const groups = Array.from({ length: n }, (_, k) => ({ key: start + k * step, label: `${kUsd(start + k * step)}–${kUsd(start + (k + 1) * step)}`, homes: [] }));
  for (const r of list) groups[Math.min(n - 1, Math.floor((r.price - start) / step))].homes.push(r);
  const mid = list.length % 2 ? list[(list.length - 1) / 2].price : (list[list.length / 2 - 1].price + list[list.length / 2].price) / 2;
  bandChart(el, 'price', 'Price bands', `Avg <b>${kUsd(avg)}</b> · Median <b>${kUsd(mid)}</b>`, groups);
}
// Ratings: one row per star level, best first (half stars count with the whole star below, e.g. 4.5 → 4★ row
// labeled "4–4.5"), then homes not rated yet
const STARS_ROW = (n) => `<span class="band-stars" aria-label="${n} stars">${'<svg viewBox="0 0 24 24"><path d="M12 3.4l2.55 5.3 5.85.8-4.25 4.05 1.05 5.8L12 16.6l-5.2 2.75 1.05-5.8L3.6 9.5l5.85-.8z"/></svg>'.repeat(n)}</span>`;
function renderRatings(homes) {
  const el = $('#ratings');
  if (!homes.length) { el.hidden = true; return; }
  const rated = homes.filter((r) => +r.rating > 0), groups = [];
  for (let st = 5; st >= 1; st--) {
    const h = rated.filter((r) => Math.min(5, Math.max(1, Math.floor(+r.rating))) === st).sort((a, b) => b.rating - a.rating || (a.price || 0) - (b.price || 0));
    groups.push({ key: st, label: STARS_ROW(st), homes: h });
  }
  // ratings below 1 (half a star) join the 1★ row
  rated.filter((r) => +r.rating < 1).forEach((r) => groups[4].homes.push(r));
  groups.push({ key: 'none', label: '<span class="band-none">Not rated</span>', homes: homes.filter((r) => !(+r.rating > 0)), cls: 'unrated' });
  const avg = rated.length ? rated.reduce((a, r) => a + +r.rating, 0) / rated.length : null;
  bandChart(el, 'rating', 'Ratings', avg ? `Avg <b>${avg.toFixed(1)}</b> ★ · <b>${rated.length}</b> rated` : 'No ratings yet', groups);
}
const STAR_SM = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.4l2.55 5.3 5.85.8-4.25 4.05 1.05 5.8L12 16.6l-5.2 2.75 1.05-5.8L3.6 9.5l5.85-.8z"/></svg>';
function peekHTML(r) {
  const photo = (r.photos || [])[0], place = placeOf.get(r.id) || {};
  const facts = [r.beds != null ? `<span><b>${esc(r.beds)}</b> bd</span>` : '', r.baths != null ? `<span><b>${esc(r.baths)}</b> ba</span>` : '',
                 r.sqft ? `<span><b>${(+r.sqft).toLocaleString()}</b> sq ft</span>` : ''].join('');
  const rating = +r.rating > 0 ? `<span class="peek-rating">${STAR_SM}${(+r.rating).toFixed(1)}</span>` : '';
  return `<div class="peek-card">
    <div class="peek-img">${photo ? `<img loading="lazy" alt="" src="${esc(photoSrc(photo))}">` : ic('home')}${r.visited ? `<span class="peek-visited">${ic('check')}</span>` : ''}${r.priority ? `<span class="peek-prio">${ic('flag')}</span>` : ''}</div>
    <div class="peek-body">
      <div class="peek-top">${facts ? `<div class="peek-facts">${facts}</div>` : ''}${rating}</div>
      <div class="peek-sub">${[place.hood ? `<span class="nb-hood">${esc(place.hood)}</span>` : '', place.city ? `<span class="nb-city">${esc(place.city)}</span>` : ''].filter(Boolean).join(' · ')}</div>
      <div class="peek-schools"><span class="muted">Checking schools…</span></div>
      <a class="btn primary peek-map" href="maps/explorer/index.html?pin=${r.id}">Open on map</a>
    </div>
  </div>`;
}
async function renderStats(homes) {
  const el = $('#stats');
  if (!homes.length) { el.innerHTML = '<p class="empty">Stats show up once you’ve saved a few homes.</p>'; return; }
  const priced = homes.map((r) => +r.price).filter((v) => v > 0);
  const avg = priced.length ? priced.reduce((a, b) => a + b, 0) / priced.length : null;
  const visited = homes.filter((r) => r.visited).length;
  const rated = homes.map((r) => +r.rating).filter((v) => v > 0);
  const avgRating = rated.length ? rated.reduce((a, b) => a + b, 0) / rated.length : null;
  const STAR = '<svg class="star" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.4l2.55 5.3 5.85.8-4.25 4.05 1.05 5.8L12 16.6l-5.2 2.75 1.05-5.8L3.6 9.5l5.85-.8z"/></svg>';
  const tile = (label, value, sub, cls = '', href = '') => {
    const inner = `<span>${label}</span><b>${value}</b>${sub ? `<small>${sub}</small>` : ''}`;
    return href ? `<a class="stat link-tile ${cls}" href="${href}">${inner}<svg class="ic go" viewBox="0 0 24 24" aria-hidden="true"><path d="m9.5 6 6 6-6 6"/></svg></a>` : `<div class="stat ${cls}">${inner}</div>`;
  };
  const mapLink = (layer, val) => `maps/explorer/index.html?show=${layer}&id=${encodeURIComponent(val)}`;
  const draw = (hood, city) => {
    el.innerHTML = tile('Homes saved', homes.length, `${visited} visited`)
      + tile('Average price', avg ? usd(avg) : '–', priced.length > 1 ? `${usd(Math.min(...priced))} – ${usd(Math.max(...priced))}` : '')
      + tile('Most-saved neighborhood', hood ? esc(hood[0]) : '…', hood ? `${hood[1]} of ${homes.length} homes` : '', 'name hood', hood?.[2] ? mapLink('hoods', hood[2]) : '')
      + tile('Most-saved city', city ? esc(city[0]) : '…', city ? `${city[1]} of ${homes.length} homes` : '', 'name city', city?.[0] && city[0] !== '–' ? mapLink('cities', city[0]) : '');
  };
  draw(null, null);
  renderSpread(homes, avg);
  renderRatings(homes);
  const [hoods, cities] = await Promise.all([getJSON(DATA + 'neighborhoods.geojson').catch(() => null), getJSON(DATA + 'cities.geojson').catch(() => null)]);
  for (const r of homes) if (!placeOf.has(r.id) && r.lat != null) {
    const h = hoods && featureAt(hoods, r.lng, r.lat);
    placeOf.set(r.id, { hood: h?.Name, hoodId: h?.RegionID, city: cities && featureAt(cities, r.lng, r.lat)?.NAME });
  }
  const top = (key) => {
    const n = {}; for (const r of homes) { const v = placeOf.get(r.id)?.[key]; if (v) n[v] = (n[v] || 0) + 1; }
    const best = Object.entries(n).sort((a, b) => b[1] - a[1])[0]; if (!best) return ['–', 0];
    const any = homes.map((r) => placeOf.get(r.id)).find((x) => x?.[key] === best[0]);
    return key === 'hood' ? [...best, any?.hoodId] : best;
  };
  draw(top('hood'), top('city'));
}

/* ---------- Data + sign in ---------- */
let allRows = [];
async function loadData() {
  gate.hidden = true; authed.hidden = false;
  const name = user?.user_metadata?.name || user?.email || '';
  $('#avatar').textContent = name.trim().charAt(0).toUpperCase(); $('#avatar').title = name; $('#who').hidden = false;
  const { data, error } = await sb.from('places').select('*').order('created_at', { ascending: false }).limit(80);
  if (error) { $('#updatesGrid').innerHTML = `<p class="empty">Couldn't load: ${esc(error.message)}</p>`; return; }
  allRows = data; render(allRows);
  sb.channel('home-feed').on('postgres_changes', { event: '*', schema: 'public', table: 'places' }, (p) => {
    if (p.eventType === 'DELETE') allRows = allRows.filter((r) => r.id !== p.old.id);
    else allRows = [p.new, ...allRows.filter((r) => r.id !== p.new.id)];
    render(allRows);
  }).subscribe();
}
async function ensureName() {
  if (user.user_metadata?.name) return;
  const n = (prompt('Your first name (shown on what you add)') || '').trim();
  if (n) { await sb.auth.updateUser({ data: { name: n } }); user = (await sb.auth.getUser()).data.user; }
}
let authChecked = false;   // the sign-in box only appears once we know you're signed out (no flash on load)
sb.auth.getSession().then(async ({ data: { session } }) => {
  authChecked = true;
  if (!session) { gate.hidden = false; return; }
  user = session.user; await ensureName(); loadData();
  if (QS.has('add')) openSheet();   // opened from the Homes page "Add a home" button
});
$('#signin').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const f = ev.target, err = $('#signinErr'); err.textContent = '';
  const { data, error } = await sb.auth.signInWithPassword({ email: f.email.value, password: f.password.value });
  if (error) { err.textContent = error.message; return; }
  user = data.user; await ensureName(); loadData();
});
$('#signOut').onclick = async () => { await sb.auth.signOut(); location.reload(); };

/* ---------- Grade badges (same look and centering as the map) ---------- */
const badge = (g) => { const L = String(g || '').trim().toUpperCase()[0]; return L ? `<span class="grade g-${esc(L).toLowerCase()}"><i>${esc(L)}</i></span>` : '<span class="grade none"><i>–</i></span>'; };
(function gradeNudge() {
  try {
    const ctx = document.createElement('canvas').getContext('2d');
    ctx.font = `700 13px ${getComputedStyle(document.body).fontFamily}`;
    const m = ctx.measureText('B'), fa = m.fontBoundingBoxAscent, fd = m.fontBoundingBoxDescent, cap = m.actualBoundingBoxAscent;
    if (!(fa > 0 && fd >= 0 && cap > 0)) return;
    const H = 22, base = (H - (fa + fd)) / 2 + fa;
    document.documentElement.style.setProperty('--grade-dy', (H / 2 - (base - cap / 2)).toFixed(2) + 'px');
  } catch { /* default */ }
})();

/* ---------- Geometry + data helpers ---------- */
const jsonCache = {};
const getJSON = (f) => (jsonCache[f] ||= fetch(f).then((r) => { if (!r.ok) throw new Error(`${f}: HTTP ${r.status}`); return r.json(); }));
function inRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const polysOf = (g) => (!g ? [] : g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []);
const inFeature = (f, x, y) => polysOf(f.geometry).some((p) => inRing(x, y, p[0]) && !p.slice(1).some((h) => inRing(x, y, h)));
function featureAt(fc, x, y) {
  for (const f of fc.features) {
    if (!f.geometry) continue;
    const b = f._bb ||= (() => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const p of polysOf(f.geometry)) for (const [px, py] of p[0]) { if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py; } return [x0, y0, x1, y1]; })();
    if (x < b[0] || x > b[2] || y < b[1] || y > b[3]) continue;
    if (inFeature(f, x, y)) return f.properties;
  }
  return null;
}

/* ---------- Attendance-area check ----------
   A home qualifies when its attendance area's grade is C or better AND its assigned high school's grade is B or better. */
const RANK = { A: 0, B: 1, C: 2, D: 3, F: 4 };
const atLeast = (g, min) => { const L = String(g || '').trim().toUpperCase()[0]; return L in RANK && RANK[L] <= RANK[min]; };
// Match an attendance area's school name to the schools layer. Names differ between the two files
// ("Lake Oswego Senior High School" vs "Lake Oswego High", "Tobias Elementary School" vs "L C Tobias Elementary"),
// so compare the core name only, search the right level first (public schools), then the same district.
const SCH_DROP = new Set(['school', 'sch', 'senior', 'jr', 'k', '8', 'elementary', 'middle', 'high', 'es', 'ms', 'hs']);
const schCore = (v) => String(v || '').split('/')[0].toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9 ]/g, ' ')
  .split(/\s+/).filter((w) => w && !SCH_DROP.has(w)).map((w) => (w === 'street' ? 'st' : w)).join(' ');
const distKey = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').trim().split(/\s+/)[0] || '';
function findSchool(all, name, type, district) {
  const n = schCore(name); if (!n || !all) return null;
  const ok = (m) => m === n || m.startsWith(n + ' ') || n.startsWith(m + ' ') || m.endsWith(' ' + n) || (' ' + m + ' ').includes(' ' + n + ' ');
  const rank = (list) => { const h = list.filter((x) => ok(schCore(x.Label_Name))); return h.find((x) => schCore(x.Label_Name) === n) || h.find((x) => distKey(x.DISTRICT) === district) || h[0] || null; };
  const pub = all.filter((x) => x.TYPE !== 'Private');
  return rank(pub.filter((x) => x.School_Type === type)) || rank(pub.filter((x) => distKey(x.DISTRICT) === district));
}
async function schoolCheck(lng, lat) {
  const [areas, schools] = await Promise.all([getJSON(DATA + 'schoolAttendanceAreas.geojson'), getJSON(DATA + 'schools.geojson')]);
  const a = featureAt(areas, lng, lat);
  if (!a) return { ok: false, missing: true, none: true, area: null, hs: null, hsName: null };
  const g = (k) => a['SchoolAttendanceAreas_Clipped.' + k];
  const hsName = g('Grade_10_Choice1_Name');
  const hs = findSchool(schools.features.map((f) => f.properties), hsName, 'HS', distKey(g('Unified_SD_Name')));
  const area = a['SAA_with_percentiles.csv.SAA_Grade'], hsGrade = hs?.GRADE_1 || null;
  const has = (g) => /^[A-F]/i.test(String(g || '').trim());
  const fails = (has(area) && !atLeast(area, 'C')) || (has(hsGrade) && !atLeast(hsGrade, 'B'));
  const ok = atLeast(area, 'C') && atLeast(hsGrade, 'B');
  return { ok, missing: !ok && !fails, area, hs: hsGrade, hsName };
}
const shortHS = (n) => String(n || 'High school').replace(/\s+(Senior\s+)?High School$/i, ' High').replace(/\s+School$/i, '');
const gradesHTML = (r) => `<span>Area ${badge(r.area)}</span><span>${esc(shortHS(r.hsName))} ${badge(r.hs)}</span>`;

/* ---------- Address lookup: our own lot addresses first (maps/explorer/data/addr), OpenStreetMap only as a backup ---------- */
const WORDS = { street: 'st', avenue: 'ave', av: 'ave', road: 'rd', drive: 'dr', boulevard: 'blvd', lane: 'ln', court: 'ct', place: 'pl',
  terrace: 'ter', circle: 'cir', parkway: 'pkwy', highway: 'hwy', north: 'n', south: 's', east: 'e', west: 'w',
  northeast: 'ne', northwest: 'nw', southeast: 'se', southwest: 'sw', saint: 'st', mount: 'mt', fort: 'ft' };
const sNorm = (s) => String(s ?? '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9# -]/g, ' ').replace(/-/g, ' ')
  .split(/\s+/).filter(Boolean).map((w) => WORDS[w] || w).join(' ');
const label = (r) => `${r[0]}, ${[r[1], ['OR', r[2]].filter(Boolean).join(' ')].filter(Boolean).join(', ')}`;
async function lotSuggest(q, limit = 6) {
  const qn = sNorm(q.replace(/,/g, ' ').replace(/\b(or|oregon)\b/gi, ' ')), qw = qn.split(' ').filter(Boolean);
  if (!qw.length || !/^\d/.test(qw[0]) || (qw[0].length < 2 && qw.length < 2)) return [];
  const rows = await getJSON(DATA + 'addr/' + qw[0].slice(0, 2) + '.json').catch(() => []);
  const hits = [];
  for (const r of rows) {
    const n = (r._n ||= sNorm(r[0] + ' ' + r[1] + ' ' + r[2])), words = n.split(' ');
    if (!words[0].startsWith(qw[0]) || !qw.slice(1).every((t) => words.some((w, k) => k > 0 && w.startsWith(t)))) continue;
    hits.push(r); if (hits.length > 300) break;
  }
  hits.sort((a, b) => (sNorm(a[0]).startsWith(qn) ? 0 : 1) - (sNorm(b[0]).startsWith(qn) ? 0 : 1) || a[0].length - b[0].length);
  return hits.slice(0, limit).map((r) => ({ label: label(r), street: r[0], sub: [r[1], r[2]].filter(Boolean).join(' '), lng: r[3], lat: r[4] }));
}
// Best single match for a full address (Zillow fill or a typed address): same street, and same city when given
async function lotExact(addr) {
  const [street, ...rest] = addr.split(','), city = sNorm((rest[0] || '').trim()), s = sNorm(street.replace(/\s*(#|\bapt\b|\bunit\b|\bste\b).*$/i, ''));
  const list = await lotSuggest(s, 50);
  const same = list.filter((x) => sNorm(x.street) === s);
  return same.find((x) => !city || sNorm(x.sub).startsWith(city)) || same[0] || null;
}
async function osmLocate(q) {   // backup for addresses missing from the lot data (e.g. brand-new builds)
  const tries = [q, q.replace(/\s*(#\s*[\w-]+|\b(apt|unit|ste|suite)\b\.?\s*[\w-]+)/i, '')].map((s) => s.trim()).filter(Boolean);
  for (const t of [...new Set(tries)]) {
    const r = await fetch('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=us&viewbox=-123.6,46.0,-121.6,44.9&q=' + encodeURIComponent(t));
    if (!r.ok) continue;
    const j = await r.json(); if (j.length) return { lat: +j[0].lat, lng: +j[0].lon };
  }
  return null;
}
async function locate(q) {
  const lot = await lotExact(q).catch(() => null);
  if (lot) return { label: lot.label, lat: lot.lat, lng: lot.lng };
  const o = await osmLocate(q).catch(() => null);
  return o ? { label: q, ...o } : null;
}

/* Zillow links carry the address: zillow.com/homedetails/1234-SE-Main-St-Portland-OR-97214/12345_zpid/ */
const STREET_END = /^(st|street|ave|av|avenue|blvd|boulevard|dr|drive|ct|court|ln|lane|pl|place|rd|road|ter|terrace|cir|circle|pkwy|parkway|hwy|highway|way|loop|trl|trail|sq|square|xing|row|walk|path|pt|point|vw|view|run|aly|alley|plz|plaza)$/i;
const TWO_WORD_CITY = new Set(['lake oswego', 'west linn', 'happy valley', 'oregon city', 'forest grove', 'battle ground', 'king city', 'wood village', 'north plains']);
function zillowAddress(url) {
  const m = url.match(/zillow\.com\/homedetails\/([^/?#]+)/i) || url.match(/zillow\.com\/homes\/([^/?#]+?)_rb/i);
  if (!m) return null;
  let slug; try { slug = decodeURIComponent(m[1]); } catch { slug = m[1]; }
  const t = slug.replace(/[,+]/g, '-').split('-').filter(Boolean);
  if (t.length < 3 || !/^\d/.test(t[0])) return null;
  let zip = '', st = '';
  if (/^\d{5}$/.test(t.at(-1))) zip = t.pop();
  if (/^[A-Za-z]{2}$/.test(t.at(-1) || '')) st = t.pop().toUpperCase();
  let i = -1; t.forEach((w, j) => { if (j > 1 && STREET_END.test(w)) i = j; });
  let street = t.join(' '), city = '';
  if (i > 0) {
    let e = i + 1;
    if (/^#./.test(t[e] || '')) e += 1;
    else if (/^(apt|unit|ste|suite|#)$/i.test(t[e] || '')) e += 2;
    street = t.slice(0, e).join(' '); city = t.slice(e).join(' ');
  } else if (t.length > 3) {
    const two = t.slice(-2).join(' ').toLowerCase(), n = TWO_WORD_CITY.has(two) ? 2 : 1;
    street = t.slice(0, -n).join(' '); city = t.slice(-n).join(' ');
  }
  return [street, [city, [st, zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')].filter(Boolean).join(', ');
}

/* ---------- Add a home ---------- */
const sheet = $('#homeSheet'), scrim = $('#scrim'), form = $('#homeForm'), addrIn = $('#addrIn'), linkIn = $('#linkIn'),
      results = $('#addrResults'), hint = $('#addrHint'), checkBox = $('#schoolCheck'), details = $('#details'),
      thumbsEl = $('#homeThumbs'), saveBtn = $('#saveHome'), homeErr = $('#homeErr'), alertBox = $('#reqAlert');
let picked = null, files = [], sugg = [], autoAddr = '', checkResult = null, cleared = false, runId = 0;
const setHint = (t) => { hint.textContent = t || ''; };
function refresh() {
  saveBtn.textContent = cleared ? 'Save home' : 'Continue';
  saveBtn.disabled = !addrIn.value.trim();
}
function resetForm() {
  form.reset(); picked = null; files = []; sugg = []; autoAddr = ''; checkResult = null; cleared = false; runId++;
  thumbsEl.innerHTML = ''; results.innerHTML = ''; setHint(''); homeErr.textContent = '';
  checkBox.hidden = true; details.hidden = true; alertBox.hidden = true; refresh();
}
function openSheet() {
  if (!user) { if (authChecked) { gate.hidden = false; gate.scrollIntoView({ behavior: 'smooth', block: 'start' }); } return; }
  resetForm(); sheet.hidden = false; scrim.hidden = false; lockPage(true); fitSheet();
  setTimeout(() => linkIn.focus(), 50);
}
// ?add=1&back=homes: the add-home form was opened from the Homes page; when it closes (saved or cancelled) go back there
const QS = new URLSearchParams(location.search), BACK = QS.get('back') === 'homes' ? 'homes.html' : null;
function closeSheet() { sheet.hidden = true; scrim.hidden = true; lockPage(false); resetForm(); if (BACK && QS.has('add')) location.href = BACK; }
/* Phones: while the sheet is open the page underneath is pinned (iOS ignores overflow:hidden on the body and scrolls
   the page when the keyboard opens). The sheet follows the *visible* area: when the keyboard is up, its bottom sits on
   top of the keyboard and it never grows taller than what's visible, so no page shows between the sheet and the keyboard. */
let lockY = 0;
function lockPage(on) {
  const b = document.body.style;
  if (on) { lockY = scrollY; Object.assign(b, { position: 'fixed', top: -lockY + 'px', left: '0', right: '0', width: '100%' }); }
  else { Object.assign(b, { position: '', top: '', left: '', right: '', width: '' }); scrollTo(0, lockY); }
}
/* Phones: the sheet is a full-screen page (pinned to all four edges by CSS). The keyboard simply slides over its
   bottom and the sheet scrolls inside, the way native apps do — nothing to measure, so nothing can leave a gap.
   (fitSheet only clears any old inline sizing.) */
function fitSheet() { sheet.style.bottom = sheet.style.height = sheet.style.maxHeight = ''; sheet.classList.remove('kb'); }
$('#addHomeBtn').onclick = openSheet;
$('#closeHome').onclick = closeSheet; $('#cancelHome').onclick = closeSheet; scrim.onclick = closeSheet;
addEventListener('keydown', (e) => { if (e.key === 'Escape' && !sheet.hidden) { if (!alertBox.hidden) $('#reqCancel').click(); else closeSheet(); } });

// Anything that changes the address undoes the check, so a new address is always checked again
function invalidate() { picked = null; checkResult = null; cleared = false; runId++; checkBox.hidden = true; details.hidden = true; refresh(); }

const MSG_FAIL = 'This home does not meet the current attendance area and high school grade requirements.';
const MSG_MISSING = 'This home contains insufficient attendance area and high school grade data. It is recommended to add the home and tell Jason to investigate further.';
const tilesHTML = (r) => r.none
  ? '<div class="tile wide"><span>Attendance area</span><b>Not in our data</b></div>'
  : `<div class="tile"><span>Area grade</span><b>${badge(r.area)}</b></div><div class="tile wide"><span>High school</span><b><em>${esc(shortHS(r.hsName))}</em>${badge(r.hs)}</b></div>`;
function showCheck(r) {   // status line (colored icon + words) over the same gray tiles the map's cards use
  const st = r.ok ? 'ok' : r.missing ? 'missing' : 'fail';
  checkBox.hidden = false;
  checkBox.className = 'check is-' + st;
  checkBox.innerHTML = `<div class="check-status">${ic(r.ok ? 'check' : r.missing ? 'info' : 'cross')}<span>${r.ok ? 'Meets school requirements' : r.missing ? 'Not enough school data' : 'Below the school requirements'}</span></div>
    <div class="check-tiles">${tilesHTML(r)}</div>`;
}
// Run the check for a located address; passes open the rest of the form, misses ask first
async function runCheck(a) {
  const id = ++runId;
  picked = a; cleared = false; details.hidden = true; refresh();
  checkBox.hidden = false; checkBox.className = 'check is-busy'; checkBox.innerHTML = '<div class="check-status"><span class="spin"></span><span>Checking schools…</span></div>';
  let r;
  try { r = await schoolCheck(a.lng, a.lat); } catch (e) { r = { ok: false, missing: true, none: true }; }
  if (id !== runId) return;
  checkResult = r; showCheck(r);
  if (r.ok) proceed();
  else {
    document.activeElement?.blur();   // close the phone keyboard before the message
    $('#reqCard').className = 'alert-card ' + (r.missing ? 'is-missing' : 'is-fail');
    $('#reqTitle').textContent = r.missing ? 'Not enough school data' : 'Below the school requirements';
    $('#reqMsg').textContent = r.missing ? MSG_MISSING : MSG_FAIL;
    $('#reqGrades').innerHTML = tilesHTML(r);
    alertBox.hidden = false; $('#reqAnyway').focus({ preventScroll: true });
  }
}
function proceed() { cleared = true; details.hidden = false; refresh(); setTimeout(() => form.price.focus({ preventScroll: true }), 50); }
$('#reqCancel').onclick = closeSheet;
$('#reqAnyway').onclick = () => { alertBox.hidden = true; proceed(); };

/* duplicate check */
const near = (a, c) => Math.hypot(a.lat - c.lat, a.lng - c.lng) < 0.0003;
function dupOK(a) {
  const dup = allRows.find((r) => r.kind === 'home' && ((r.address || '').trim().toLowerCase() === a.label.trim().toLowerCase() || near(r, a)));
  if (!dup) return true;
  const who = [dup.created_by_name, dup.created_at ? dateStr(dup.created_at) : null].filter(Boolean).join(' on ');
  return confirm(`This address may have already been added${who ? ` by ${who}` : ''}.\n\nAdd it again anyway?`);
}
async function useAddress(a) {
  if (!dupOK(a)) { addrIn.value = ''; invalidate(); return; }
  addrIn.value = a.label; await runCheck(a);
}

/* Zillow link fills the address, then it's located and checked */
linkIn.addEventListener('input', async () => {
  const a = zillowAddress(linkIn.value.trim()), cur = addrIn.value.trim();
  if (!a || (cur && cur !== autoAddr)) return;   // never overwrite an address you typed yourself
  addrIn.value = autoAddr = a; invalidate(); results.innerHTML = '';
  setHint('Address filled in from the Zillow link. Finding it…');
  const loc = await locate(a).catch(() => null);
  if (addrIn.value.trim() !== a) return;
  if (!loc) { setHint("Couldn't find that address. Check it, or pick a suggestion as you type."); return; }
  setHint('Address filled in from the Zillow link.'); autoAddr = loc.label;
  useAddress(loc);
});

/* Suggestions while typing (from our lot data) */
let at;
addrIn.addEventListener('input', () => {
  invalidate(); autoAddr = ''; setHint(''); clearTimeout(at); results.innerHTML = '';
  const q = addrIn.value.trim();
  at = setTimeout(async () => {
    const res = await lotSuggest(q).catch(() => []);
    if (addrIn.value.trim() !== q || document.activeElement !== addrIn) return;
    sugg = res;
    results.innerHTML = res.length ? res.map((a, i) => `<button type="button" data-i="${i}"><b>${esc(a.street)}</b><small>${esc(a.sub)}</small></button>`).join('')
      : q.length >= 6 && /^\d/.test(q) ? '<p class="none">No matches in our lot data. Press Continue and we’ll look it up.</p>' : '';
  }, 150);
});
results.addEventListener('pointerdown', (e) => e.preventDefault());   // keep focus so the tap isn't lost to the blur below
results.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; results.innerHTML = ''; useAddress(sugg[+b.dataset.i]); });
addrIn.addEventListener('blur', () => setTimeout(() => { results.innerHTML = ''; }, 200));
addrIn.addEventListener('keydown', (e) => { if (e.key === 'Enter' && sugg.length && results.innerHTML) { e.preventDefault(); results.innerHTML = ''; useAddress(sugg[0]); } });

/* photos */
const thumbs = () => { thumbsEl.innerHTML = files.map((x, i) => `<img data-i="${i}" alt="Photo ${i + 1} (tap to remove)" src="${URL.createObjectURL(x)}">`).join(''); };
thumbsEl.onclick = (e) => { const i = e.target.dataset.i; if (i == null) return; files.splice(+i, 1); thumbs(); };
form.querySelector('input[type=file]').onchange = (e) => { files.push(...e.target.files); e.target.value = ''; thumbs(); };
async function shrink(file) {
  const img = await createImageBitmap(file, { imageOrientation: 'from-image' }), s = Math.min(1, 1600 / Math.max(img.width, img.height)), c = document.createElement('canvas');
  c.width = Math.round(img.width * s); c.height = Math.round(img.height * s); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return new Promise((res) => c.toBlob(res, 'image/jpeg', 0.8));
}
async function upload(file) {
  const path = `${crypto.randomUUID()}.jpg`, { error } = await sb.storage.from('photos').upload(path, await shrink(file), { contentType: 'image/jpeg' });
  if (error) throw error; return sb.storage.from('photos').getPublicUrl(path).data.publicUrl;
}

/* Continue (locate + check) / Save */
const toUrl = (u) => (u ? (/^https?:\/\//i.test(u) ? u : 'https://' + u) : null);
const numOf = (v) => { v = String(v ?? '').replace(/[^\d.]/g, ''); return v === '' ? null : +v; };
form.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const q = addrIn.value.trim();
  if (!q) { homeErr.textContent = 'Enter an address or paste a Zillow link.'; return; }
  homeErr.textContent = '';
  if (!cleared) {   // step 1: find the address and check its schools
    if (picked && checkResult) { if (!checkResult.ok) alertBox.hidden = false; return; }
    saveBtn.disabled = true; saveBtn.textContent = 'Finding address…';
    const loc = await locate(q).catch(() => null);
    refresh();
    if (!loc) { homeErr.textContent = "Couldn't find that address. Check the spelling, or pick one of the suggestions."; return; }
    useAddress(loc); return;
  }
  saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
  try {
    const urls = []; for (const f of files) urls.push(await upload(f));
    const rec = { kind: 'home', lat: picked.lat, lng: picked.lng, address: addrIn.value.trim(),
      link: toUrl(form.link.value.trim() || null), price: numOf(form.price.value), beds: numOf(form.beds.value),
      baths: numOf(form.baths.value), sqft: numOf(form.sqft.value), note: form.note.value.trim() || null, photos: urls,
      ...(form.priority.checked ? { priority: true } : {}) };
    const { error } = await sb.from('places').insert({ ...rec, created_by_name: user.user_metadata?.name || null });
    if (error) throw (/priority/i.test(error.message) ? Error('The “Priority visit” option needs one setup step in Supabase first (see the note from Claude).') : error);
    closeSheet();
  } catch (x) { homeErr.textContent = x.message || 'Could not save. Check your connection.'; refresh(); }
});

/* ---------- Row arrows (desktop): one card per click, disabled at the ends ---------- */
const navUpdaters = [];
document.querySelectorAll('.nav').forEach((nav) => {
  const row = document.getElementById(nav.dataset.for), prev = nav.querySelector('.prev'), next = nav.querySelector('.next');
  const step = () => (row.querySelector('.card')?.getBoundingClientRect().width || 260) + 12;
  const update = () => { prev.disabled = row.scrollLeft <= 2; next.disabled = row.scrollLeft >= row.scrollWidth - row.clientWidth - 2; };
  prev.onclick = () => row.scrollBy({ left: -step(), behavior: 'smooth' });
  next.onclick = () => row.scrollBy({ left: step(), behavior: 'smooth' });
  row.addEventListener('scroll', update, { passive: true });
  navUpdaters.push(update); update();
});
addEventListener('resize', () => navUpdaters.forEach((u) => u()));
})();
