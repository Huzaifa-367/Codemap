// Flows and impact, computed from a built map (graph.json) alone: no files, no git, no tokens. Shared by the
// skill's trace.mjs / impact.mjs, the map's own codemap/query.mjs (for agents in later sessions) and the viewer.
// Keep this file free of imports: build.mjs inlines it (without the `export` keywords) into those places.

/**
 * Follow a flow from a screen, an endpoint, a file, file#function or words, through function calls, a screen's
 * state holder, and web requests to the handlers that answer them. args: { depth, app, json, mermaid, save }.
 * Returns { out, trees } | { error } | { save, out } (save: a Flows entry to add to custom-flows.json).
 */
/** A step's facts in plain words: "sends cart_id, notes · checks cart_id (required, uuid) · writes orders". */
export function factsText(x) {
  const list = (a, n = 6) => a.slice(0, n).join(', ') + (a.length > n ? ', …' : '');
  const parts = [];
  if (x.sends?.length) parts.push(`sends ${list(x.sends)}`);
  if (x.checks) parts.push(`checks ${list(x.checks.map((c) => c.replace(/^([^:]+):\s*(.+)$/, '$1 ($2)')), 4)}`);
  if (x.reads) parts.push(`reads ${list(x.reads)}`);
  if (x.writes) parts.push(`writes ${list(x.writes)}`);
  if (x.fires) parts.push(`fires ${list(x.fires)}`);
  if (x.queues) parts.push(`queues ${list(x.queues)}`);
  if (x.emails) parts.push(`emails ${list(x.emails)}`);
  if (x.notifies) parts.push(`notifies ${list(x.notifies)}`);
  if (x.calls) parts.push(`calls ${list(x.calls)}`);
  if (x.returns) parts.push(`returns ${list(x.returns)}`);
  return parts.join(' · ');
}

