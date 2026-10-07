/* ==========================================================================
   Small photos for lists (home page, Homes and Places dashboards)
   Lists only ever show each home's / pin's FIRST photo, so only that one gets a small copy (640 px, "_t.jpg",
   roughly 40 KB) saved next to it. The first time a cover photo appears in a list, the page shows the full photo,
   makes the small copy in the browser and saves it; from then on lists load the small one.
   Extra storage: about 40 KB per home or pin — tiny next to the data it saves every time a list is opened.
   ========================================================================== */
(() => {
  'use strict';
  const MARK = '/storage/v1/object/public/photos/';
  const ours = (u) => typeof u === 'string' && u.includes(MARK) && /\.jpe?g(\?|$)/i.test(u) && !/_t\.jpe?g(\?|$)/i.test(u);
  const thumbOf = (u) => (ours(u) ? u.replace(/(\.jpe?g)(\?.*)?$/i, '_t$1') : u);
  let client = null;
  const sb = () => (client ||= window.supabase
    ? window.supabase.createClient('https://qstztxydqhuahgivpztx.supabase.co', 'sb_publishable_5MfonGtWBM7R3rgYtEDdkg_TnUOeWJx') : null);
  const queue = [], seen = new Set(); let busy = false;
  async function makeThumb(full) {
    const img = new Image(); img.crossOrigin = 'anonymous'; img.src = full; await img.decode();
    const s = Math.min(1, 640 / Math.max(img.naturalWidth, img.naturalHeight)), c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.72));
    const path = decodeURIComponent(thumbOf(full).split(MARK)[1].split('?')[0]);
    await sb().storage.from('photos').upload(path, blob, { contentType: 'image/jpeg' });
  }
  async function run() {
    if (busy) return; busy = true;
    try {
      const { data: { session } } = await sb().auth.getSession();   // only signed-in users can save files
      while (session && queue.length) { const u = queue.shift(); try { await makeThumb(u); } catch { /* skip this one */ } }
    } catch { /* offline */ }
    queue.length = 0; busy = false;
  }
  window.PDXThumb = {
    src: thumbOf,
    // <img> for a list: small copy first, full photo if the small one doesn't exist yet
    img: (u, esc) => `<img loading="lazy" alt="" src="${esc(thumbOf(u))}" data-full="${esc(u)}" onerror="PDXThumb.fail(this)">`,
    fail(img) {
      const full = img.dataset.full;
      if (!full || img.dataset.fellBack) return;
      img.dataset.fellBack = '1'; img.src = full;
      if (ours(full) && sb() && !seen.has(full)) { seen.add(full); queue.push(full); setTimeout(run, 1500); }
    },
  };
})();
