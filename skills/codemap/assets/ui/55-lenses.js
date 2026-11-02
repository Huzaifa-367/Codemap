// More ways to read the same map: by layer (screens, API, logic, data …), by business domain (flows grouped by the
// `domain` the agent gave them), and two ways to take things away: the current board as a one-page HTML you can
// send, and the current view as an SVG image.
(() => {
  const SC = window.Codemap;
  if (!SC) return;
  const G = SC.graph, h = SC.h;
  const LAYER_NAMES = { screen: 'Screens', ui: 'Interface parts', api: 'Endpoints and routes', middleware: 'Checks in front of requests', logic: 'Business logic and state', data: 'Data and storage', shared: 'Shared helpers', config: 'Settings', test: 'Tests', other: 'Other' };
  const ORDER = Object.keys(LAYER_NAMES);

  function layers() {
    const by = new Map();
    for (const f of G.files || []) { const k = f.ly || 'other'; if (!by.has(k)) by.set(k, []); by.get(k).push(f); }
    const rows = ORDER.filter((k) => by.has(k)).map((k) => `<a class="row" data-lens-layer="${k}"><span class="rt"><div class="rn">${h(LAYER_NAMES[k])} <span class="c">${by.get(k).length}</span></div><div class="rd">${h(by.get(k).slice(0, 4).map((f) => f.name).join(', '))}${by.get(k).length > 4 ? '…' : ''}</div></span></a>`).join('');
    const m = SC.modal({ title: 'Layers', html: `<p>The same files, grouped by the job they do rather than where they live. Pick a layer to see its files on a board.</p><div class="list">${rows}</div>` });
    m.el.addEventListener('click', (ev) => {
      const r = ev.target.closest('[data-lens-layer]');
      if (!r) return;
      m.close();
      const k = r.dataset.lensLayer;
      SC.showBoard({ title: LAYER_NAMES[k], question: `Files in the ${LAYER_NAMES[k].toLowerCase()} layer`, items: by.get(k).slice(0, 24).map((f) => ({ id: 'f:' + f.p, note: f.d || '' })), kind: 'Layer', icon: 'layers' });
    });
  }

  function domains() {
    const by = new Map();
    for (const f of G.flows || []) { const d = f.domain || 'General'; if (!by.has(d)) by.set(d, []); by.get(d).push(f); }
    const html = [...by].map(([d, fs]) => `<div class="sec"><h3>${h(d)} <span class="c">${fs.length}</span></h3><div class="list">${fs.map((f) => `<a class="row" data-lens-flow="${h(f.id)}"><span class="rt"><div class="rn">${h(f.title)}</div>${f.description ? `<div class="rd">${h(f.description)}</div>` : ''}</span></a>`).join('')}</div></div>`).join('');
    const m = SC.modal({ title: 'Business domains', html: `<p>What the app does, grouped by area of the business. Pick a flow to watch it step by step.</p>${html}` });
    m.el.addEventListener('click', (ev) => {
      const r = ev.target.closest('[data-lens-flow]');
      if (!r) return;
      m.close();
      const f = (G.flows || []).find((x) => x.id === r.dataset.lensFlow);
      if (f) SC.playFlow({ title: f.title, description: f.description, steps: f.steps.map((s) => ({ ref: s.ref, note: s.note })) });
    });
  }

  const download = (name, text, type) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  const slug = (s) => String(s || 'codemap').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'codemap';

  /** The board on screen (an answer, a trace, recent work) as one page: the answer first, then each card with where it lives. */
  function savePage() {
    const a = SC.state.answer;
    if (!a) { SC.toast('Open a board first (an answer, a traced flow or recent work), then save it.'); return; }
    const where = (id) => { const i = SC.info(id) || {}; return i.path || (id.startsWith('r:') ? `${G.routes[+id.slice(2)]?.m} ${G.routes[+id.slice(2)]?.p} · ${G.routes[+id.slice(2)]?.f}:${G.routes[+id.slice(2)]?.l}` : ''); };
    const commit = (G.meta?.repos || []).map((r) => r.head && `${r.path === '.' ? '' : r.path + '@'}${r.head.slice(0, 8)}`).filter(Boolean).join(', ');
    const items = a.items.map((x, n) => `<li><b>${h(SC.info(x.id)?.name || x.id)}</b>${x.note ? ` — ${h(x.note)}` : ''}<br><code>${h(where(x.id))}</code></li>`).join('');
    const steps = (a.steps || []).length ? `<h2>Step by step</h2><ol>${a.steps.map((s) => `<li><b>${h(SC.info(s.id)?.name || s.id)}</b>${s.note ? ` — ${h(s.note)}` : ''} <code>${h(where(s.id))}</code></li>`).join('')}</ol>` : '';
    const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${h(a.title)}</title>
<style>:root{color-scheme:light dark;--bg:#fff;--fg:#1b1b1b;--mut:#666;--line:#e3e3e3}@media (prefers-color-scheme:dark){:root{--bg:#141414;--fg:#eee;--mut:#9a9a9a;--line:#2c2c2c}}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 Inter,system-ui,sans-serif}main{max-width:760px;margin:0 auto;padding:40px 20px}h1{font-size:28px;margin:0 0 6px}p.q{color:var(--mut);margin:0 0 24px}li{margin:0 0 12px}code{font:12.5px ui-monospace,Menlo,monospace;color:var(--mut)}.ans{border-left:3px solid #5b8def;padding:4px 0 4px 16px;margin:0 0 28px}footer{margin-top:40px;border-top:1px solid var(--line);padding-top:12px;color:var(--mut);font-size:13px}</style></head>
<body><main><h1>${h(a.title)}</h1>${a.question ? `<p class="q">${h(a.question)}</p>` : ''}${a.answer ? `<div class="ans">${SC.md(a.answer)}</div>` : ''}<h2>What's involved</h2><ol>${items}</ol>${steps}
<footer>From the Codemap map of ${h(G.project?.name || '')}, built ${h(G.meta?.generatedAt || '')}${commit ? ` at ${h(commit)}` : ''}. Worked out from the code's structure, not by running it.</footer></main></body></html>`;
    download(`${slug(a.title)}.html`, page, 'text/html');
  }

  /** The board on screen as a 1200×630 picture (a share card): title, question, and its steps or cards as a path. */
  function saveCard() {
    const a = SC.state.answer;
    if (!a) { SC.toast('Open a board first (an answer, a traced flow or recent work), then save it.'); return; }
    const W = 1200, H = 630, c = document.createElement('canvas');
    c.width = W * 2; c.height = H * 2;
    const g = c.getContext('2d');
    if (!g) return;
    g.scale(2, 2);
    const css = getComputedStyle(document.documentElement);
    const v = (name, d) => (css.getPropertyValue(name) || '').trim() || d;
    const bg = getComputedStyle(document.body).backgroundColor || '#fff', fg = v('--text', '#111'), mut = v('--text-3', '#888'), acc = v('--accent', '#5b8def'), card = v('--card', '#fff'), line = v('--line', '#ddd');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    const font = (w, s) => `${w} ${s}px Inter, system-ui, sans-serif`;
    const fit = (text, max, size, weight = 600) => { g.font = font(weight, size); let t = String(text || ''); while (t.length > 3 && g.measureText(t).width > max) t = t.slice(0, -2); return t === String(text || '') ? t : t.replace(/.$/, '…'); };
    g.fillStyle = acc; g.fillRect(56, 56, 6, 64);
    g.fillStyle = fg; g.font = font(700, 40); g.fillText(fit(a.title, W - 160, 40, 700), 80, 96);
    if (a.question) { g.fillStyle = mut; g.font = font(400, 20); g.fillText(fit(a.question, W - 160, 20, 400), 80, 128); }
    const list = (a.steps?.length ? a.steps : a.items).slice(0, 8);
    const cols = Math.min(4, list.length), rows = Math.ceil(list.length / cols);
    const bw = (W - 112 - (cols - 1) * 36) / cols, bh = 110, top = 190;
    list.forEach((x, i) => {
      const r = Math.floor(i / cols), col = r % 2 ? cols - 1 - (i % cols) : i % cols; // snake, so the path reads on
      const x0 = 56 + col * (bw + 36), y0 = top + r * (bh + 46);
      g.fillStyle = card; g.strokeStyle = i === 0 ? acc : line; g.lineWidth = 2;
      g.beginPath(); g.roundRect ? g.roundRect(x0, y0, bw, bh, 14) : g.rect(x0, y0, bw, bh); g.fill(); g.stroke();
      g.fillStyle = acc; g.font = font(700, 15); g.fillText(String(i + 1), x0 + 16, y0 + 28);
      g.fillStyle = fg; g.font = font(600, 19); g.fillText(fit(SC.info(x.id)?.name || x.id, bw - 56, 19), x0 + 40, y0 + 28);
      g.fillStyle = mut; g.font = font(400, 14);
      const words = String(x.note || '').split(/\s+/); let ln = '', ly = y0 + 56;
      for (const w of words) { if (g.measureText(ln + ' ' + w).width > bw - 32 && ln) { g.fillText(ln, x0 + 16, ly); ly += 19; ln = w; if (ly > y0 + bh - 10) break; } else ln = ln ? ln + ' ' + w : w; }
      if (ly <= y0 + bh - 10 && ln) g.fillText(fit(ln, bw - 32, 14, 400), x0 + 16, ly);
      if (i < list.length - 1) {
        g.strokeStyle = acc; g.lineWidth = 2; g.beginPath();
        const nextRow = Math.floor((i + 1) / cols) !== r;
        if (nextRow) { g.moveTo(x0 + bw / 2, y0 + bh); g.lineTo(x0 + bw / 2, y0 + bh + 46); }
        else { const dir = r % 2 ? -1 : 1; const sx = dir > 0 ? x0 + bw : x0; g.moveTo(sx, y0 + bh / 2); g.lineTo(sx + dir * 36, y0 + bh / 2); }
        g.stroke();
      }
    });
    if (rows > 2) { g.fillStyle = mut; g.font = font(400, 14); g.fillText(`+ more on the map`, 56, H - 70); }
    g.fillStyle = mut; g.font = font(400, 15);
    g.fillText(fit(`${G.project?.name || ''} · Codemap map · worked out from the code's structure`, W - 112, 15, 400), 56, H - 36);
    c.toBlob((b) => { if (!b) return; const u = URL.createObjectURL(b); const l = document.createElement('a'); l.href = u; l.download = `${slug(a.title)}.png`; document.body.appendChild(l); l.click(); l.remove(); setTimeout(() => URL.revokeObjectURL(u), 2000); }, 'image/png');
  }

  /** The current view as an SVG image, with the map's own styles inside so it looks the same when opened alone. */
  function saveSvg() {
    const svg = document.getElementById('svg');
    if (!svg) return;
    const copy = svg.cloneNode(true);
    const css = [...document.querySelectorAll('style')].map((s) => s.textContent).join('\n');
    const box = svg.getBoundingClientRect();
    copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    copy.setAttribute('width', Math.round(box.width));
    copy.setAttribute('height', Math.round(box.height));
    const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
    style.textContent = css;
    copy.insertBefore(style, copy.firstChild);
    const bg = getComputedStyle(document.body).backgroundColor;
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('width', '100%'); rect.setAttribute('height', '100%'); rect.setAttribute('fill', bg);
    copy.insertBefore(rect, style.nextSibling);
    download(`${slug(G.project?.name)}-map.svg`, new XMLSerializer().serializeToString(copy), 'image/svg+xml');
  }

  {
    SC.addHeaderButton({ id: 'fp-layers', label: 'Layers', title: 'See the files by the job they do', onClick: layers });
    if ((G.flows || []).some((f) => f.domain)) SC.addHeaderButton({ id: 'fp-domains', label: 'Domains', title: 'Flows grouped by area of the business', onClick: domains });
    SC.addHeaderButton({ id: 'fp-save', label: 'Save', title: 'Save the board on screen as a page, or the view as an image', onClick: () => {
      const m = SC.modal({ title: 'Save', html: '<p>Take something away from the map.</p>', actions: [
        { label: 'This board as a page', primary: true, onClick: () => savePage() },
        { label: 'This board as a picture (PNG card)', onClick: () => saveCard() },
        { label: 'This view as an image (SVG)', onClick: () => saveSvg() },
      ] });
      return m;
    } });
  }
  window.CodemapLenses = { layers, domains, savePage, saveSvg, saveCard };
})();