export function traceReport(G, start, args = {}) {
  // deep enough for screen -> state holder -> repository -> client -> request -> handler -> service -> event -> listener -> mail
  const maxDepth = Math.max(1, Math.min(24, Number(args.depth) || 14));

  // ---------- indexes ----------
  const files = new Map(G.files.map((f) => [f.p, f]));
  const nodes = new Map(G.nodes.map((n) => [n.id, n]));
  const partOf = (p) => { let n = nodes.get(files.get(p)?.n); while (n?.parent) n = nodes.get(n.parent); return n?.label || 'Unassigned'; };
  const fnsOf = (p) => files.get(p)?.fn || [];
  const key = (p, i) => `${p}#${i}`;
  const fnAt = (k) => { const [p, i] = [k.slice(0, k.lastIndexOf('#')), +k.slice(k.lastIndexOf('#') + 1)]; return { p, i, d: fnsOf(p)[i] }; };
  /** The innermost function of a file covering a line. */
  const fnCovering = (p, line) => { let best = -1; fnsOf(p).forEach(([, a, b], i) => { if (line >= a && line <= b && (best < 0 || a >= fnsOf(p)[best][1])) best = i; }); return best; };
  /** A line inside a function, or an annotation just above it that no other function holds (Retrofit @POST("orders")). */
  const inFn = (p, d, line) => (line >= d[1] && line <= d[2]) || (line < d[1] && line >= d[1] - 3 && fnCovering(p, line) < 0);
  const callsFrom = new Map();
  for (const [fp, fi, tp, ti, line, loose] of G.calls || []) {
    const k = key(fp, fi);
    if (!callsFrom.has(k)) callsFrom.set(k, []);
    callsFrom.get(k).push({ to: key(tp, ti), line, loose: !!loose });
  }
  // requests: per calling file, [{ line, route }]
  const requestsIn = new Map();
  for (const l of G.links || []) {
    if (l.k !== 'http' || !l.a.startsWith('f:')) continue;
    const p = l.a.slice(2);
    for (const [ri, line] of l.calls || []) if (ri != null && G.routes[ri]) { if (!requestsIn.has(p)) requestsIn.set(p, []); requestsIn.get(p).push({ line, ri }); }
  }
  // what happens inside each function: fields sent, checked, returned (graph.facts; rules and responses held by a
  // form request / DTO / resource class come from graph.classFacts), plus the tables and effects found in its body
  const factsOf = new Map((G.facts || []).map(([p, fi, x]) => [key(p, fi), x]));
  const stepFacts = (k) => {
    const { p, d } = fnAt(k);
    const x = { ...(factsOf.get(k) || {}) };
    const cls = G.classFacts || {};
    if (x.checksWith && cls[x.checksWith]?.checks) x.checks = cls[x.checksWith].checks;
    if (x.returnsWith && cls[x.returnsWith]?.returns) x.returns = cls[x.returnsWith].returns;
    delete x.checksWith; delete x.returnsWith;
    const inSpan = (line) => line >= d[1] && line <= d[2];
    const uniq = (a) => [...new Set(a)];
    const reads = uniq((tableUses.get(p) || []).filter((u) => inSpan(u.line) && u.how !== 'write').map((u) => u.table));
    const writes = uniq((tableUses.get(p) || []).filter((u) => inSpan(u.line) && u.how === 'write').map((u) => u.table));
    if (reads.length) x.reads = reads;
    if (writes.length) x.writes = writes;
    for (const [kind, word] of [['event', 'fires'], ['job', 'queues'], ['mail', 'emails'], ['notify', 'notifies'], ['outside', 'calls']]) { const v = uniq((effectsOf.get(k) || []).filter((e) => e.kind === kind).map((e) => e.name)); if (v.length) x[word] = v; }
    return Object.keys(x).length ? x : null;
  };
  // what each function sets off: events, jobs, mail, notifications, outside services (graph.effects)
  const effectsOf = new Map();
  for (const [p, fi, kind, name, line, to] of G.effects || []) { const k = key(p, fi); if (!effectsOf.has(k)) effectsOf.set(k, []); effectsOf.get(k).push({ kind, name, line, to: to || [] }); }
  // tables a file reads or writes, by line (graph.tables usedBy), for flows that end at the data
  const tableUses = new Map();
  for (const t of G.tables || []) for (const [p, how, line] of t.usedBy || []) { if (!tableUses.has(p)) tableUses.set(p, []); tableUses.get(p).push({ table: t.name, how, line }); }
  const outsideOf = (p) => [...new Set((G.links || []).filter((l) => l.a === 'f:' + p && l.b.startsWith('n:') && nodes.get(l.b.slice(2))?.kind === 'external').map((l) => nodes.get(l.b.slice(2)).label))];
  /** The handler class's file: one that declares the class (imported by the route file first), else one named after it. */
  const classFile = (r) => {
    const imported = new Set((G.links || []).filter((l) => l.k === 'import' && l.a === 'f:' + r.f && l.b.startsWith('f:')).map((l) => l.b.slice(2)));
    const declares = G.files.filter((f) => (f.s || []).some((x) => x[0] === r.hc && /^(class|struct|record|object)$/.test(x[1] || 'class')));
    const named = G.files.filter((f) => f.p.split('/').pop().replace(/\.[^.]+$/, '') === r.hc);
    for (const list of [declares.filter((f) => imported.has(f.p)), named.filter((f) => imported.has(f.p)), declares, named]) if (list.length === 1 || (list.length && list === declares)) return list[0].p;
    return null;
  };
  const VERBS = /^(get|post|put|patch|delete|head|list|create|retrieve|update|partial_update|destroy|index|store|show|edit)$/;
  /** The functions that answer an endpoint, as keys: a controller / view-class method (or each HTTP-verb method when the
   * route names only the class), a function in a file the route file imports, or one in the route's own file. */
  const handlerKeys = (r) => {
    if (r.hc) {
      const cf = classFile(r);
      if (cf) {
        if (r.h && r.h !== '*') { const i = fnsOf(cf).findIndex(([n]) => n === r.h); if (i >= 0) return [key(cf, i)]; }
        else { const ks = fnsOf(cf).map(([n], i) => [n, i]).filter(([n]) => VERBS.test(n)).map(([, i]) => key(cf, i)); if (ks.length) return ks; }
      }
    }
    const i = handlerOf(r);
    if (i >= 0) return [key(r.f, i)];
    if (r.h && r.h !== '*') for (const l of G.links || []) if (l.k === 'import' && l.a === 'f:' + r.f && l.b.startsWith('f:')) { const j = fnsOf(l.b.slice(2)).findIndex(([n]) => n === r.h); if (j >= 0) return [key(l.b.slice(2), j)]; }
    return [];
  };
  const handlerKey = (r) => handlerKeys(r)[0] || null;
  /** The function that answers an endpoint: its named handler, or the route's own inline body. */
  const handlerOf = (r) => {
    const fns = fnsOf(r.f);
    let i = r.h ? fns.findIndex(([n, a]) => n === r.h && a >= r.l - 1 && a - r.l <= 15) : -1;
    if (i < 0 && r.h) i = fns.findIndex(([n]) => n === r.h);
    if (i < 0) i = fnCovering(r.f, r.l);
    if (i < 0) i = fns.findIndex(([, a]) => a >= r.l && a - r.l <= 12);
    return i;
  };

  // ---------- where to start ----------
  const roots = []; // { kind, label, keys[] }
  const rm = /^([A-Za-z]+)\s+(\/\S*)$/.exec(start);
  if (rm) {
    for (const [ri, r] of G.routes.entries()) if (r.m === rm[1].toUpperCase() && r.p === rm[2]) roots.push({ kind: 'endpoint', label: `${r.m} ${r.p}`, route: ri });
  } else if (start.startsWith('/')) {
    for (const s of G.screens || []) if (s.url === start && (!args.app || (nodes.get(s.app)?.label || '').toLowerCase().includes(String(args.app).toLowerCase()))) roots.push({ kind: 'screen', label: `${s.name} (${s.url}, ${nodes.get(s.app)?.label || s.app})`, file: s.file });
  } else if (start.includes('#') && files.has(start.split('#')[0])) {
    const [p, name] = start.split('#');
    const i = fnsOf(p).findIndex(([n]) => n === name);
    if (i >= 0) roots.push({ kind: 'function', label: `${name}() in ${p}`, keys: [key(p, i)] });
  } else if (files.has(start)) roots.push({ kind: 'file', label: `${files.get(start).name} (${start})`, file: start });
  if (!roots.length) {
    // words: a screen, an endpoint or a function whose name says it
    const q = start.toLowerCase();
    const scr = (G.screens || []).find((s) => s.name.toLowerCase().includes(q) || s.url.toLowerCase().includes(q));
    const rt = G.routes.findIndex((r) => (r.name || '').toLowerCase().includes(q) || r.p.toLowerCase().includes(q));
    let fn = null;
    for (const f of G.files) { const i = (f.fn || []).findIndex(([n]) => n.toLowerCase().includes(q)); if (i >= 0) { fn = key(f.p, i); break; } }
    if (scr) roots.push({ kind: 'screen', label: `${scr.name} (${scr.url}, ${nodes.get(scr.app)?.label || scr.app})`, file: scr.file });
    else if (rt >= 0) roots.push({ kind: 'endpoint', label: `${G.routes[rt].m} ${G.routes[rt].p}`, route: rt });
    else if (fn) roots.push({ kind: 'function', label: `${fnAt(fn).d[0]}() in ${fnAt(fn).p}`, keys: [fn] });
  }
  if (!roots.length) return { error: `Nothing on the map matches "${start}". Try a screen URL, "METHOD /path", a file path or file#function.` };

  // ---------- follow it ----------
  let budget = 400;
  const seen = new Set();
  function fnNode(k, depth, via) {
    const { p, i, d } = fnAt(k);
    const node = { type: 'function', name: d[0], file: p, line: d[1], part: partOf(p), ...(via ? { via } : {}), children: [] };
    const facts = stepFacts(k);
    if (facts) node.facts = facts;
    if (seen.has(k)) { node.repeat = true; return node; }
    seen.add(k);
    if (depth >= maxDepth || --budget <= 0) { node.more = true; return node; }
    const kids = [];
    for (const c of callsFrom.get(k) || []) kids.push({ line: c.line, make: () => fnNode(c.to, depth + 1, c.loose ? 'calls (by name)' : 'calls') });
    for (const r of requestsIn.get(p) || []) if (inFn(p, d, r.line)) kids.push({ line: r.line, make: () => endpointNode(r.ri, depth + 1) });
    for (const u of tableUses.get(p) || []) if (u.line >= d[1] && u.line <= d[2]) kids.push({ line: u.line, make: () => ({ type: 'table', name: u.table, how: u.how, children: [] }) });
    for (const e of effectsOf.get(k) || []) kids.push({ line: e.line, make: () => ({ type: e.kind, name: e.name, line: e.line, file: p, children: e.to.map(([q, j]) => fnNode(key(q, j), depth + 1, e.kind === 'event' ? 'listened to by' : e.kind === 'job' ? 'run by' : 'handled by')) }) });
    kids.sort((a, b) => a.line - b.line);
    for (const kd of kids.slice(0, 16)) node.children.push(kd.make());
    if (!node.children.length) for (const o of outsideOf(p)) node.children.push({ type: 'outside', name: o, children: [] });
    return node;
  }
  function endpointNode(ri, depth) {
    const r = G.routes[ri];
    const node = { type: 'endpoint', name: `${r.m} ${r.p}`, title: r.name, file: r.f, line: r.l, part: partOf(r.f), children: [] };
    for (const h of handlerKeys(r).slice(0, 4)) node.children.push(fnNode(h, depth, 'handled by'));
    return node;
  }
  const STATE_HOLDER = /(view_?models?|viewmodel|blocs?|cubits?|controllers?|stores?|presenters?|notifiers?|providers?|state|interactors?)[^/]*\.(dart|kt|swift|ts|tsx|js|jsx)$|\/(view_?models?|blocs?|cubits?|stores?|presenters?|state)\//i;
  const seenFiles = new Set();
  const depthOf = (n) => n._depth || 0;
  function fileNode(p, depth = 0) {
    seenFiles.add(p);
    const fns = fnsOf(p);
    // where a screen or file starts: its functions that call something, in file order (the rest are leaves)
    const busy = fns.map((_, i) => key(p, i)).filter((k) => (callsFrom.get(k) || []).length || (requestsIn.get(p) || []).some((r) => inFn(p, fnAt(k).d, r.line)));
    const node = { type: 'file', name: files.get(p)?.name || p, file: p, part: partOf(p), children: [] };
    Object.defineProperty(node, '_depth', { value: depth, enumerable: false });
    // start only where the file's work begins: functions no other function in the file calls (helpers are reached
    // through them), those that reach out of the file first (another file, a request, a table), at most 6; the rest
    // are named so they can be traced one by one
    const inside = (k) => fnAt(k).p === p;
    const calledHere = new Set(busy.flatMap((k) => (callsFrom.get(k) || []).map((c) => c.to).filter((t) => t !== k && inside(t))));
    const span = (k) => fnAt(k).d;
    const leaves = (k) => (callsFrom.get(k) || []).some((c) => !inside(c.to))
      || [...(requestsIn.get(p) || []), ...(tableUses.get(p) || [])].some((r) => r.line >= span(k)[1] && r.line <= span(k)[2]);
    // a request in a function's own body, or in a function it calls (a generated route helper, an API client)
    const asks = (k, hops = 2) => (requestsIn.get(fnAt(k).p) || []).some((r) => inFn(fnAt(k).p, fnAt(k).d, r.line))
      || (hops > 0 && (callsFrom.get(k) || []).some((c) => c.to !== k && asks(c.to, hops - 1)));
    const entries = busy.filter((k) => !calledHere.has(k));
    const ranked = [...entries.filter((k) => asks(k)), ...entries.filter((k) => !asks(k) && leaves(k)), ...entries.filter((k) => !asks(k) && !leaves(k))];
    // an Inertia page: first the route that renders it (the controller loads its data), then what the page does
    const screen = depth === 0 && (G.screens || []).find((s) => s.file === p && s.fw === 'inertia');
    const ri = screen ? G.routes.findIndex((r) => r.p === screen.url && (r.m === 'GET' || r.m === 'ANY')) : -1;
    if (ri >= 0) { const e = endpointNode(ri, 1); e.via = 'gets its data from'; node.children.push(e); }
    const picked = new Set(ranked.slice(0, 6));
    const also = ranked.slice(6).map((k) => fnAt(k).d[0]);
    if (also.length) node.also = also;
    // functions that lead to a request first, then requests made outside any function (module-level, or in code
    // not read as a function), then the rest of the functions; each request once
    const order = entries.length ? entries : busy;
    for (const k of order) if (picked.has(k) && !seen.has(k) && asks(k)) node.children.push(fnNode(k, depth + 1));
    const shown = new Set(ri >= 0 ? [ri] : []);
    for (const r of requestsIn.get(p) || []) if (fnCovering(p, r.line) < 0 && !shown.has(r.ri)) { shown.add(r.ri); node.children.push(endpointNode(r.ri, 1)); }
    for (const k of order) if (picked.has(k) && !seen.has(k) && !asks(k)) node.children.push(fnNode(k, depth + 1));
    // a screen whose work happens in its state holder (view model, bloc, controller, store…): continue there
    if (depthOf(node) === 0) for (const l of G.links || []) {
      if (l.k !== 'import' || l.a !== 'f:' + p || !l.b.startsWith('f:')) continue;
      const q = l.b.slice(2);
      if (!STATE_HOLDER.test(q) || seenFiles.has(q)) continue;
      seenFiles.add(q);
      const sub = fileNode(q, 1);
      if (sub.children.length) { sub.via = 'keeps its state in'; node.children.push(sub); }
    }
    if (!node.children.length) for (const o of outsideOf(p)) node.children.push({ type: 'outside', name: o, children: [] });
    return node;
  }
  const trees = roots.map((r) => ({ start: r.label, kind: r.kind, tree: r.kind === 'endpoint' ? endpointNode(r.route, 0) : r.file ? fileNode(r.file) : fnNode(r.keys[0], 0) }));

  // ---------- where it starts: from a function or endpoint, back up to the screens / entry points that reach it ----------
  // through callers, the requests that reach a handler's endpoint, and the events / jobs that run a listener or job
  const callersOf = new Map();
  for (const [kf, list] of callsFrom) for (const c of list) { if (!callersOf.has(c.to)) callersOf.set(c.to, []); callersOf.get(c.to).push(kf); }
  const routesOf = new Map();
  (G.routes || []).forEach((r, ri) => { for (const h of handlerKeys(r)) { if (!routesOf.has(h)) routesOf.set(h, []); routesOf.get(h).push(ri); } });
  const requestersOf = new Map(); // route -> caller keys
  for (const [p, list] of requestsIn) for (const r of list) { const i = fnCovering(p, r.line); if (!requestersOf.has(r.ri)) requestersOf.set(r.ri, []); requestersOf.get(r.ri).push(i >= 0 ? key(p, i) : 'f:' + p); }
  const triggersOf = new Map(); // listener / job key -> [{ from, label }]
  for (const [p, fi, kind, name, , to] of G.effects || []) for (const [q, j] of to || []) { const k = key(q, j); if (!triggersOf.has(k)) triggersOf.set(k, []); triggersOf.get(k).push({ from: key(p, fi), label: `${kind === 'event' ? 'event' : 'job'} ${name}` }); }
  const screenOf = new Map((G.screens || []).map((s) => [s.file, s]));
  const fnLabel = (k) => `${fnAt(k).d[0]}()`;
  function upstream(startKey, limit = 6) {
    const paths = [];
    const walk = (k, chain, seen, depth) => {
      if (paths.length >= limit) return;
      const p = k.startsWith('f:') ? k.slice(2) : fnAt(k).p;
      const scr = screenOf.get(p);
      if (scr) { paths.push([`${scr.name} (${scr.url})`, ...chain]); return; }
      const ups = [];
      if (!k.startsWith('f:')) {
        for (const c of callersOf.get(k) || []) ups.push({ k: c, step: fnLabel(c) });
        for (const ri of routesOf.get(k) || []) for (const c of requestersOf.get(ri) || []) ups.push({ k: c, step: c.startsWith('f:') ? files.get(c.slice(2))?.name || c.slice(2) : fnLabel(c), via: `${G.routes[ri].m} ${G.routes[ri].p}` });
        for (const t of triggersOf.get(k) || []) ups.push({ k: t.from, step: fnLabel(t.from), via: t.label });
      }
      const fresh = ups.filter((u) => !seen.has(u.k));
      if (!fresh.length || depth > 14) { if (chain.length) paths.push([`${k.startsWith('f:') ? files.get(p)?.name || p : `${fnLabel(k)} in ${p}`} (where it starts)`, ...chain.slice(1)]); return; }
      for (const u of fresh.slice(0, 4)) walk(u.k, [u.step, ...(u.via ? [u.via] : []), ...chain], new Set([...seen, u.k]), depth + 1);
    };
    walk(startKey, [fnLabel(startKey)], new Set([startKey]), 0);
    return paths;
  }
  for (const t of trees) {
    const r = roots.find((x) => x.label === t.start);
    const k = r?.keys?.[0] || (r?.kind === 'endpoint' ? handlerKey(G.routes[r.route]) : null);
    if (k) { const up = upstream(k); if (up.length) t.upstream = up; }
  }

  // ---------- report ----------
  const count = (n) => 1 + n.children.reduce((s, c) => s + count(c), 0);
  const crossing = (n, part = n.part, acc = new Set()) => { if (n.part) acc.add(n.part); n.children.forEach((c) => crossing(c, part, acc)); return acc; };
  if (args.json) return { out: JSON.stringify({ start, depth: maxDepth, flows: trees }, null, 2), trees };

  if (args.mermaid) {
    const ids = new Map();
    const pid = (n) => { const label = n.type === 'outside' ? n.name : n.type === 'table' ? `table ${n.name}` : `${n.part}: ${files.get(n.file)?.name || n.file}`; if (!ids.has(label)) ids.set(label, `p${ids.size}`); return ids.get(label); };
    const lines = [];
    const walk = (n) => { for (const c of n.children) {
      const msg = c.type === 'endpoint' ? c.name : c.type === 'outside' ? 'uses' : c.type === 'table' ? (c.how === 'write' ? 'writes' : 'reads') : `${c.name}()`;
      if (c.type === 'function' && c.via === 'handled by' && n.type === 'endpoint') { walk(c); continue; }
      lines.push(`  ${pid(n)}->>${pid(c)}: ${msg.replace(/[;#]/g, ' ')}`);
      walk(c);
    } };
    for (const t of trees) {
      if (t.tree.type === 'function') pid(t.tree);
      // starting at an endpoint: show the caller knocking on it, then its handler's work
      if (t.tree.type === 'endpoint') { ids.set('Caller', 'caller'); for (const h of t.tree.children) { lines.push(`  caller->>${pid(h)}: ${t.tree.name}`); walk(h); } continue; }
      walk(t.tree);
    }
    return { out: ['sequenceDiagram', ...[...ids].map(([label, id]) => `  participant ${id} as ${label.replace(/[;#:]/g, ' ').replace(/\s+/g, ' ')}`), ...lines].join('\n') };
  }

  if (typeof args.save === 'string' || args.save === true) {
    // the flow, in order, as Flows steps on the map (same-file steps folded together)
    const steps = [];
    const sym = (p, name) => (files.get(p)?.s || []).some((s) => s[0] === name);
    const push = (ref, note) => { if (steps.length && steps[steps.length - 1].ref === ref) { steps[steps.length - 1].note += ` · ${note}`; return; } steps.push({ ref, note }); };
    const walk = (n) => {
      if (n.type === 'file') push(`f:${n.file}`, `${n.name}: where it starts`);
      if (n.type === 'function') push(sym(n.file, n.name) ? `sym:${n.file}#${n.name}` : `f:${n.file}`, `${n.name}()${n.via === 'handled by' ? ' answers the request' : ''}`);
      if (n.type === 'endpoint') push(`route:${n.name}${G.routes.filter((r) => `${r.m} ${r.p}` === n.name).length > 1 ? ` @ ${n.file}` : ''}`, `${n.name}: the request reaches the server`);
      n.children.forEach(walk);
    };
    trees.forEach((t) => walk(t.tree));
    if (steps.length < 2) return { error: 'That flow has fewer than two steps, so there is nothing to save.' };
    const title = typeof args.save === 'string' ? args.save : `Trace: ${start}`;
    const id = 'trace-' + title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
    return { save: { id, title, description: `Traced from ${start} through calls and requests on the map.`, steps: steps.slice(0, 40), createdAt: new Date().toISOString() }, out: `Saved "${title}" (${Math.min(40, steps.length)} steps) to codemap/custom-flows.json. Rebuild the map to see it under Flows.` };
  }

  const L = [];
  const line = (n, pre, parentChecks) => {
    const where = n.file ? `  ${n.file}${n.line ? ':' + n.line : ''}` : '';
    const what = n.type === 'endpoint' ? `→ ${n.name}${n.title ? ` (${n.title})` : ''} [request, ${n.part}]`
      : n.type === 'outside' ? `→ uses ${n.name}`
      : n.type === 'event' ? `→ fires event ${n.name}${n.children.length ? '' : ' (no listener found)'}`
      : n.type === 'job' ? `→ queues job ${n.name} (runs in the background)`
      : n.type === 'mail' ? (/^an? /.test(n.name) ? `→ sends ${n.name}` : `→ sends email ${n.name}`)
      : n.type === 'notify' ? `→ sends notification ${n.name}`
    : n.type === 'table' ? `→ ${n.how === 'write' ? 'writes' : 'reads'} table ${n.name}`
      : n.type === 'file' ? `${n.via ? `${n.via} ` : ''}${n.name} [${n.part}]`
      : `${n.via === 'calls (by name)' ? '~ ' : n.via === 'listened to by' ? 'listener: ' : n.via === 'run by' ? 'job: ' : ''}${/ \//.test(n.name) ? `handler of ${n.name}` : `${n.name}()`}${n.repeat ? ' (shown above)' : ''}${n.more ? ' …' : ''}`;
    L.push(`${pre}${what}${['endpoint', 'outside', 'table', 'event', 'job', 'mail', 'notify'].includes(n.type) ? '' : where}`);
    // (tables, events, jobs and outside calls show as their own steps below; this line adds what data moves)
    if (n.facts && !n.repeat) { const same = (a, b) => a && b && a.join('|') === b.join('|'); const t = factsText({ sends: n.facts.sends, checks: same(n.facts.checks, parentChecks) ? undefined : n.facts.checks, returns: n.facts.returns }); if (t) L.push(`${pre}    ↳ ${t}`); }
    n.children.forEach((c) => line(c, pre + '  ', n.facts?.checks || parentChecks));
    if (n.also) L.push(`${pre}  (also starts here: ${n.also.slice(0, 12).map((x) => `${x}()`).join(', ')}${n.also.length > 12 ? ', …' : ''}; trace ${n.file}#name to follow one)`);
  };
  for (const t of trees) {
    const parts = [...crossing(t.tree)];
    if (t.upstream) { L.push(`STARTED FROM (how ${t.start} is reached)`); for (const u of t.upstream) L.push(`  ${u.join(' → ')}`); L.push(''); }
    L.push(`FLOW from ${t.start}: ${count(t.tree)} steps across ${parts.length === 1 ? parts[0] : parts.join(' → ')}`);
    line(t.tree, '  ');
    L.push('');
  }
  L.push('"~" = matched by name only. Followed through calls between functions and web requests on the map, not by running the code.');
  return { out: L.join('\n'), trees };

}

