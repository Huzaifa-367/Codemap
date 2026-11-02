// "Follow it" on any file or endpoint: what it relies on (downstream), what relies on it (upstream), its
// functions with their callers, and a traced flow from here down to the data, each as a board on the map.
// Everything comes from graph.json (imports, web requests, function calls); nothing runs the code.
(() => {
  const SC = window.Codemap;
  if (!SC) return;
  const G = SC.graph, h = SC.h;
  const routeIndex = new Map((G.routes || []).map((r, i) => [`${r.m} ${r.p}|${r.f}`, i]));
  const fileOf = (id) => id.startsWith('f:') ? id.slice(2) : id.startsWith('r:') ? G.routes[+id.slice(2)]?.f : null;

  /** Files reached from a file through imports and requests, one direction, nearest first. */
  function reach(start, dir) {
    const adj = new Map();
    for (const l of G.links || []) {
      if (!l.a.startsWith('f:') || !(l.b.startsWith('f:') || l.b.startsWith('n:'))) continue;
      const [x, y] = dir === 'down' ? [l.a, l.b] : [l.b, l.a];
      if (!adj.has(x)) adj.set(x, []);
      adj.get(x).push({ to: y, via: l.k, label: l.labels?.[0] });
    }
    const seen = new Map([[start, 0]]), out = [], queue = [start];
    while (queue.length && out.length < 24) {
      const x = queue.shift();
      for (const e of adj.get(x) || []) {
        if (seen.has(e.to)) continue;
        seen.set(e.to, seen.get(x) + 1);
        const d = seen.get(e.to);
        const how = e.via === 'http' ? (dir === 'down' ? `sends ${e.label || 'a request'}` : `receives ${e.label || 'a request'} from here`) : dir === 'down' ? 'used' : 'uses it';
        out.push({ id: e.to, note: `${d === 1 ? 'Directly' : `${d} steps away`}: ${how}` });
        if (e.to.startsWith('f:')) queue.push(e.to);
      }
    }
    return out;
  }

  /** A traced flow as a board: its cards in order, with a step-by-step walkthrough. */
  function traceBoard(start, title) {
    if (typeof traceReport !== 'function') return;
    const r = traceReport(G, start, { depth: 8 });
    if (r.error || !r.trees?.length) { SC.toast?.('Nothing to follow from here: no calls or requests found.'); return; }
    const { steps: st, edges } = traceToCards(G, r.trees);
    const steps = st.map((x) => ({ id: x.ref, note: x.note })).filter((x) => SC.exists(x.id));
    if (steps.length < 2) { SC.toast?.('Nothing to follow from here: no calls or requests found.'); return; }
    // each card once on the board (with every role it plays), the walkthrough in order
    const byId = new Map();
    for (const st of steps) { const x = byId.get(st.id); if (x) { if (!x.note.includes(st.note)) x.note += ` · ${st.note}`; } else byId.set(st.id, { ...st }); }
    SC.showBoard({ title, question: `Followed from ${start} through function calls and web requests`, items: [...byId.values()].slice(0, 24), steps: steps.slice(0, 40), edges, kind: 'Flow', icon: 'flow' });
  }

  /** A file's functions drawn as boxes, with the functions in other files that call them (left) and that they
   * call (right), and arrows for every call. Click a box from another file to go to that file. */
  function functionMap(p) {
    const f = (G.files || []).find((x) => x.p === p);
    const fns = f?.fn || [];
    if (!fns.length) return;
    const name = (q) => (G.files || []).find((x) => x.p === q)?.name || q.split('/').pop();
    const key = (q, i) => `${q}#${i}`;
    const left = new Map(), right = new Map(), edges = [];
    for (const [fp, fi, tp, ti, , loose] of G.calls || []) {
      if (tp === p && fp !== p) { left.set(key(fp, fi), [fp, fi]); edges.push([key(fp, fi), key(tp, ti), loose]); }
      if (fp === p && tp !== p) { right.set(key(tp, ti), [tp, ti]); edges.push([key(fp, fi), key(tp, ti), loose]); }
      if (fp === p && tp === p) edges.push([key(fp, fi), key(tp, ti), loose]);
    }
    const cap = (m) => [...m.values()].slice(0, 18);
    const cols = [cap(left), fns.map((_, i) => [p, i]).slice(0, 30), cap(right)];
    const W = 760, BW = 220, BH = 34, GAP = 10, X = [10, (W - BW) / 2, W - BW - 10];
    const pos = new Map();
    cols.forEach((col, c) => col.forEach(([q, i], r) => pos.set(key(q, i), { x: X[c], y: 30 + r * (BH + GAP), q, i, c })));
    const H = 40 + Math.max(...cols.map((c) => c.length), 1) * (BH + GAP);
    const label = (q, i) => { const d = (G.files.find((x) => x.p === q)?.fn || [])[i] || ['?']; return / \//.test(d[0]) ? d[0] : `${d[0]}()`; };
    const lines = edges.filter(([a, b]) => pos.has(a) && pos.has(b)).map(([a, b, loose]) => {
      const A = pos.get(a), B = pos.get(b);
      if (A.c === 1 && B.c === 1) { const x = A.x + BW, y1 = A.y + BH / 2, y2 = B.y + BH / 2, bend = x + 26 + Math.min(60, Math.abs(y2 - y1) / 6); return `<path d="M${x} ${y1} C${bend} ${y1} ${bend} ${y2} ${x} ${y2}" fill="none" stroke="var(--text-3,#999)" stroke-width="1.2"${loose ? ' stroke-dasharray="4 3"' : ''} marker-end="url(#fp-arr)"/>`; }
      const x1 = A.x + BW, y1 = A.y + BH / 2, x2 = B.x, y2 = B.y + BH / 2, mx = (x1 + x2) / 2;
      return `<path d="M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}" fill="none" stroke="var(--accent,#5b8def)" stroke-width="1.3"${loose ? ' stroke-dasharray="4 3"' : ''} marker-end="url(#fp-arr)"/>`;
    }).join('');
    const boxes = [...pos.values()].map(({ x, y, q, i, c }) => `<g ${c !== 1 ? `data-go="f:${h(q)}" style="cursor:pointer"` : ''}><rect x="${x}" y="${y}" width="${BW}" height="${BH}" rx="8" fill="var(--card,#fff)" stroke="${c === 1 ? 'var(--accent,#5b8def)' : 'var(--line,#ccc)'}"/><text x="${x + 10}" y="${y + 14}" font-size="12" font-weight="600" fill="var(--text,#111)">${h(label(q, i)).slice(0, 34)}</text><text x="${x + 10}" y="${y + 27}" font-size="10.5" fill="var(--text-3,#888)">${h(c === 1 ? `lines ${fns[i][1]}–${fns[i][2]}` : name(q)).slice(0, 38)}</text></g>`).join('');
    const heads = ['Called from', name(p), 'Calls'].map((t, c) => `<text x="${X[c]}" y="18" font-size="11" fill="var(--text-2,#666)">${h(t)}</text>`).join('');
    const svg = `<div style="overflow:auto;max-height:65vh"><svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Functions of ${h(name(p))} and the calls between them"><defs><marker id="fp-arr" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L8 4L0 8z" fill="var(--text-3,#999)"/></marker></defs>${heads}${lines}${boxes}</svg></div><p style="font-size:12px;margin-top:8px">Dashed: matched by name only. Worked out from the code's text, not by running it.</p>`;
    const m = (SC.modal || SC.showModal)?.({ title: `Functions in ${name(p)}`, html: svg });
    if (m?.el) { m.el.style.width = 'min(820px, 100%)'; m.el.addEventListener('click', (ev) => { const g = ev.target.closest('[data-go]'); if (g) { m.close(); SC.go(g.dataset.go); } }); }
  }

  document.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-follow]');
    if (!b) return;
    ev.preventDefault();
    const { follow, start, title } = b.dataset;
    if (follow === 'trace') return traceBoard(start, title);
    if (follow === 'fnmap') return functionMap(start);
    if (follow === 'fncards') { if (!SC.technical?.()) SC.setTechnical?.(true); return SC.go('f:' + start); }
    const items = reach(start, follow);
    if (!items.length) { SC.toast?.(follow === 'down' ? 'It doesn’t rely on anything else on the map.' : 'Nothing on the map uses it.'); return; }
    SC.showBoard({ title, question: follow === 'down' ? 'Everything it relies on, through imports and web requests' : 'Everything that relies on it, through imports and web requests', items, kind: follow === 'down' ? 'Relies on' : 'Used by', icon: 'link' });
  });

  SC.addPanelSection('item', (id) => {
    const p = fileOf(id);
    if (!p) return '';
    const f = SC.files?.get ? SC.files.get(p) : (G.files || []).find((x) => x.p === p);
    const name = SC.info(id)?.name || p;
    const start = id.startsWith('r:') ? `${G.routes[+id.slice(2)].m} ${G.routes[+id.slice(2)].p}` : p;
    const btn = (follow, label, title, s = 'f:' + p) => `<button type="button" class="btn soft" data-follow="${follow}" data-start="${h(s)}" data-title="${h(title)}">${h(label)}</button>`;
    // functions in this file, busiest first, each a flow you can follow
    const calls = G.calls || [];
    const fns = (f?.fn || []).map(([n, a, b], i) => ({ n, a, b, i, in: calls.filter((c) => c[2] === p && c[3] === i).length, out: calls.filter((c) => c[0] === p && c[1] === i).length }));
    const list = fns.filter((x) => x.in || x.out).sort((x, y) => (y.in + y.out) - (x.in + x.out)).slice(0, 12);
    return {
      html: `<div class="sec"><h3>Follow it</h3><div style="display:flex;flex-wrap:wrap;gap:6px;margin:4px 0 8px">
        ${btn('down', 'What it relies on', `What ${name} relies on`)}${btn('up', 'What relies on it', `What relies on ${name}`)}${btn('trace', 'Trace the flow', `Flow from ${name}`, start)}${(f?.fn || []).length ? btn('fnmap', 'Functions map', `Functions in ${name}`, p) + btn('fncards', 'Functions on the map', `Functions in ${name}`, p) : ''}
      </div>${list.length ? `<div class="list">${list.map((x) => `<a class="row" data-follow="trace" data-start="${h(`${p}#${x.n}`)}" data-title="${h(`Flow from ${x.n}()`)}"><span class="rt"><div class="rn">${h(/ \//.test(x.n) ? x.n : x.n + '()')}</div><div class="rd">lines ${x.a}–${x.b} · called from ${x.in} place${x.in === 1 ? '' : 's'} · calls ${x.out}</div></span></a>`).join('')}</div>` : ''}</div>`,
    };
  });
})();
