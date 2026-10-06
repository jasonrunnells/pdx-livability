/* ==========================================================================
   Homes dashboard (homes.html): every saved home with filters, sorting and a full detail panel.
   Shares look and helpers with the home page (badges, school check, boundary lookups are copied from script.js).
   ========================================================================== */
(() => {
'use strict';
const $ = (s) => document.querySelector(s);
const sb = supabase.createClient('https://qstztxydqhuahgivpztx.supabase.co', 'sb_publishable_5MfonGtWBM7R3rgYtEDdkg_TnUOeWJx');
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const usd = (v) => (v == null || v === '' ? '–' : '$' + Math.round(v).toLocaleString());
const DATA = 'maps/explorer/data/';
const ICON = {
  home: '<path d="M4.75 10.4 12 4.5l7.25 5.9V18.5a1 1 0 0 1-1 1H5.75a1 1 0 0 1-1-1z"/>',
  check: '<path d="m5.5 12.5 4 4 9-9"/>',
  flag: '<path d="M5.5 20.5v-16M5.5 4.75h11.25l-2.5 4 2.5 4H5.5"/>',
  cross: '<path d="M7 7l10 10M17 7 7 17"/>',
  info: '<circle cx="12" cy="12" r="8.25"/><path d="M12 11v5M12 8v.01"/>',
  map: '<path d="M9 5 3.75 7v12L9 17l6 2 5.25-2V5L15 7z"/><path d="M9 5v12M15 7v12"/>',
  dir: '<path d="M12 3.5 20.5 12 12 20.5 3.5 12z"/><path d="M9.5 13.5v-2a1 1 0 0 1 1-1h4M12.5 8.5l2 2-2 2"/>',
  link: '<path d="M14 5h5v5M19 5l-8 8M17 13.5V18a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h4.5"/>',
};
const ic = (k) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${ICON[k]}</svg>`;
const STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.4l2.55 5.3 5.85.8-4.25 4.05 1.05 5.8L12 16.6l-5.2 2.75 1.05-5.8L3.6 9.5l5.85-.8z"/></svg>';
const photoSrc = (u) => (/^https?:\/\//i.test(u) ? u : 'maps/explorer/' + u);
const dateStr = (d) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const shortK = (v) => (v >= 1e6 ? '$' + String(+(v / 1e6).toFixed(2)) + 'M' : '$' + Math.round(v / 1000) + 'k');

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

/* ---------- State ---------- */
let user = null, rows = [];
const info = new Map();   // home id -> { hood, hoodId, city, check }
const store = { get() { try { return JSON.parse(localStorage.getItem('pdx.homes.filters') || '{}'); } catch { return {}; } },
                set(v) { try { localStorage.setItem('pdx.homes.filters', JSON.stringify(v)); } catch { /* private mode */ } } };
const saved = store.get();
const F = { text: '', chips: new Set(saved.chips || []), sort: saved.sort || 'new', lo: saved.lo ?? null, hi: saved.hi ?? null, beds: saved.beds || '', city: saved.city || '' };
const homes = () => rows.filter((r) => r.kind === 'home');

/* Menu (page links on phones + sign out) */
const menu = $('#menu'), menuBtn = $('#menuBtn');
const setMenu = (on) => { menu.hidden = !on; menuBtn.setAttribute('aria-expanded', on); };
menuBtn.onclick = (e) => { e.stopPropagation(); setMenu(menu.hidden); };
document.addEventListener('click', (e) => { if (!menu.hidden && !menu.contains(e.target)) setMenu(false); });

/* Filters drop-down: opens from the Filters button; closes with its X, a tap outside, Escape, or as soon as the page scrolls */
const drop = $('#fDrop'), fBtn = $('#fBtn');
let dropY = 0;
let dropTimer = 0;
function setDrop(on) {
  if (!on && (drop.hidden || drop.classList.contains('closing'))) return;   // already closed or closing (scroll fires many times)
  fBtn.setAttribute('aria-expanded', on); fBtn.classList.toggle('open', on);
  clearTimeout(dropTimer);
  if (on) { drop.classList.remove('closing'); drop.style.height = ''; drop.hidden = false; dropY = scrollY; return; }
  // close softly: fold the panel's height to zero while it fades and lifts, then hide it
  drop.style.height = drop.offsetHeight + 'px'; void drop.offsetHeight;
  drop.classList.add('closing'); drop.style.height = '0px';
  dropTimer = setTimeout(() => { drop.hidden = true; drop.classList.remove('closing'); drop.style.height = ''; }, 220);
}
fBtn.onclick = (e) => { e.stopPropagation(); setDrop(drop.hidden || drop.classList.contains('closing')); };   // closing counts as closed
$('#fClose').onclick = () => setDrop(false);
addEventListener('scroll', () => {
  // a filter change can shorten the page and nudge the scroll position; that shouldn't close the panel
  if (performance.now() - lastFilterChange < 600) { dropY = scrollY; return; }
  if (!drop.hidden && Math.abs(scrollY - dropY) > 24) setDrop(false);
}, { passive: true });
document.addEventListener('pointerdown', (e) => { if (!drop.hidden && !$('#hdFilters').contains(e.target)) setDrop(false); });
addEventListener('keydown', (e) => { if (e.key === 'Escape') { setDrop(false); setMenu(false); } });

/* sticky header + filters: filters sit right under the header */
const setHdr = () => document.documentElement.style.setProperty('--hdr', $('#hdTop').getBoundingClientRect().height + 'px');
setHdr(); new ResizeObserver(setHdr).observe($('#hdTop'));   // re-measure whenever the header's height changes (fonts, avatar, rotation)

/* ---------- Sign in + data ---------- */
sb.auth.getSession().then(({ data: { session } }) => {
  if (!session) { $('#gate').hidden = false; return; }
  user = session.user;
  const name = user.user_metadata?.name || user.email || '';
  $('#avatar').textContent = name.trim().charAt(0).toUpperCase(); $('#avatar').title = name;
  load();
});
$('#signOut').onclick = async () => { await sb.auth.signOut(); location.href = 'index.html'; };

async function load() {
  $('#hdApp').hidden = false; $('#hdFilters').hidden = false;
  $('#hdGrid').innerHTML = '<p class="empty">Loading homes…</p>';
  const { data, error } = await sb.from('places').select('*').eq('kind', 'home').order('created_at', { ascending: false });
  if (error) { $('#hdGrid').innerHTML = `<p class="empty">Couldn't load: ${esc(error.message)}</p>`; return; }
  rows = data; syncControls(); render(); enrich();
  sb.channel('homes-dash').on('postgres_changes', { event: '*', schema: 'public', table: 'places' }, (p) => {
    if (p.eventType === 'DELETE') rows = rows.filter((r) => r.id !== p.old.id);
    else if (p.new.kind === 'home') { rows = [p.new, ...rows.filter((r) => r.id !== p.new.id)]; info.delete(p.new.id); }
    render(); enrich();
  }).subscribe();
}

// Neighborhood and city for every home (boundary files are shared with the map)
async function enrich() {
  const [hoods, cities] = await Promise.all([getJSON(DATA + 'neighborhoods.geojson').catch(() => null), getJSON(DATA + 'cities.geojson').catch(() => null)]);
  for (const r of homes()) {
    if (info.has(r.id) || r.lat == null) continue;
    const h = hoods && featureAt(hoods, r.lng, r.lat), c = cities && featureAt(cities, r.lng, r.lat);
    const check = await schoolCheck(r.lng, r.lat).catch(() => null);
    info.set(r.id, { hood: h?.Name, hoodId: h?.RegionID, city: c?.NAME, county: await countyValue(r.address), check });
  }
  fillCities(); render();
}

/* ---------- Filters ---------- */
function fillCities() {
  const sel = $('#fCity'), have = [...new Set(homes().map((r) => info.get(r.id)?.city).filter(Boolean))].sort();
  const cur = F.city;
  sel.innerHTML = '<option value="">All</option>' + have.map((c) => `<option ${c === cur ? 'selected' : ''}>${esc(c)}</option>`).join('');
}
function syncControls() {
  $('#fSort').value = F.sort; $('#fBeds').value = F.beds; syncPrice();
  document.querySelectorAll('.hd-chip').forEach((b) => { const on = F.chips.has(b.dataset.f); b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
  const n = F.chips.size + (F.lo != null || F.hi != null ? 1 : 0) + (F.beds ? 1 : 0) + (F.city ? 1 : 0) + (F.sort !== 'new' ? 1 : 0);
  $('#fCount').hidden = !n; $('#fCount').textContent = n; $('#fBtn').classList.toggle('active', n > 0);
  $('#fReset').hidden = !(F.text || n);
}
let lastFilterChange = 0;
function changed() { lastFilterChange = performance.now(); store.set({ chips: [...F.chips], sort: F.sort, lo: F.lo, hi: F.hi, beds: F.beds, city: F.city }); syncControls(); render(); }
$('#fText').addEventListener('input', (e) => { F.text = e.target.value.trim().toLowerCase(); changed(); });
document.querySelectorAll('.hd-chip').forEach((b) => b.addEventListener('click', () => {
  const k = b.dataset.f;
  if (F.chips.has(k)) F.chips.delete(k); else { F.chips.add(k); if (k === 'visited') F.chips.delete('notvisited'); if (k === 'notvisited') F.chips.delete('visited'); }
  changed();
}));
$('#fSort').onchange = (e) => { F.sort = e.target.value; changed(); };
$('#fBeds').onchange = (e) => { F.beds = e.target.value; changed(); };
$('#fCity').onchange = (e) => { F.city = e.target.value; changed(); };
$('#fReset').onclick = () => { F.text = ''; $('#fText').value = ''; F.chips.clear(); F.sort = 'new'; F.lo = F.hi = null; F.beds = F.city = ''; changed(); };
/* Price range slider: spans the cheapest to the priciest saved home (in $5k steps). Null ends mean "no limit". */
const fLo = $('#fLo'), fHi = $('#fHi');
function priceBounds() {
  const p = homes().map((r) => +r.price).filter((v) => v > 0);
  if (p.length < 2) return null;
  const step = 5000, lo = Math.floor(Math.min(...p) / step) * step, hi = Math.ceil(Math.max(...p) / step) * step;
  return lo < hi ? { lo, hi, step } : null;
}
function syncPrice() {
  const b = priceBounds(), box = $('#fPrice');
  box.hidden = !b; if (!b) return;
  for (const el of [fLo, fHi]) { el.min = b.lo; el.max = b.hi; el.step = b.step; }
  const lo = F.lo == null ? b.lo : Math.max(b.lo, Math.min(F.lo, b.hi)), hi = F.hi == null ? b.hi : Math.min(b.hi, Math.max(F.hi, b.lo));
  fLo.value = lo; fHi.value = hi;
  const a = ((lo - b.lo) / (b.hi - b.lo)) * 100, z = ((hi - b.lo) / (b.hi - b.lo)) * 100;
  $('#fFill').style.left = a + '%'; $('#fFill').style.right = (100 - z) + '%';
  $('#fPriceLbl').textContent = F.lo == null && F.hi == null ? `Any · ${shortK(b.lo)} – ${shortK(b.hi)}` : `${shortK(lo)} – ${shortK(hi)}`;
}
function onRange(which) {
  const b = priceBounds(); if (!b) return;
  let lo = +fLo.value, hi = +fHi.value;
  if (lo > hi) { if (which === 'lo') lo = hi; else hi = lo; }
  F.lo = lo <= b.lo ? null : lo; F.hi = hi >= b.hi ? null : hi;
  changed();
}
fLo.addEventListener('input', () => onRange('lo')); fHi.addEventListener('input', () => onRange('hi'));
syncControls();

// County market value for an address, from the lot address files (6th column)
const WORDS = { street: 'st', avenue: 'ave', av: 'ave', road: 'rd', drive: 'dr', boulevard: 'blvd', lane: 'ln', court: 'ct', place: 'pl',
  terrace: 'ter', circle: 'cir', parkway: 'pkwy', highway: 'hwy', north: 'n', south: 's', east: 'e', west: 'w',
  northeast: 'ne', northwest: 'nw', southeast: 'se', southwest: 'sw', saint: 'st', mount: 'mt', fort: 'ft' };
const sNorm = (v) => String(v ?? '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 -]/g, ' ').replace(/-/g, ' ')
  .split(/\s+/).filter(Boolean).map((w) => WORDS[w] || w).join(' ');
async function countyValue(address) {
  const parts = String(address || '').split(','), street = sNorm(parts[0].replace(/\s*(#|\bapt\b|\bunit\b|\bste\b).*$/i, '')), n0 = street.split(' ')[0];
  if (!/^\d/.test(n0)) return null;
  const rows = await getJSON(DATA + 'addr/' + n0.slice(0, 2) + '.json').catch(() => []);
  const city = sNorm((parts[1] || '').trim()), hits = rows.filter((x) => sNorm(x[0]) === street);
  const row = hits.find((x) => !city || sNorm(x[1]) === city) || hits[0];
  return row && row[5] > 0 ? row[5] : null;
}

// "Best value": each home is scored against your other saved homes on three things, then the scores are averaged:
//   1. price per sq ft (lower is better)
//   2. beds + baths (more is better)
//   3. list price vs. county market value (lower is better)
// A home missing one of these is scored on the others; a home with none of them sorts last.
function valueScores(list) {
  const metric = [
    (r) => (+r.price > 0 && +r.sqft > 0 ? -(r.price / r.sqft) : null),
    (r) => (r.beds != null || r.baths != null ? (+r.beds || 0) + (+r.baths || 0) : null),
    (r) => { const c = info.get(r.id)?.county; return +r.price > 0 && c ? -(r.price / c) : null; },
  ];
  const out = new Map(list.map((r) => [r.id, []]));
  for (const m of metric) {
    const vals = list.map((r) => [r.id, m(r)]).filter(([, v]) => v != null), lo = Math.min(...vals.map((x) => x[1])), hi = Math.max(...vals.map((x) => x[1]));
    for (const [id, v] of vals) out.get(id).push(hi > lo ? (v - lo) / (hi - lo) : 0.5);
  }
  return new Map([...out].map(([id, a]) => [id, a.length ? a.reduce((x, y) => x + y, 0) / a.length : -1]));
}
function filtered() {
  const list = homes().filter((r) => {
    const x = info.get(r.id) || {};
    if (F.text && ![r.address, x.hood, x.city].some((v) => String(v || '').toLowerCase().includes(F.text))) return false;
    if (F.chips.has('priority') && !r.priority) return false;
    if (F.chips.has('visited') && !r.visited) return false;
    if (F.chips.has('notvisited') && r.visited) return false;
    if (F.lo != null && !(+r.price >= F.lo)) return false;
    if (F.hi != null && !(+r.price > 0 && +r.price <= F.hi)) return false;
    if (F.beds && !(+r.beds >= +F.beds)) return false;
    if (F.city && x.city !== F.city) return false;
    return true;
  });
  const by = { priceAsc: (a, b) => (a.price || 9e9) - (b.price || 9e9), priceDesc: (a, b) => (b.price || 0) - (a.price || 0),
               rating: (a, b) => (b.rating || 0) - (a.rating || 0), sqft: (a, b) => (b.sqft || 0) - (a.sqft || 0),
               new: (a, b) => new Date(b.created_at) - new Date(a.created_at),
               old: (a, b) => new Date(a.created_at) - new Date(b.created_at),
               value: null };
  if (F.sort === 'value') { const sc = valueScores(list); return list.sort((a, b) => sc.get(b.id) - sc.get(a.id)); }
  return list.sort(by[F.sort] || by.new);
}

/* ---------- Cards ---------- */
function schoolLine(x) {
  const c = x?.check;
  if (!c) return '<span class="muted">Checking schools…</span>';
  if (c.none) return '<span class="muted">No attendance area</span>';
  const st = c.ok ? ['ok', 'check'] : c.missing ? ['missing', 'info'] : ['fail', 'cross'];
  return `<span class="hd-q ${st[0]}">${ic(st[1])}</span><span>Area ${badge(c.area)}</span><span class="hd-hs"><em>${esc(shortHS(c.hsName))}</em>${badge(c.hs)}</span>`;
}
function card(r) {
  const x = info.get(r.id), photo = (r.photos || [])[0];
  const specs = [r.beds != null ? `${r.beds} bd` : null, r.baths != null ? `${r.baths} ba` : null, r.sqft ? `${(+r.sqft).toLocaleString()} sq ft` : null].filter(Boolean).join(' · ');
  const street = String(r.address || 'Home').split(',')[0];
  return `<button type="button" class="hd-card${r.id === openId ? ' on' : ''}" data-id="${esc(r.id)}">
    <div class="hd-img">${photo ? `<img loading="lazy" alt="" src="${esc(photoSrc(photo))}">` : `<div class="ph">${ic('home')}</div>`}
      ${r.visited ? `<span class="visited">${ic('check')}Visited</span>` : ''}
      <div class="hd-badges">${r.priority ? `<span class="prio">${ic('flag')}Priority</span>` : ''}${x?.check && !x.check.ok
        ? `<span class="hd-warn ${x.check.missing ? 'missing' : 'fail'}" title="${x.check.missing ? 'Not enough school data' : 'Does not meet school requirements'}">${ic('info')}${x.check.missing ? 'No school data' : 'School req. not met'}</span>` : ''}</div>
      ${specs ? `<div class="specbar">${specs}</div>` : ''}${(r.photos || []).length > 1 ? `<span class="hd-pcount" title="${r.photos.length} photos"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 8.5a2 2 0 0 1 2-2h1.8l1.4-2h4.6l1.4 2h1.8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2z"/><circle cx="12" cy="13" r="3.25"/></svg>${r.photos.length}</span>` : ''}</div>
    <div class="hd-body">
      <div class="hd-r1"><span class="price">${r.price ? usd(r.price) : 'No price'}</span>${+r.rating > 0 ? `<span class="hd-rate">${STAR}${(+r.rating).toFixed(1)}</span>` : ''}</div>
      <div class="addr">${esc(street)}</div>
      <div class="hd-place">${[x?.hood ? `<span class="nb-hood">${esc(x.hood)}</span>` : '', x?.city ? `<span class="nb-city">${esc(x.city)}</span>` : ''].filter(Boolean).join(' · ') || '&nbsp;'}</div>
    </div>
  </button>`;
}
// Cards are kept and reused between renders (photos don't reload), then animated:
// cards that stay slide to their new spot, cards that come back fade in, cards that drop out fade away.
const nodes = new Map();   // home id -> { el, html }
const calm = matchMedia('(prefers-reduced-motion: reduce)');
const EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
function render() {
  const all = homes(), list = filtered(), grid = $('#hdGrid');
  $('#hdCount').textContent = all.length ? (list.length === all.length ? all.length : `${list.length} of ${all.length}`) : '';
  if (!all.length || !list.length) {
    grid.innerHTML = !all.length ? '<p class="empty">No homes saved yet.</p>'
      : '<p class="empty">No homes match these filters. <button type="button" class="link" id="emptyReset">Reset filters</button></p>';
    $('#emptyReset')?.addEventListener('click', () => $('#fReset').click());
    return;
  }
  grid.querySelectorAll(':scope > .empty').forEach((e) => e.remove());
  const before = new Map();
  for (const [id, n] of nodes) if (n.el.isConnected) before.set(id, n.el.getBoundingClientRect());
  const keep = new Set();
  for (const r of list) {
    const html = card(r).trim(); let n = nodes.get(r.id);
    if (!n || n.html !== html) {
      const t = document.createElement('template'); t.innerHTML = html; const el = t.content.firstElementChild;
      if (n?.el.isConnected) n.el.replaceWith(el);
      n = { el, html }; nodes.set(r.id, n);
    }
    keep.add(r.id); grid.appendChild(n.el);   // appending an existing card just moves it into the new order
  }
  // cards that dropped out: fade them away in place, then remove
  for (const [id, n] of nodes) {
    if (keep.has(id) || !n.el.isConnected) continue;
    const el = n.el, b = before.get(id);
    if (calm.matches || !b) { el.remove(); continue; }
    const g = grid.getBoundingClientRect();
    Object.assign(el.style, { position: 'absolute', left: b.left - g.left + 'px', top: b.top - g.top + 'px', width: b.width + 'px', height: b.height + 'px', pointerEvents: 'none', zIndex: 0 });
    el.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(0.96)' }], { duration: 180, easing: 'ease-out' }).onfinish = () => { el.remove(); el.removeAttribute('style'); };
  }
  if (calm.matches) return;
  for (const id of keep) {
    const el = nodes.get(id).el, b = before.get(id);
    if (!b) { el.animate([{ opacity: 0, transform: 'translateY(10px) scale(0.98)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: EASE }); continue; }
    const a = el.getBoundingClientRect(), dx = b.left - a.left, dy = b.top - a.top;
    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 300, easing: EASE });
  }
}
$('#hdGrid').addEventListener('click', (e) => { const b = e.target.closest('.hd-card'); if (b) openPanel(b.dataset.id); });

/* ---------- Detail panel: the map's own home card, embedded ----------
   The panel loads the map in embed mode (maps/explorer/index.html?pin=<id>&embed=1), which shows exactly the same
   card as the map — property records, schools, area, nearby, rating, edit, visited, priority — plus "View on map".
   Changes made there save to the database and show up here through the live updates. */
let openId = null, lockY = 0;
const panel = $('#hdPanel'), scrim = $('#hdScrim'), frame = $('#hdFrame');
function openPanel(id) {
  if (openId === id && !panel.hidden) return;
  openId = id;
  frame.src = `maps/explorer/index.html?pin=${encodeURIComponent(id)}&embed=1`;
  if (panel.hidden) {
    panel.hidden = false; scrim.hidden = false;
    lockY = scrollY; Object.assign(document.body.style, { position: 'fixed', top: -lockY + 'px', left: '0', right: '0' });
  }
  document.querySelectorAll('.hd-card').forEach((c) => c.classList.toggle('on', c.dataset.id === id));
}
function closePanel() {
  if (panel.hidden) return;
  openId = null; panel.hidden = true; scrim.hidden = true; frame.src = 'about:blank';
  Object.assign(document.body.style, { position: '', top: '', left: '', right: '' }); scrollTo(0, lockY);
  document.querySelectorAll('.hd-card.on').forEach((c) => c.classList.remove('on'));
}
scrim.onclick = closePanel;
addEventListener('keydown', (e) => { if (e.key === 'Escape') closePanel(); });
addEventListener('message', (e) => { if (e.origin === location.origin && e.data?.type === 'pdx-close-card') closePanel(); });
})();