/**
 * What a change touches: changed files (paths relative to the root) -> users through imports and requests (across
 * apps), endpoints and their callers, screens, Health issues. args: { depth, base, json, markdown }.
 */
export function impactReport(G, changed, args = {}) {
  const maxDepth = Math.max(1, Math.min(6, Number(args.depth) || 3));

  // ---------- 1. what changed ----------
  const unmapped = [];
  const fileByPath = new Map(G.files.map((f) => [f.p, f]));
  const nodeById = new Map(G.nodes.map((n) => [n.id, n]));
  const changedFiles = [];
  for (const p of changed) {
    if (p.startsWith('codemap/') || p.includes('/codemap/')) continue;
    if (fileByPath.has(p)) changedFiles.push(p); else unmapped.push(p);
  }

  // ---------- 2. who uses what: reverse links between files ----------
  const usedBy = new Map(); // file -> [{ from, via, label }]
  for (const l of G.links || []) {
    if (!l.a.startsWith('f:') || !l.b.startsWith('f:')) continue;
    const to = l.b.slice(2), from = l.a.slice(2);
    if (!usedBy.has(to)) usedBy.set(to, []);
    usedBy.get(to).push({ from, via: l.k, label: l.labels?.[0] || null });
  }
  const reached = new Map(); // file -> { depth, via, from, label }
  const queue = changedFiles.map((p) => { reached.set(p, { depth: 0 }); return p; });
  while (queue.length) {
    const p = queue.shift();
    const d = reached.get(p).depth;
    if (d >= maxDepth) continue;
    for (const u of usedBy.get(p) || []) {
      if (reached.has(u.from)) continue;
      reached.set(u.from, { depth: d + 1, via: u.via, from: p, label: u.label });
      queue.push(u.from);
    }
  }

  // ---------- 3. endpoints, screens, Health ----------
  const partOf = (p) => { let n = nodeById.get(fileByPath.get(p)?.n); while (n?.parent) n = nodeById.get(n.parent); return n?.label || 'Unassigned'; };
  const changedSet = new Set(changedFiles);
  const endpoints = (G.routes || []).map((r, i) => ({ ...r, i })).filter((r) => changedSet.has(r.f));
  // requests from other files to a changed endpoint: the callers most likely to break
  const callersOf = (r) => (G.links || []).filter((l) => l.k === 'http' && l.b === 'f:' + r.f && (l.calls || []).some(([ri]) => ri === r.i)).map((l) => l.a.slice(2));
  const endpointList = endpoints.map((r) => ({ method: r.m, path: r.p, name: r.name, file: r.f, callers: [...new Set(callersOf(r))].map((p) => ({ file: p, part: partOf(p) })) }));
  const screens = (G.screens || []).filter((s) => reached.has(s.file) || (s.behind || []).some((b) => b.id.startsWith('f:') && changedSet.has(b.id.slice(2))))
    .map((s) => ({ name: s.name, url: s.url, app: nodeById.get(s.app)?.label || s.app, file: s.file, direct: changedSet.has(s.file) }));
  const health = (G.health?.issues || []).filter((i) => (i.locations || []).some((l) => changedSet.has(l.file)))
    .map((i) => ({ severity: i.severity, title: i.title, files: [...new Set(i.locations.map((l) => l.file).filter((f) => changedSet.has(f)))] }));
  const affected = [...reached].filter(([, v]) => v.depth > 0).sort((a, b) => a[1].depth - b[1].depth || a[0].localeCompare(b[0]))
    .map(([p, v]) => ({ file: p, name: fileByPath.get(p)?.name || p, part: partOf(p), depth: v.depth, via: v.via, because: v.from, ...(v.label ? { request: v.label } : {}) }));
  const parts = [...new Set([...changedFiles, ...affected.map((a) => a.file)].map(partOf))];
  const crossApp = affected.filter((a) => a.via === 'http' && partOf(a.because) !== a.part);

  const result = {
    base: typeof args.base === 'string' ? args.base : null,
    graphBuiltAt: G.meta?.generatedAt,
    changed: changedFiles.map((p) => ({ file: p, name: fileByPath.get(p)?.name || p, part: partOf(p) })),
    notOnMap: unmapped,
    affected,
    endpoints: endpointList,
    screens,
    health,
    summary: {
      changedFiles: changedFiles.length,
      affectedFiles: affected.length,
      parts,
      endpointsChanged: endpointList.length,
      callersInOtherApps: crossApp.length,
      screens: screens.length,
      healthIssues: health.length,
    },
  };

  // ---------- 4. report ----------
  if (args.json) return { out: JSON.stringify(result, null, 2), result };
  const L = [];
  const md = !!args.markdown;
  const h = (s) => L.push(md ? `### ${s}` : s.toUpperCase());
  const item = (s) => L.push(md ? `- ${s}` : `  ${s}`);
  const code = (s) => (md ? '`' + s + '`' : s);
  L.push(md ? `## Codemap impact${result.base ? ` since \`${result.base}\`` : ' of uncommitted changes'}` : `Codemap impact${result.base ? ` since ${result.base}` : ' of uncommitted changes'} (map built ${result.graphBuiltAt})`);
  if (!changedFiles.length) {
    L.push(unmapped.length ? `No changed file is on the map (${unmapped.length} changed outside it, e.g. ${unmapped.slice(0, 3).join(', ')}).` : 'Nothing has changed.');
    return { out: L.join('\n'), result };
  }
  const changedParts = [...new Set(changedFiles.map(partOf))];
  const otherParts = parts.filter((x) => !changedParts.includes(x));
  L.push(`${changedFiles.length} changed file(s) in ${changedParts.join(', ')}; ${affected.length} more file(s) use them${otherParts.length ? ` (also in ${otherParts.join(', ')})` : ''}${crossApp.length ? `, ${crossApp.length} of them in another app through web requests` : ''}.`);
  L.push('');
  h('Changed');
  for (const c of result.changed.slice(0, 30)) item(`${c.name} — ${code(c.file)} (${c.part})`);
  if (endpointList.length) {
    L.push(''); h('Endpoints in changed files');
    for (const e of endpointList) item(`${code(`${e.method} ${e.path}`)} ${e.name ? `— ${e.name}` : ''}${e.callers.length ? `; called from ${e.callers.map((c) => `${code(c.file)} (${c.part})`).join(', ')}` : ''}`);
  }
  if (affected.length) {
    L.push(''); h(`May be affected (up to ${maxDepth} steps away)`);
    for (const a of affected.slice(0, 40)) item(`${a.name} — ${code(a.file)} (${a.part}): ${a.via === 'http' ? `calls ${a.request || 'an endpoint'} in` : 'uses'} ${code(a.because)}${a.depth > 1 ? `, ${a.depth} steps away` : ''}`);
    if (affected.length > 40) item(`… ${affected.length - 40} more`);
  }
  if (screens.length) { L.push(''); h('Screens to re-check'); for (const s of screens.slice(0, 20)) item(`${s.name} ${code(s.url)} in ${s.app}${s.direct ? ' (changed itself)' : ''}`); }
  if (health.length) { L.push(''); h('Health issues in changed files'); for (const i of health) item(`[${i.severity}] ${i.title} — ${i.files.map(code).join(', ')}`); }
  if (unmapped.length) { L.push(''); L.push(`${unmapped.length} changed file(s) aren't on the map (config, docs, tests or new folders${G.meta?.generatedAt ? '; update the codemap to include new code' : ''}).`); }
  L.push('');
  L.push(md ? '_Worked out from imports and web requests on the map, not by running the code._' : 'Worked out from imports and web requests on the map, not by running the code.');
  return { out: L.join('\n'), result };

}

