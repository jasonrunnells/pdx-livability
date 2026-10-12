/* PDX Livability: photo list for the add/edit forms (shared by the map and the home page).
   - Drag a photo to change the order. The first photo is the cover.
   - Tap the × on a photo to remove it.
   Usage: const ph = PDXPhotos.editor(containerEl, existingUrls);
          ph.add(fileList); ph.count(); const urls = await ph.urls(uploadFn);   // uploads new files in their current order */
(function () {
  const css = `
.pt-tile { position: relative; width: 76px; height: 76px; margin-top: 10px; border-radius: 10px; overflow: hidden; flex: none;
  touch-action: none; user-select: none; -webkit-user-select: none; cursor: grab; background: transparent; }
.pt-tile > img { position: absolute; inset: 0; width: 100% !important; height: 100% !important; margin: 0 !important; border-radius: 0 !important; object-fit: cover; display: block; pointer-events: none; -webkit-user-drag: none; }
.pt-tile.dragging { z-index: 5; cursor: grabbing; box-shadow: 0 8px 22px rgba(0,0,0,.28); transform-origin: center; }
.pt-tile.dragging img { transform: scale(1.06); }
.pt-tile:not(.dragging) { transition: transform .15s ease; }
.pt-cover { position: absolute; left: 5px; bottom: 5px; padding: 2px 6px; border-radius: 6px; background: rgba(0,0,0,.62); color: #fff;
  font: 700 10px/1.3 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; letter-spacing: .02em; pointer-events: none; }
.pt-del { position: absolute; top: 4px; right: 4px; width: 20px; height: 20px; padding: 0; border: 0; border-radius: 50%;
  display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,.62); color: #fff; cursor: pointer; }
.pt-del:hover { background: rgba(200,40,40,.9); }
.pt-del svg { width: 10px; height: 10px; fill: none; stroke: currentColor; stroke-width: 2.4; stroke-linecap: round; }
.pt-hint { width: 100%; margin-top: 6px; font-size: 12px; opacity: .65; }`;
  let styled = false;
  const style = () => { if (styled) return; styled = true; const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s); };
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const X = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 3l6 6M9 3l-6 6"/></svg>';

  function editor(box, start = []) {
    style();
    let items = start.map((u) => ({ url: u }));
    const draw = () => {
      box.innerHTML = items.map((it, i) => `<div class="pt-tile" data-i="${i}"><img src="${esc(it.url)}" alt="Photo ${i + 1}">`
        + `${i === 0 && items.length > 1 ? '<span class="pt-cover">Cover</span>' : ''}`
        + `<button type="button" class="pt-del" data-del="${i}" aria-label="Remove photo ${i + 1}">${X}</button></div>`).join('')
        + (items.length > 1 ? '<div class="pt-hint">Drag to reorder. The first photo is the cover.</div>' : '');
    };
    box.addEventListener('click', (e) => {
      const b = e.target.closest('[data-del]'); if (!b) return;
      e.preventDefault(); e.stopPropagation();
      const [it] = items.splice(+b.dataset.del, 1); if (it && it.file) URL.revokeObjectURL(it.url);
      draw();
    });
    // Drag to reorder: the photo follows the pointer; passing over another photo moves it to that spot
    let drag = null;
    box.addEventListener('pointerdown', (e) => {
      const t = e.target.closest('.pt-tile'); if (!t || e.target.closest('[data-del]') || items.length < 2) return;
      e.preventDefault();
      drag = { el: t, id: e.pointerId, x: e.clientX, y: e.clientY, ox: t.offsetLeft, oy: t.offsetTop, moved: false };
      t.setPointerCapture(e.pointerId);
    });
    box.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 5) return;
      drag.moved = true; drag.el.classList.add('dragging');
      for (const o of box.querySelectorAll('.pt-tile')) {
        if (o === drag.el) continue;
        const r = o.getBoundingClientRect();
        if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) continue;
        const tiles = [...box.querySelectorAll('.pt-tile')], a = tiles.indexOf(drag.el), b = tiles.indexOf(o);
        box.insertBefore(drag.el, a < b ? o.nextSibling : o);
        break;
      }
      // keep the photo under the pointer even after it moved to a new spot in the row
      const sx = drag.el.offsetLeft - drag.ox, sy = drag.el.offsetTop - drag.oy;
      drag.el.style.transform = `translate(${dx - sx}px, ${dy - sy}px)`;
    });
    const end = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const moved = drag.moved; drag.el.classList.remove('dragging'); drag.el.style.transform = ''; drag = null;
      if (!moved) return;
      const order = [...box.querySelectorAll('.pt-tile')].map((t) => +t.dataset.i);
      items = order.map((i) => items[i]);
      draw();
    };
    box.addEventListener('pointerup', end);
    box.addEventListener('pointercancel', end);
    draw();
    return {
      add(files) { for (const file of files) items.push({ file, url: URL.createObjectURL(file) }); draw(); },
      count: () => items.length,
      clear() { items.forEach((it) => it.file && URL.revokeObjectURL(it.url)); items = []; draw(); },
      async urls(upload) { const out = []; for (const it of items) out.push(it.file ? await upload(it.file) : it.url); return out; },
    };
  }
  window.PDXPhotos = { editor };
})();
