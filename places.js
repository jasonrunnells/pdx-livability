/* ==========================================================================
   Places dashboard (places.html): Explore pins and Observations, with filters and the map's own card.
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

/* ---------- State ---------- */
let user = null, rows = [];
const info = new Map();   // id -> { hood, city }
const store = { get() { try { return JSON.parse(localStorage.getItem('pdx.places.filters') || '{}'); } catch { return {}; } },
                set(v) { try { localStorage.setItem('pdx.places.filters', JSON.stringify(v)); } catch { /* private mode */ } } };
const saved = store.get();
const F = { text: '', kind: saved.kind || 'explore', chips: new Set(saved.chips || []), sort: saved.sort || 'new', who: saved.who || '', city: saved.city || '' };
const COLOR = { explore: '#0891B2', observation: '#475569' };
const items = () => rows.filter((r) => r.kind === F.kind);
const titleOf = (r) => r.title || (r.note ? String(r.note).slice(0, 48) + (String(r.note).length > 48 ? '…' : '') : (r.kind === 'explore' ? 'Place to explore' : 'Observation'));
ICON.explore = '<circle cx="12" cy="12" r="8"/><path d="m15.2 8.8-1.9 4.5-4.5 1.9 1.9-4.5z"/>';
ICON.observation = '<path d="M2.75 12S6 6 12 6s9.25 6 9.25 6S18 18 12 18s-9.25-6-9.25-6Z"/><circle cx="12" cy="12" r="2.75"/>';

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
  $('#hdGrid').innerHTML = '<p class="empty">Loading places…</p>';
  const { data, error } = await sb.from('places').select('*').in('kind', ['explore', 'observation']).order('created_at', { ascending: false });
  if (error) { $('#hdGrid').innerHTML = `<p class="empty">Couldn't load: ${esc(error.message)}</p>`; return; }
  rows = data; fillSelects(); syncControls(); render(); enrich();
  sb.channel('places-dash').on('postgres_changes', { event: '*', schema: 'public', table: 'places' }, (p) => {
    if (p.eventType === 'DELETE') rows = rows.filter((r) => r.id !== p.old.id);
    else if (p.new.kind === 'explore' || p.new.kind === 'observation') rows = [p.new, ...rows.filter((r) => r.id !== p.new.id)];
    else rows = rows.filter((r) => r.id !== p.new.id);
    fillSelects(); render(); enrich();
  }).subscribe();
}
// Neighborhood and city for every pin (boundary files are shared with the map)
async function enrich() {
  const [hoods, cities] = await Promise.all([getJSON(DATA + 'neighborhoods.geojson').catch(() => null), getJSON(DATA + 'cities.geojson').catch(() => null)]);
  let added = false;
  for (const r of rows) {
    if (info.has(r.id) || r.lat == null) continue;
    info.set(r.id, { hood: hoods && featureAt(hoods, r.lng, r.lat)?.Name, city: cities && featureAt(cities, r.lng, r.lat)?.NAME }); added = true;
  }
  if (added) { fillSelects(); render(); }
}