/** The data model as a Mermaid erDiagram (tables, columns with keys, references) plus who uses each table. */
export function erdReport(G, args = {}) {
  const tables = (G.tables || []).filter((t) => !t.inferred || args.all);
  if (!tables.length) return { out: 'No tables found: the map reads SQL migrations (CREATE TABLE) and Prisma schemas.' };
  if (args.json) return { out: JSON.stringify(G.tables, null, 1) };
  const id = (n) => n.replace(/[^A-Za-z0-9_]/g, '_');
  const L = ['erDiagram'];
  for (const t of tables) {
    L.push(`  ${id(t.name)} {`);
    for (const [c, type, key] of (t.columns || []).slice(0, 40)) L.push(`    ${String(type).replace(/[^A-Za-z0-9_]/g, '_') || 'text'} ${id(c)}${key ? ` ${key.toUpperCase()}` : ''}`);
    L.push('  }');
  }
  const names = new Set(tables.map((t) => t.name));
  for (const t of tables) for (const [col, to] of t.refs || []) if (names.has(to)) L.push(`  ${id(to)} ||--o{ ${id(t.name)} : "${col}"`);
  if (args.mermaid) return { out: L.join('\n') };
  const U = tables.filter((t) => t.usedBy?.length).map((t) => `${t.name}: ${[...new Set(t.usedBy.map(([p, how]) => `${p} (${how})`))].slice(0, 6).join(', ')}`);
  return { out: L.join('\n') + (U.length ? '\n\nUsed by:\n' + U.join('\n') : '') };
}