/* ---------- Tabs + filters ---------- */
function fillSelects() {
  const opts = (sel, vals, cur, all) => { $(sel).innerHTML = `<option value="">${all}</option>` + vals.map((v) => `<option ${v === cur ? 'selected' : ''}>${esc(v)}</option>`).join(''); };
  opts('#fWho', [...new Set(rows.map((r) => r.created_by_name).filter(Boolean))].sort(), F.who, 'Anyone');
  opts('#fCity', [...new Set(rows.map((r) => info.get(r.id)?.city).filter(Boolean))].sort(), F.city, 'All');
  $('#nExplore').textContent = rows.filter((r) => r.kind === 'explore').length || '';
  $('#nObs').textContent = rows.filter((r) => r.kind === 'observation').length || '';
}
function syncControls() {
  $('#fSort').value = F.sort;
  document.querySelectorAll('.pl-tab').forEach((t) => t.setAttribute('aria-selected', t.dataset.kind === F.kind));
  document.querySelectorAll('.obs-only').forEach((b) => { b.hidden = F.kind !== 'observation'; });
  if (F.kind !== 'observation') F.chips.delete('fromExplore');
  document.querySelectorAll('.hd-chip').forEach((b) => { const on = F.chips.has(b.dataset.f); b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
  const n = F.chips.size + (F.who ? 1 : 0) + (F.city ? 1 : 0) + (F.sort !== 'new' ? 1 : 0);
  $('#fCount').hidden = !n; $('#fCount').textContent = n; $('#fBtn').classList.toggle('active', n > 0);
  $('#fReset').hidden = !(F.text || n);
  $('#plHint').textContent = F.kind === 'explore' ? 'Places to check out. On the map, press and hold anywhere (right-click on a computer) to add one.'
    : 'Notes from the road. On the map, tap the pin button to add one where you are.';
  $('#fText').placeholder = F.kind === 'explore' ? 'Search Explore' : 'Search observations';
}
let lastFilterChange = 0;
function changed() { lastFilterChange = performance.now(); store.set({ kind: F.kind, chips: [...F.chips], sort: F.sort, who: F.who, city: F.city }); syncControls(); render(); }
document.querySelectorAll('.pl-tab').forEach((t) => t.addEventListener('click', () => { if (F.kind === t.dataset.kind) return; F.kind = t.dataset.kind; changed(); }));
$('#fText').addEventListener('input', (e) => { F.text = e.target.value.trim().toLowerCase(); changed(); });
document.querySelectorAll('.hd-chip').forEach((b) => b.addEventListener('click', () => { const k = b.dataset.f; if (F.chips.has(k)) F.chips.delete(k); else F.chips.add(k); changed(); }));
$('#fSort').onchange = (e) => { F.sort = e.target.value; changed(); };
$('#fWho').onchange = (e) => { F.who = e.target.value; changed(); };
$('#fCity').onchange = (e) => { F.city = e.target.value; changed(); };
$('#fReset').onclick = () => { F.text = ''; $('#fText').value = ''; F.chips.clear(); F.sort = 'new'; F.who = F.city = ''; changed(); };
syncControls();

function filtered() {
  const list = items().filter((r) => {
    const x = info.get(r.id) || {};
    if (F.text && ![r.title, r.note, x.hood, x.city].some((v) => String(v || '').toLowerCase().includes(F.text))) return false;
    if (F.chips.has('photos') && !(r.photos || []).length) return false;
    if (F.chips.has('notes') && !r.note) return false;
    if (F.chips.has('fromExplore') && !r.visited) return false;
    if (F.who && r.created_by_name !== F.who) return false;
    if (F.city && x.city !== F.city) return false;
    return true;
  });
  const by = { new: (a, b) => new Date(b.created_at) - new Date(a.created_at), old: (a, b) => new Date(a.created_at) - new Date(b.created_at),
               az: (a, b) => titleOf(a).localeCompare(titleOf(b)) };
  return list.sort(by[F.sort] || by.new);
}

/* ---------- Cards ---------- */
function card(r) {
  const x = info.get(r.id), photo = (r.photos || [])[0], col = COLOR[r.kind];
  const when = r.created_at ? new Date(r.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
  return `<button type="button" class="hd-card pl-card${r.id === openId ? ' on' : ''}" data-id="${esc(r.id)}" style="--dot:${col}">
    <div class="hd-img">${photo ? `${PDXThumb.img(photoSrc(photo), esc)}` : `<div class="ph solid">${ic(r.kind)}</div>`}
      ${r.kind === 'observation' && r.visited ? `<span class="visited">${ic('check')}From Explore</span>` : ''}
      ${(r.photos || []).length > 1 ? `<span class="hd-pcount">${r.photos.length}</span>` : ''}</div>
    <div class="hd-body">
      <div class="pl-title">${r.title ? esc(r.title) : (r.kind === 'explore' ? 'Explore' : 'Observation')}</div>
      ${r.note ? `<div class="pl-note">${esc(r.note)}</div>` : ''}
      <div class="hd-place">${[x?.hood ? `<span class="nb-hood">${esc(x.hood)}</span>` : '', x?.city ? `<span class="nb-city">${esc(x.city)}</span>` : ''].filter(Boolean).join(' · ') || '&nbsp;'}</div>
      <div class="pl-who">${esc([r.created_by_name, when].filter(Boolean).join(' · '))}</div>
    </div>
  </button>`;
}

// Cards are kept and reused between renders (photos don't reload), then animated:
// cards that stay slide to their new spot, cards that come back fade in, cards that drop out fade away.
const nodes = new Map();   // home id -> { el, html }
const calm = matchMedia('(prefers-reduced-motion: reduce)');
const EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
function render() {
  const all = items(), list = filtered(), grid = $('#hdGrid');
  $('#hdCount').textContent = all.length ? (list.length === all.length ? all.length : `${list.length} of ${all.length}`) : '';
  if (!all.length || !list.length) {
    grid.innerHTML = !all.length ? (F.kind === 'explore' ? '<p class="empty">No Explore pins yet. On the map, press and hold anywhere to save a place to check out.</p>' : '<p class="empty">No observations yet. On the map, tap the pin button to add one where you are.</p>')
      : '<p class="empty">Nothing matches these filters. <button type="button" class="link" id="emptyReset">Reset filters</button></p>';
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
  frame.src = `maps/explorer/index.html?pin=${encodeURIComponent(id)}&embed=1&wide=1`   /* full-height card with the buttons always pinned, on phones and desktop */;
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