/** What changed between two maps (an older snapshot and now): parts, files, endpoints, screens, tables, links between parts. */
export function deltaReport(OLD, G, args = {}) {
  const set = (arr, key) => new Set((arr || []).map(key));
  const diff = (a, b) => ({ added: [...b].filter((x) => !a.has(x)), removed: [...a].filter((x) => !b.has(x)) });
  const top = (g, p) => { const nodes = new Map(g.nodes.map((n) => [n.id, n])); let n = nodes.get((g.files.find((f) => f.p === p) || {}).n); while (n?.parent) n = nodes.get(n.parent); return n?.label || '?'; };
  const partLinks = (g) => new Set((g.links || []).filter((l) => l.a.startsWith('f:') && l.b.startsWith('f:')).map((l) => `${top(g, l.a.slice(2))} → ${top(g, l.b.slice(2))} (${l.k === 'http' ? 'requests' : 'uses'})`).filter((k) => !/^(\S.*) → \1 /.test(k) && k.split(' → ')[0] !== k.split(' → ')[1].replace(/ \((requests|uses)\)$/, '')));
  const d = {
    since: OLD.meta?.generatedAt, now: G.meta?.generatedAt,
    parts: diff(set(OLD.nodes, (n) => n.label), set(G.nodes, (n) => n.label)),
    files: diff(set(OLD.files, (f) => f.p), set(G.files, (f) => f.p)),
    endpoints: diff(set(OLD.routes, (r) => `${r.m} ${r.p}`), set(G.routes, (r) => `${r.m} ${r.p}`)),
    screens: diff(set(OLD.screens, (s) => s.url + ' ' + s.file), set(G.screens, (s) => s.url + ' ' + s.file)),
    tables: diff(set(OLD.tables, (t) => t.name), set(G.tables, (t) => t.name)),
    connections: diff(partLinks(OLD), partLinks(G)),
    functions: { before: (OLD.files || []).reduce((n, f) => n + (f.fn?.length || 0), 0), after: (G.files || []).reduce((n, f) => n + (f.fn?.length || 0), 0) },
  };
  if (args.json) return { out: JSON.stringify(d, null, 1), delta: d };
  const L = [`DELTA since the map of ${d.since} (now ${d.now})`];
  const sec = (t, x, cap = 20) => { if (!x.added.length && !x.removed.length) return; L.push(`${t}: +${x.added.length} −${x.removed.length}`); for (const a of x.added.slice(0, cap)) L.push(`  + ${a}`); for (const r of x.removed.slice(0, cap)) L.push(`  − ${r}`); };
  sec('Parts', d.parts); sec('Connections between parts', d.connections); sec('Endpoints', d.endpoints); sec('Screens', d.screens); sec('Tables', d.tables); sec('Files', d.files, 12);
  L.push(`Functions: ${d.functions.before} → ${d.functions.after}`);
  if (L.length === 2) L.push('Nothing structural changed.');
  return { out: L.join('\n'), delta: d };
}

/** Files by layer (API, screens, logic, data, …): the second lens on the same map. */
export function layersReport(G) {
  const by = new Map();
  for (const f of G.files || []) { const k = f.ly || 'other'; if (!by.has(k)) by.set(k, []); by.get(k).push(f); }
  const ORDER = ['screen', 'ui', 'api', 'middleware', 'logic', 'data', 'shared', 'config', 'test', 'other'];
  return { out: ORDER.filter((k) => by.has(k)).map((k) => `${k} (${by.get(k).length}): ${by.get(k).slice(0, 8).map((f) => f.p).join(', ')}${by.get(k).length > 8 ? ' …' : ''}`).join('\n'), layers: Object.fromEntries([...by].map(([k, v]) => [k, v.map((f) => f.p)])) };
}

/**
 * A traced flow as map cards: each function's own card (s:), each endpoint (r:), files where needed, in the
 * order they're reached, and the arrows the trace followed (parent -> child). Shared by the build (traced flows
 * under Flows) and the map (Follow it -> Trace the flow).
 */
export function traceToCards(G, trees) {
  const files = new Map(G.files.map((f) => [f.p, f]));
  const routeAt = new Map((G.routes || []).map((r, i) => [`${r.m} ${r.p}|${r.f}`, i]));
  const symId = (p, name, line) => {
    const f = files.get(p);
    if (!f) return null;
    let i = (f.s || []).findIndex((s) => s[0] === name && Math.abs((s[2] || 0) - line) <= 3);
    if (i < 0) i = (f.s || []).findIndex((s) => s[0] === name);
    return i >= 0 ? `s:${p}#${i}` : `f:${p}`;
  };
  const cardOf = (n) => n.type === 'endpoint' ? (routeAt.has(`${n.name}|${n.file}`) ? `r:${routeAt.get(`${n.name}|${n.file}`)}` : `f:${n.file}`)
    : n.type === 'function' ? (/ \//.test(n.name) ? (() => { const i = (G.routes || []).findIndex((r) => r.f === n.file && r.l === n.line); return i >= 0 ? `r:${i}` : `f:${n.file}`; })() : symId(n.file, n.name, n.line))
    : n.file ? `f:${n.file}` : null;
  const name = (p) => files.get(p)?.name || p;
  const steps = [], edges = [], seenEdge = new Set();
  const walk = (n, parent) => {
    let id = null, note = '';
    if (n.type === 'file') { id = cardOf(n); note = `${n.via ? `${n.via} ` : ''}${n.name}`; }
    if (n.type === 'function') { id = cardOf(n); note = `${/ \//.test(n.name) ? `answers ${n.name}` : `${n.name}()`} · ${name(n.file)}${n.via === 'calls (by name)' ? ' (likely)' : ''}`; }
    if (n.type === 'endpoint') { id = cardOf(n); note = `${n.name}: the request reaches the server`; }
    if (id) {
      const last = steps[steps.length - 1];
      if (last && last.ref === id) { if (!last.note.includes(note)) last.note += ` · ${note}`; } else if (!steps.some((s) => s.ref === id)) steps.push({ ref: id, note });
      if (parent && parent !== id && !seenEdge.has(parent + '>' + id)) { seenEdge.add(parent + '>' + id); edges.push([parent, id, n.type === 'endpoint' ? 'http' : 'call']); }
    }
    n.children.forEach((c) => walk(c, id || parent));
  };
  trees.forEach((t) => walk(t.tree, null));
  return { steps, edges };
}
