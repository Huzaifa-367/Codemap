#!/usr/bin/env node
// codemap builder: validate codemap/architecture.json against the scan, assign every file to a
// node, attach import/HTTP/external edges, and write codemap/graph.json + codemap/index.html.
//
// usage: node build.mjs [root] [--arch <file>] [--scan <file>] [--out <dir>] [--check]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileGlob, parseArgs, fmtNum, mapDir, keepOutOfGit } from './lib/common.mjs';
import { fallbackFileName, fallbackRouteName, routeKey, routeKeyer } from './lib/names.mjs';
import { traceReport, traceToCards } from './lib/flows.mjs';
import { buildHealth, withDismissed, dismissalFor } from './lib/health.mjs';
import { buildPlanHealth } from './lib/blueprint.mjs';
import { buildScreens } from './lib/screens.mjs';
import { writeClaudeMd } from './lib/claudemd.mjs';
import { detectAgent } from './lib/agent.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = path.resolve(HERE, '..');
const args = parseArgs(process.argv.slice(2));
const agent = detectAgent(args);
const root = path.resolve(args._[0] || '.');
const outDir = path.resolve(args.out || mapDir(root));
const archFile = path.resolve(args.arch || path.join(outDir, 'architecture.json'));
const scanFile = path.resolve(args.scan || path.join(outDir, '.cache', 'scan.json'));

export const NODE_KINDS = ['ui', 'service', 'worker', 'library', 'feature', 'data', 'config', 'test', 'script', 'infra', 'external'];
export const EDGE_KINDS = ['import', 'call', 'http', 'rpc', 'event', 'queue', 'data', 'config'];

const errors = [];
const warnings = [];
const err = (msg) => errors.push(msg);
const warn = (msg) => warnings.push(msg);

const fail = (msg) => { console.error(`✗ ${msg}`); process.exit(1); };
if (!fs.existsSync(scanFile)) fail(`No scan at ${scanFile}. Run: node ${path.join(SKILL_DIR, 'scripts', 'scan.mjs')} "${root}"`);
if (!fs.existsSync(archFile)) fail(`No architecture file at ${archFile}. Write it first (see references/schema.md).`);
const scan = JSON.parse(fs.readFileSync(scanFile, 'utf8'));
let arch;
try { arch = JSON.parse(fs.readFileSync(archFile, 'utf8')); } catch (e) { fail(`architecture.json is not valid JSON: ${e.message}`); }

// ---------- validate shape ----------
const isStr = (v) => typeof v === 'string' && v.length > 0;
const isStrArr = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string');
function closest(word, options) {
  let best = null, bestD = Infinity;
  for (const o of options) {
    const d = lev(word, o);
    if (d < bestD) { bestD = d; best = o; }
  }
  return bestD <= Math.max(2, word.length / 3) ? best : null;
}
function lev(a, b) {
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]; dp[0] = i;
    for (let j = 1; j <= b.length; j++) { const tmp = dp[j]; dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = tmp; }
  }
  return dp[b.length];
}
const didYouMean = (w, opts) => { const c = closest(w, opts); return c ? ` — did you mean "${c}"?` : ''; };

if (!arch || typeof arch !== 'object') fail('architecture.json must be an object');
if (!arch.project || !isStr(arch.project.name)) err('project.name is required');
if (!Array.isArray(arch.nodes) || !arch.nodes.length) err('nodes must be a non-empty array');
const nodes = Array.isArray(arch.nodes) ? arch.nodes : [];
const archEdges = Array.isArray(arch.edges) ? arch.edges : [];
const flows = Array.isArray(arch.flows) ? arch.flows : [];
const annotations = Array.isArray(arch.annotations) ? arch.annotations : [];
const include = isStrArr(arch.include) ? arch.include : ['code'];
const ignoreGlobs = (isStrArr(arch.ignore) ? arch.ignore : []).map(compileGlob);
// who the descriptions are written for: "everyone" (plain language, default) or "developers"
const AUDIENCES = ['everyone', 'developers'];
if (arch.audience !== undefined && !AUDIENCES.includes(arch.audience)) err(`audience "${arch.audience}" must be one of ${AUDIENCES.join(', ')}${didYouMean(String(arch.audience), AUDIENCES)}`);
const audience = AUDIENCES.includes(arch.audience) ? arch.audience : 'everyone';

const byId = new Map();
nodes.forEach((n, i) => {
  const where = `nodes[${i}]${n?.id ? ` ("${n.id}")` : ''}`;
  if (!n || typeof n !== 'object') return err(`${where} must be an object`);
  if (!isStr(n.id)) return err(`${where}.id is required`);
  if (!/^[A-Za-z0-9_.\-]+$/.test(n.id)) err(`${where}.id may only use letters, digits, "_", "-" and "."`);
  if (n.id === 'unassigned') err(`${where}.id "unassigned" is reserved`);
  if (byId.has(n.id)) err(`${where}.id duplicates an earlier node`);
  byId.set(n.id, n);
  if (!isStr(n.label)) err(`${where}.label is required`);
  if (!NODE_KINDS.includes(n.kind)) err(`${where}.kind "${n.kind}" must be one of ${NODE_KINDS.join(', ')}${didYouMean(String(n.kind), NODE_KINDS)}`);
  for (const k of ['paths', 'exclude', 'packages', 'hosts', 'tags']) if (n[k] !== undefined && !isStrArr(n[k])) err(`${where}.${k} must be an array of strings`);
  if (n.kind === 'external' && n.paths?.length) warn(`${where} is external but has paths; external nodes normally own no files`);
});
const ids = [...byId.keys()];
for (const n of nodes) {
  if (n?.parent === undefined) continue;
  if (!byId.has(n.parent)) err(`node "${n.id}".parent "${n.parent}" does not exist${didYouMean(n.parent, ids)}`);
}
// cycles + depth
const depthOf = new Map();
const depth = (id, seen = new Set()) => {
  if (depthOf.has(id)) return depthOf.get(id);
  if (seen.has(id)) { err(`node "${id}" is part of a parent cycle`); return 0; }
  seen.add(id);
  const n = byId.get(id);
  const d = n?.parent && byId.has(n.parent) ? depth(n.parent, seen) + 1 : 0;
  depthOf.set(id, d);
  return d;
};
ids.forEach((id) => depth(id));

// ---------- files ----------
const filesAll = scan.files;
const fileByPath = new Map(filesAll.map((f) => [f.path, f]));
const included = filesAll.filter((f) => include.includes(f.category) && !ignoreGlobs.some((g) => g.test(f.path)));
const includedSet = new Set(included.map((f) => f.path));

// ---------- assign files to nodes ----------
// A node's `exclude` also applies to its descendants, so "web excludes tests" holds all the way down.
const inheritedExcludes = (n, seen = new Set()) => {
  if (!n || seen.has(n.id)) return [];
  seen.add(n.id);
  return [...(isStrArr(n.exclude) ? n.exclude : []), ...(n.parent ? inheritedExcludes(byId.get(n.parent), seen) : [])];
};
const matchers = nodes.filter((n) => n?.id && isStrArr(n.paths ?? [])).map((n, order) => ({
  id: n.id, order, depth: depthOf.get(n.id) || 0,
  paths: (n.paths || []).map(compileGlob), exclude: inheritedExcludes(n).map(compileGlob), hits: new Array((n.paths || []).length).fill(0),
}));
const owner = new Map();
let ambiguous = 0;
const ambiguousEx = [];
for (const f of included) {
  let best = null, bestKey = null, tie = null;
  for (const m of matchers) {
    if (m.exclude.some((g) => g.test(f.path))) continue;
    let spec = -1;
    m.paths.forEach((g, i) => { if (g.test(f.path)) { m.hits[i]++; spec = Math.max(spec, g.specificity); } });
    if (spec < 0) continue;
    const key = [m.depth, spec];
    if (!best || key[0] > bestKey[0] || (key[0] === bestKey[0] && key[1] > bestKey[1])) { best = m; bestKey = key; tie = null; }
    else if (key[0] === bestKey[0] && key[1] === bestKey[1]) tie = m.id;
  }
  if (tie) { ambiguous++; if (ambiguousEx.length < 3) ambiguousEx.push(`${f.path} (${best.id} vs ${tie})`); }
  owner.set(f.path, best ? best.id : 'unassigned');
}
for (const m of matchers) m.hits.forEach((h, i) => { if (!h) warn(`node "${m.id}" path "${m.paths[i].glob}" matches no included file`); });
if (ambiguous) warn(`${ambiguous} file(s) matched two sibling nodes equally; the first declared won. Make globs more specific or add an exclude. e.g. ${ambiguousEx.join('; ')}`);

// ---------- endpoints ----------
const resolveEndpoint = (ref, where) => {
  if (!isStr(ref)) { err(`${where} must be a node id or file path`); return null; }
  if (byId.has(ref)) return `n:${ref}`;
  const p = ref.replace(/^file:/, '');
  if (includedSet.has(p)) return `f:${p}`;
  if (fileByPath.has(p)) { err(`${where} "${ref}" is a file that is not included (category ${fileByPath.get(p).category}); point at its node instead`); return null; }
  err(`${where} "${ref}" is neither a node id nor a scanned file${didYouMean(ref, ids)}`);
  return null;
};

// ---------- links ----------
const links = new Map(); // key -> link
const addLink = (a, b, k, extra = {}) => {
  if (!a || !b || a === b) return;
  const key = `${a}|${b}|${k}`;
  let l = links.get(key);
  if (!l) { l = { a, b, k, w: 0 }; links.set(key, l); }
  l.w += extra.w || 1;
  if (extra.names?.length) l.names = [...new Set([...(l.names || []), ...extra.names])].slice(0, 40);
  if (extra.label) { l.labels = l.labels || []; if (!l.labels.includes(extra.label) && l.labels.length < 40) l.labels.push(extra.label); }
  if (extra.inferred) l.inferred = true;
  if (extra.desc) l.desc = extra.desc;
  if (extra.route !== undefined) { l.calls = l.calls || []; if (l.calls.length < 80) l.calls.push([extra.route, extra.callLine || 0]); }
};

// ---------- routes ----------
const routeIdx = new Map();
const routesIn = scan.routes.filter((r) => includedSet.has(r.file));
// a route's key: "METHOD /path", plus "@ file" when two files define the same one; plain keys still find the first
const keyOf = routeKeyer(routesIn);
const routeLookup = new Map();
routesIn.forEach((r, i) => { routeLookup.set(keyOf(r), i); if (!routeLookup.has(routeKey(r))) routeLookup.set(routeKey(r), i); });
routesIn.forEach((r, i) => routeIdx.set(`${r.file}|${r.method}|${r.path}`, i));

for (const e of scan.edges) if (includedSet.has(e.from) && includedSet.has(e.to)) addLink(`f:${e.from}`, `f:${e.to}`, 'import', { w: e.count || 1, names: e.names });
for (const h of scan.http) if (includedSet.has(h.from) && includedSet.has(h.to)) addLink(`f:${h.from}`, `f:${h.to}`, 'http', { label: `${h.method} ${h.path}`, inferred: true, route: routeIdx.get(`${h.to}|${h.method}|${h.path}`), callLine: h.line });

// externals: packages / hosts claimed by nodes
const extIds = scan.externals.map((e) => e.id);
const pkgMatchers = nodes.filter((n) => n?.packages?.length).map((n) => ({ id: n.id, globs: n.packages.map((p) => compileGlob(p.includes(':') ? p : `*:${p}`)), hits: 0 }));
const hostMatchers = nodes.filter((n) => n?.hosts?.length).map((n) => ({ id: n.id, globs: n.hosts.map((h) => compileGlob(h.toLowerCase())), hits: 0 }));
for (const e of scan.extEdges) {
  if (!includedSet.has(e.from)) continue;
  const m = pkgMatchers.find((pm) => pm.globs.some((g) => g.test(e.pkg)));
  if (m) { m.hits++; addLink(`f:${e.from}`, `n:${m.id}`, 'import', { w: e.count, names: [e.pkg.split(':')[1]] }); }
}
for (const h of scan.hosts) {
  if (!includedSet.has(h.from)) continue;
  const m = hostMatchers.find((hm) => hm.globs.some((g) => g.test(h.host)));
  if (m) { m.hits++; addLink(`f:${h.from}`, `n:${m.id}`, 'http', { label: h.host, inferred: true }); }
}
for (const pm of pkgMatchers) if (!pm.hits) warn(`node "${pm.id}" packages match nothing imported. Known: ${extIds.slice(0, 8).join(', ')}…`);
for (const hm of hostMatchers) if (!hm.hits) warn(`node "${hm.id}" hosts match no host called from code`);

// a blueprint's planned links from files to outside services and data stores (plan.json "services"/"data")
for (const e of scan.nodeLinks || []) {
  if (!includedSet.has(e.from)) continue;
  if (!byId.has(e.to)) { err(`plan.json: "${e.from}" names "${e.to}" in its ${e.kind === 'data' ? 'data' : 'services'}, which is not a node id in architecture.json${didYouMean(e.to, ids)}`); continue; }
  addLink(`f:${e.from}`, `n:${e.to}`, EDGE_KINDS.includes(e.kind) ? e.kind : 'call', { label: e.label });
}

archEdges.forEach((e, i) => {
  const where = `edges[${i}]`;
  if (!EDGE_KINDS.includes(e?.kind)) err(`${where}.kind "${e?.kind}" must be one of ${EDGE_KINDS.join(', ')}${didYouMean(String(e?.kind), EDGE_KINDS)}`);
  const a = resolveEndpoint(e?.from, `${where}.from`);
  const b = resolveEndpoint(e?.to, `${where}.to`);
  if (a && b && EDGE_KINDS.includes(e.kind)) addLink(a, b, e.kind, { label: e.label, desc: e.description, w: 1 });
});

// ---------- flows + annotations ----------
const outFlows = [];
flows.forEach((fl, i) => {
  const where = `flows[${i}]`;
  if (!isStr(fl?.id) || !isStr(fl?.title)) err(`${where} needs id and title`);
  if (!Array.isArray(fl?.steps) || fl.steps.length < 2) { err(`${where}.steps needs at least 2 steps`); return; }
  const steps = fl.steps.map((s, j) => ({ ref: resolveEndpoint(s?.node, `${where}.steps[${j}].node`), note: s?.note || '' }));
  outFlows.push({ id: fl.id, title: fl.title, description: fl.description || '', ...(isStr(fl.domain) ? { domain: fl.domain } : {}), steps });
});
// Flows people requested from the map (saved by serve.mjs). Steps use stable refs —
// "route:METHOD /path" and "sym:<file>#<name>" — so they survive rebuilds; stale steps are dropped.
const customFile = path.join(outDir, 'custom-flows.json');
if (fs.existsSync(customFile)) {
  let custom = [];
  try { custom = JSON.parse(fs.readFileSync(customFile, 'utf8')).flows || []; } catch (e) { warn(`custom-flows.json is not valid JSON: ${e.message}`); }
  const routeAt = routeLookup;
  const resolveStep = (ref) => {
    if (typeof ref !== 'string') return null;
    if (ref.startsWith('route:')) { const i = routeAt.get(ref.slice(6)); return i == null ? null : `r:${i}`; }
    if (ref.startsWith('sym:')) {
      const [p, name] = [ref.slice(4, ref.lastIndexOf('#')), ref.slice(ref.lastIndexOf('#') + 1)];
      const i = (fileByPath.get(p)?.symbols || []).findIndex((s) => s.name === name);
      return includedSet.has(p) && i >= 0 ? `s:${p}#${i}` : null;
    }
    if (ref.startsWith('n:')) return byId.has(ref.slice(2)) ? ref : null;
    if (ref.startsWith('f:')) return includedSet.has(ref.slice(2)) ? ref : null;
    return null;
  };
  let dropped = 0;
  for (const fl of custom) {
    const steps = (fl.steps || []).map((s) => ({ ref: resolveStep(s.ref), note: s.note || '' })).filter((s) => s.ref);
    dropped += (fl.steps || []).length - steps.length;
    if (steps.length >= 2 && isStr(fl.id) && !outFlows.some((x) => x.id === fl.id)) outFlows.push({ id: fl.id, title: fl.title || 'Flow', description: fl.description || '', steps, custom: true });
  }
  if (dropped) warn(`${dropped} step(s) in custom-flows.json point at code that no longer exists and were left out.`);
}
// "Start here" tour: 3-8 narrated stops (node id or file path), written by Claude in architecture.json
const outTour = [];
if (arch.tour !== undefined) {
  if (!Array.isArray(arch.tour)) err('tour must be an array of { node, title, note }');
  else arch.tour.forEach((s, i) => {
    const ref = resolveEndpoint(s?.node, `tour[${i}].node`);
    if (ref) outTour.push({ ref, title: isStr(s.title) ? s.title : '', note: isStr(s.note) ? s.note : '' });
  });
}
// "Recent work": what Claude just changed, per task, framed against what the user asked for
// (codemap/recent-work.json, rewritten on every make/update). Stale refs are warnings, never errors.
let outRecent = null;
const recentFile = path.join(outDir, 'recent-work.json');
if (fs.existsSync(recentFile)) {
  let rw = null;
  try { rw = JSON.parse(fs.readFileSync(recentFile, 'utf8')); } catch (e) { warn(`recent-work.json is not valid JSON: ${e.message}`); }
  const routeIdx = routeLookup;
  const resolveRecent = (ref) => {
    if (!isStr(ref)) return null;
    const s = ref.trim().replace(/^\.\//, '').replace(/^(route:|file:)/, '');
    if (/^n:/.test(s)) return byId.has(s.slice(2)) ? s : null;
    if (/^f:/.test(s)) return includedSet.has(s.slice(2)) ? s : null;
    if (byId.has(s)) return 'n:' + s;
    if (includedSet.has(s)) return 'f:' + s;
    const m = /^([A-Za-z]+)\s+(\/\S*)(\s+@\s+\S+)?$/.exec(s);
    const k = m && `${m[1].toUpperCase()} ${m[2]}${m[3] ? ` @ ${m[3].replace(/^\s+@\s+/, '')}` : ''}`;
    if (k && routeIdx.has(k)) return `r:${routeIdx.get(k)}`;
    return null;
  };
  if (rw && !Array.isArray(rw.tasks)) warn('recent-work.json needs a "tasks" array (an empty one clears the highlights)');
  else if (rw) {
    const tasks = [], items = [], missing = [];
    rw.tasks.forEach((t, ti) => {
      if (!isStr(t?.title)) return warn(`recent-work.json tasks[${ti}] needs a title`);
      tasks.push({ title: t.title, request: isStr(t.request) ? t.request : '', summary: isStr(t.summary) ? t.summary : '', ...(isStr(t.status) ? { status: t.status } : {}) });
      for (const it of Array.isArray(t.items) ? t.items : []) {
        const id = resolveRecent(it?.ref);
        if (!id) { missing.push(it?.ref); continue; }
        items.push({ id, task: tasks.length - 1, change: it.change === 'new' ? 'new' : 'changed', note: isStr(it.note) ? it.note : '' });
      }
    });
    if (missing.length) warn(`recent-work.json: ${missing.length} ref(s) aren't on the map and were left out (use a file path, a node id or "METHOD /path"): ${missing.slice(0, 5).map(String).join(', ')}${missing.length > 5 ? '…' : ''}`);
    outRecent = { updatedAt: isStr(rw.updatedAt) ? rw.updatedAt : fs.statSync(recentFile).mtime.toISOString(), tasks, items };
  }
}
const notes = new Map();
annotations.forEach((a, i) => {
  if (!isStr(a?.path) || !isStr(a?.note)) return err(`annotations[${i}] needs path and note`);
  if (!includedSet.has(a.path)) return err(`annotations[${i}].path "${a.path}" is not an included file`);
  notes.set(a.path, { note: a.note, tags: isStrArr(a.tags) ? a.tags : undefined });
});
for (const ep of arch.project?.entrypoints || []) if (!includedSet.has(ep)) warn(`project.entrypoints "${ep}" is not an included file`);

// ---------- names + descriptions (codemap/descriptions/*.json) ----------
const descDir = path.join(outDir, 'descriptions');
const fileDesc = new Map(), routeDesc = new Map(), flowStory = new Map();
const routeKeys = new Set([...routeLookup.keys()]);
let staleFiles = 0, staleRoutes = 0;
const staleEx = [];
if (fs.existsSync(descDir)) {
  for (const name of fs.readdirSync(descDir).filter((n) => n.endsWith('.json')).sort()) {
    let d;
    try { d = JSON.parse(fs.readFileSync(path.join(descDir, name), 'utf8')); } catch (e) { err(`descriptions/${name} is not valid JSON: ${e.message}`); continue; }
    for (const [p, v] of Object.entries(d.files || {})) {
      if (!v || typeof v !== 'object') { err(`descriptions/${name}: files["${p}"] must be { name, description }`); continue; }
      if (!includedSet.has(p)) { staleFiles++; if (staleEx.length < 3) staleEx.push(p); continue; }
      if (fileDesc.get(p)?.d && !isStr(v.description)) continue;
      fileDesc.set(p, { name: isStr(v.name) ? v.name.trim() : null, d: isStr(v.description) ? v.description.trim() : null, review: isStr(v.review) ? v.review : null });
    }
    // the agent's plain-language story of a traced flow (describe.mjs writes the worksheet): { flows: { id: { story } } }
    for (const [id, v] of Object.entries(d.flows || {})) if (v && isStr(v.story)) flowStory.set(id, v.story.trim());
    for (const [k, v] of Object.entries(d.routes || {})) {
      if (!v || typeof v !== 'object') { err(`descriptions/${name}: routes["${k}"] must be { name, description }`); continue; }
      if (!routeKeys.has(k)) { staleRoutes++; continue; }
      if (routeDesc.get(k)?.d && !isStr(v.description)) continue; // an empty skeleton entry never hides a written one
      routeDesc.set(k, { name: isStr(v.name) ? v.name.trim() : null, d: isStr(v.description) ? v.description.trim() : null, review: isStr(v.review) ? v.review : null });
    }
  }
}
if (staleFiles) warn(`${staleFiles} described file(s) no longer exist or aren't included (e.g. ${staleEx.join(', ')}). Remove them from descriptions/.`);
if (staleRoutes) warn(`${staleRoutes} described route(s) no longer match a route in the scan; remove or re-key them.`);

// ---------- stats ----------
const unassigned = included.filter((f) => owner.get(f.path) === 'unassigned');
const stats = new Map([...ids, 'unassigned'].map((id) => [id, { files: 0, loc: 0, langs: {}, repos: new Set() }]));
for (const f of included) {
  let id = owner.get(f.path);
  while (id) {
    const s = stats.get(id);
    s.files++; s.loc += f.loc; s.langs[f.lang || f.category] = (s.langs[f.lang || f.category] || 0) + f.loc;
    if (f.repo !== null) s.repos.add(f.repo);
    id = id === 'unassigned' ? null : byId.get(id)?.parent;
  }
}

// ---------- report ----------
const pct = included.length ? (unassigned.length / included.length) * 100 : 0;
const report = [];
if (errors.length) {
  report.push(`✗ ${errors.length} error(s) in ${path.relative(root, archFile)}${scan.blueprint ? ' or plan.json' : ''}:`);
  for (const e of errors) report.push(`  - ${e}`);
}
if (warnings.length) {
  report.push(`! ${warnings.length} warning(s):`);
  for (const w of warnings.slice(0, 40)) report.push(`  - ${w}`);
}
report.push('');
report.push(`ASSIGNMENT  ${included.length} files (${include.join('+')}), ${unassigned.length} unassigned (${pct.toFixed(1)}%)`);
for (const n of nodes.filter((n) => n?.id && !n.parent)) {
  const s = stats.get(n.id);
  report.push(`  ${n.id.padEnd(28)} ${String(s.files).padStart(5)} files ${scan.blueprint ? '' : `${fmtNum(s.loc).padStart(6)} loc  `}[${n.kind}]`);
}
if (unassigned.length) {
  const byDir = new Map();
  for (const f of unassigned) { const d = f.path.split('/').slice(0, -1).join('/') || '.'; byDir.set(d, (byDir.get(d) || 0) + 1); }
  report.push(`  unassigned, by directory:`);
  for (const [d, c] of [...byDir.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) report.push(`    ${String(c).padStart(4)}  ${d}/`);
}
const byKind = {};
for (const l of links.values()) byKind[l.k] = (byKind[l.k] || 0) + 1;
report.push(`LINKS  ${[...links.values()].length} (${Object.entries(byKind).map(([k, v]) => `${k} ${v}`).join(', ')})`);
const describedFiles = included.filter((f) => fileDesc.get(f.path)?.d || f.desc).length;
const descOf = (r) => routeDesc.get(keyOf(r)) || routeDesc.get(routeKey(r));
const describedRoutes = routesIn.filter((r) => descOf(r)?.d || r.desc).length;
const noSummary = nodes.filter((n) => n?.id && !isStr(n.summary)).map((n) => n.id);
const reviewCount = [...fileDesc.values(), ...routeDesc.values()].filter((d) => d.review).length;
report.push(`DESCRIPTIONS  files ${describedFiles}/${included.length} · routes ${describedRoutes}/${routesIn.length} · modules ${nodes.length - noSummary.length}/${nodes.length}${reviewCount ? ` · ${reviewCount} need review (code changed)` : ''}`);
if (noSummary.length) report.push(`  modules without a summary: ${noSummary.slice(0, 12).join(', ')}${noSummary.length > 12 ? '…' : ''}`);
if (describedFiles < included.length || describedRoutes < routesIn.length || reviewCount) report.push(`  Run describe.mjs to get worksheets for the ${included.length - describedFiles} file(s) and ${routesIn.length - describedRoutes} route(s) still missing descriptions.`);

// --json: one object an agent can act on without parsing prose (Archify-style repair receipts): every error and
// warning with the setting it concerns, the suggested fix when there is one, and the coverage numbers
const receipt = () => ({
  ok: !errors.length,
  errors: errors.map((m) => ({ where: /^([\w.\[\]"\- ()]+?)(?:\s|\.|:)/.exec(m)?.[1] || null, message: m, ...(/did you mean "([^"]+)"/.exec(m) ? { fix: `use "${/did you mean "([^"]+)"/.exec(m)[1]}"` } : {}) })),
  warnings,
  coverage: { files: included.length, unassigned: unassigned.length, unassignedPct: +pct.toFixed(1), unassignedDirs: [...new Map(unassigned.map((f) => [f.path.split('/').slice(0, -1).join('/') || '.', 0])).keys()].slice(0, 15), describedFiles, describedRoutes, routes: routesIn.length, modulesWithoutSummary: noSummary },
});
if (args.json && (errors.length || args.check)) { console.log(JSON.stringify(receipt(), null, 1)); process.exit(errors.length ? 1 : 0); }
if (errors.length) { console.log(report.join('\n')); console.log('\nFix the errors above and run build again.'); process.exit(1); }
if (args.check) { console.log(report.join('\n')); process.exit(0); }

// ---------- write graph.json + index.html ----------
const graph = {
  schema: 'codemap/graph@1',
  meta: {
    generatedAt: new Date().toISOString(), scanAt: scan.generatedAt, rootName: scan.rootName, root: scan.root,
    audience, agent, ...(typeof arch.language === 'string' && arch.language.trim() ? { language: arch.language.trim() } : {}),
    ...(scan.blueprint ? { blueprint: { source: scan.blueprint.source, stack: scan.blueprint.stack, assumptions: scan.blueprint.assumptions } } : {}),
    repos: scan.repos.map(({ path: p, name, branch, head, remote }) => ({ path: p, name, branch, head, remote })),
    counts: { files: included.length, loc: included.reduce((s, f) => s + f.loc, 0), unassigned: unassigned.length },
  },
  project: arch.project,
  nodes: [
    ...nodes.map((n) => ({
      id: n.id, parent: n.parent || null, label: n.label, kind: n.kind, summary: n.summary || '', details: n.details || '',
      tags: n.tags || [], paths: n.paths || [], packages: n.packages || [], hosts: n.hosts || [],
      stats: { ...stats.get(n.id), repos: [...stats.get(n.id).repos] },
    })),
    ...(unassigned.length ? [{ id: 'unassigned', parent: null, label: 'Unassigned', kind: 'misc', summary: 'Files no node claims. Add globs in architecture.json to place them.', details: '', tags: [], paths: [], packages: [], hosts: [], stats: { ...stats.get('unassigned'), repos: [...stats.get('unassigned').repos] } }] : []),
  ],
  files: included.map((f) => {
    const d = fileDesc.get(f.path);
    return {
      p: f.path, n: owner.get(f.path), r: f.repo, l: f.lang || f.category, loc: f.loc,
      name: d?.name || f.name || fallbackFileName(f.path), d: d?.d || f.desc || f.doc || '', ...(d?.d || f.desc ? {} : { auto: true }),
      ...(f.doc ? { doc: f.doc } : {}),
      ...(f.tooLarge ? { tooLarge: true } : {}),
      ...(d?.review ? { review: d.review } : {}),
      ...(f.h ? { h: f.h, sig: f.sig } : {}),
      // symbols: what the file exports, then (flag 1 at [5]) its other functions, so the map can show every
      // function as a card with the calls between them (in technical detail)
      ...(f.symbols || f.fns ? { s: [
        ...(f.symbols || []).map((s) => [s.name, s.kind, s.line, s.default ? 1 : 0, s.doc || '']),
        ...(f.fns || []).filter(([n, line]) => !/ \//.test(n) && !(f.symbols || []).some((s) => s.name === n && Math.abs(s.line - line) <= 3)).map(([n, line]) => [n, 'function', line, 0, '', 1]),
      ] } : {}),
      ...(f.fns ? { fn: f.fns } : {}),
      ...(notes.has(f.path) ? notes.get(f.path) : {}),
    };
  }),
  routes: routesIn.map((r) => {
    const d = descOf(r);
    return { f: r.file, m: r.method, p: r.path, l: r.line, h: r.handler || null, ...(r.hc ? { hc: r.hc } : {}), name: d?.name || r.name || fallbackRouteName(r), d: d?.d || r.desc || r.doc || '', ...(d?.d || r.desc ? {} : { auto: true }), ...(d?.review ? { review: d.review } : {}), ...(r.doc ? { doc: r.doc } : {}), ...(r.access ? { access: r.access } : {}), ...(r.who ? { who: r.who } : {}), ...(r.publicBecause ? { publicBecause: r.publicBecause } : {}) };
  }),
  links: [...links.values()],
  // the data model: tables from migrations / Prisma (later definitions win) and the code that reads or writes them
  tables: (() => {
    const t = new Map();
    // model classes (Eloquent, Django, @Entity…) name the table they use; they add to a migration's table, never replace it
    const models = new Map();
    for (const f of [...scan.files].sort((a, b) => a.path.localeCompare(b.path))) for (const x of f.tables || []) {
      if (x.model) models.set(x.model, x.name);
      if (x.modelOnly) { if (t.has(x.name)) { t.get(x.name).model ||= x.model; continue; } t.set(x.name, { name: x.name, model: x.model, file: f.path, line: x.line, columns: [], refs: [], usedBy: [], fromModel: true }); continue; }
      t.set(x.name, { name: x.name, ...(x.model || t.get(x.name)?.model ? { model: x.model || t.get(x.name).model } : {}), file: f.path, line: x.line, columns: x.columns, refs: x.refs, usedBy: [] });
    }
    const modelToTable = new Map([...t.values()].filter((x) => x.model).map((x) => [x.model.toLowerCase(), x.name]));
    for (const f of included) for (const u of fileByPath.get(f.path)?.tableUses || []) {
      if (u.model) { const name = models.get(u.model); if (name && t.has(name)) t.get(name).usedBy.push([f.path, u.how, u.line]); continue; } // only known models
      const name = t.has(u.table) ? u.table : modelToTable.get(u.table) || (t.has(u.table + 's') ? u.table + 's' : u.table);
      if (!t.has(name)) t.set(name, { name, inferred: true, columns: [], refs: [], usedBy: [] });
      t.get(name).usedBy.push([f.path, u.how, u.line]);
    }
    return [...t.values()];
  })(),
  // function -> function calls: [fromFile, fromFn, toFile, toFn, line, loose?] (fn = index into that file's fn list)
  calls: (scan.calls || []).filter((c) => includedSet.has(c[0]) && includedSet.has(c[2])),
  // events fired, jobs queued, mail sent, outside services: [file, fn, kind, name, line, [[handlerFile, handlerFn]…]]
  facts: (scan.facts || []).filter((x) => includedSet.has(x[0])),
  classFacts: scan.classFacts || {},
  effects: (scan.effects || []).filter((e) => includedSet.has(e[0])).map(([p, fi, kind, name, line, to]) => [p, fi, kind, name, line, (to || []).filter(([q]) => includedSet.has(q))]),
  flows: outFlows,
  tour: outTour,
  ...(outRecent?.items.length ? { recent: outRecent } : {}),
};
// extension hooks, computed from the finished graph plus the raw scan
// a blueprint has no code to check, so its Health is a design review of the plan (computed after screens)
if (!scan.blueprint) try { graph.health = buildHealth({ graph, scan, arch, root }); } catch (e) { warn(`health check failed: ${e.message}`); graph.health = { issues: [] }; }
try { graph.screens = buildScreens({ graph, scan, arch, root }); } catch (e) { warn(`screen detection failed: ${e.message}`); graph.screens = []; }
// flows traced function by function, for free: from the main screens and the endpoints other code calls most,
// through every function call and request down to the data. They show under Flows next to the ones the agent wrote.
try {
  const gFiles = new Map(graph.files.map((f) => [f.p, f]));
  const toRef = (ref) => {
    if (ref.startsWith('route:')) { const i = routeLookup.get(ref.slice(6)); return i == null ? null : `r:${i}`; }
    if (ref.startsWith('sym:')) { const p = ref.slice(4, ref.lastIndexOf('#')), nm = ref.slice(ref.lastIndexOf('#') + 1); const i = (gFiles.get(p)?.s || []).findIndex((s) => s[0] === nm); return i >= 0 ? `s:${p}#${i}` : (gFiles.has(p) ? `f:${p}` : null); }
    if (ref.startsWith('f:')) return gFiles.has(ref.slice(2)) ? ref : null;
    return null;
  };
  const callers = (i) => graph.links.filter((l) => (l.calls || []).some(([x]) => x === i)).length;
  const starts = [
    ...[...new Map((graph.screens || []).map((s) => [s.url + '|' + s.app, s])).values()].slice(0, 5).map((s) => ({ start: s.url, app: byId.get(s.app)?.label, title: `Step by step: ${s.name}` })),
    ...graph.routes.map((r, i) => ({ r, n: callers(i) })).filter((x) => x.n).sort((a, b) => b.n - a.n).slice(0, 3).map(({ r }) => ({ start: `${r.m} ${r.p}`, title: `Step by step: ${r.name || `${r.m} ${r.p}`}` })),
  ];
  let traced = 0;
  for (const st of starts) {
    if (graph.flows.some((f) => f.title === st.title)) continue;
    const r = traceReport(graph, st.start, { depth: 14, ...(st.app ? { app: st.app } : {}) });
    if (!r.trees?.length) continue;
    const { steps, edges } = traceToCards(graph, r.trees);
    if (steps.length < 4) continue;
    const keep = steps.slice(0, 24), on = new Set(keep.map((x) => x.ref));
    const id = 'traced-' + st.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
    const story = flowStory.get(id);
    graph.flows.push({ id, title: st.title, start: st.start, description: story || `Followed from ${st.start} through each function call and request, worked out from the code's structure.`, ...(story ? { story } : {}), domain: 'Traced step by step', steps: keep, edges: edges.filter(([a, b]) => on.has(a) && on.has(b)), traced: true });
    traced++;
  }
  const told = graph.flows.filter((f) => f.traced && f.story).length;
  if (traced) report.push(`TRACED FLOWS  ${traced} flow${traced === 1 ? '' : 's'} followed function by function (under Flows)${told < traced ? `; ${traced - told} without a story yet (describe.mjs writes the worksheet)` : '; each with its story'}`);
} catch (e) { warn(`tracing flows failed: ${e.message}`); }
if (scan.blueprint) try { graph.health = buildPlanHealth({ graph, scan }); } catch (e) { warn(`design review failed: ${e.message}`); graph.health = { issues: [] }; }
// issues people marked "not a problem" on the map (saved by serve.mjs) stay listed, set apart, and leave the counts
const dismissedFile = path.join(outDir, 'health-dismissed.json');
if (graph.health?.issues && fs.existsSync(dismissedFile)) {
  try { graph.health = withDismissed(graph.health, JSON.parse(fs.readFileSync(dismissedFile, 'utf8')).dismissed); } catch (e) { warn(`health-dismissed.json is not valid JSON: ${e.message}`); }
}
fs.mkdirSync(outDir, { recursive: true });
const trackedWarning = keepOutOfGit(outDir);
// layers (a second lens on the same files) and trust boundaries (who runs each top-level part)
{
  const kindsUp = (id) => { const ks = []; let n = byId.get(id); while (n) { ks.push(n.kind); n = n.parent ? byId.get(n.parent) : null; } return ks; };
  const hasRoutes = new Set(graph.routes.map((r) => r.f)), hasScreens = new Set((graph.screens || []).map((s) => s.file));
  const usesTables = new Set((graph.tables || []).flatMap((t) => t.usedBy.map(([p]) => p)));
  const LAYERS = [
    ['test', (p, k) => k.includes('test') || /(^|\/)(tests?|__tests__|spec|testing|e2e)\/|[._](test|spec)\.\w+$|_test\.\w+$/.test(p)],
    ['config', (p, k) => k.includes('config') || k.includes('infra') || /(^|\/)(config|settings|env)[\w.-]*\.\w+$/i.test(p)],
    ['screen', (p) => hasScreens.has(p)],
    ['api', (p) => hasRoutes.has(p) || /(^|\/)(routes?|routers?|controllers?|handlers?|endpoints?|api)\//i.test(p)],
    ['middleware', (p) => /(^|\/)(middlewares?|guards?|interceptors?|auth)\//i.test(p)],
    ['data', (p, k) => k.includes('data') || usesTables.has(p) || /(^|\/)(models?|entities|schemas?|repositor(y|ies)|db|database|migrations?|dao)\//i.test(p)],
    ['ui', (p, k) => k.includes('ui') && /(^|\/)(components?|widgets?|views?|ui|pages?|screens?)\//i.test(p)],
    ['logic', (p) => /(^|\/)(services?|use_?cases?|domain|business|view_?models?|blocs?|cubits?|stores?|state|controllers?)\//i.test(p)],
    ['shared', (p) => /(^|\/)(utils?|helpers?|lib|common|shared|core)\//i.test(p)],
  ];
  for (const f of graph.files) { const k = kindsUp(f.n); f.ly = (LAYERS.find(([, t]) => t(f.p, k)) || ['other'])[0]; }
  const BOUNDARY = { ui: 'client', service: 'server', worker: 'server', feature: 'server', library: 'shared', data: 'data store', external: 'third party', config: 'config', infra: 'infrastructure', script: 'tooling', test: 'tests' };
  for (const n of graph.nodes) if (!n.parent) n.boundary = BOUNDARY[n.kind] || 'other';
}
// keep the previous map for "what changed since last time" (query.mjs delta), the last five
try {
  const prev = path.join(outDir, 'graph.json');
  if (fs.existsSync(prev)) {
    const snapDir = path.join(outDir, '.cache', 'snapshots');
    fs.mkdirSync(snapDir, { recursive: true });
    const old = JSON.parse(fs.readFileSync(prev, 'utf8'));
    if (old.meta?.generatedAt) fs.copyFileSync(prev, path.join(snapDir, `graph-${old.meta.generatedAt.replace(/[:.]/g, '-')}.json`));
    for (const f of fs.readdirSync(snapDir).filter((x) => x.startsWith('graph-')).sort().slice(0, -5)) fs.rmSync(path.join(snapDir, f), { force: true });
  }
} catch {}
fs.writeFileSync(path.join(outDir, 'graph.json'), JSON.stringify(graph, null, 0));

const template = fs.readFileSync(path.join(SKILL_DIR, 'assets', 'viewer.html'), 'utf8');
// The layout engine (elkjs 0.9.3) and fonts (Inter, JetBrains Mono) are bundled in assets/vendor/ and
// inlined, so the map makes no outside requests and works offline.
const vendor = path.join(SKILL_DIR, 'assets', 'vendor');
const elkTag = `<script>${fs.readFileSync(path.join(vendor, 'elk.bundled.js'), 'utf8').replace(/<\/script/gi, '<\\/script')}</script>`;
const FONT_RANGES = {
  latin: 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
  'latin-ext': 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF',
};
const fontCss = [['Inter', 'inter'], ['JetBrains Mono', 'jetbrains-mono']].flatMap(([family, file]) => Object.entries(FONT_RANGES).map(([subset, range]) =>
  `@font-face{font-family:"${family}";font-style:normal;font-display:swap;font-weight:100 900;unicode-range:${range};src:url(data:font/woff2;base64,${fs.readFileSync(path.join(vendor, 'fonts', `${file}-${subset}-wght-normal.woff2`)).toString('base64')}) format("woff2")}`)).join('\n');
// the map's lookups, plus flows and impact (lib/flows.mjs, import-free) for the viewer and codemap/query.mjs
const graphQuery = fs.readFileSync(path.join(SKILL_DIR, 'assets', 'graph-query.js'), 'utf8') + '\n' + fs.readFileSync(path.join(SKILL_DIR, 'scripts', 'lib', 'flows.mjs'), 'utf8').replace(/^export /gm, '');
const page = (g) => template
  .replace('/*__GRAPH_QUERY__*/', () => graphQuery.replace(/<\/script/gi, '<\\/script'))
  .replace('<!--__ELK_SCRIPT__-->', () => elkTag)
  .replace('/*__FONTS__*/', () => fontCss)
  .replace('/*__CODEMAP_DATA__*/null', () => JSON.stringify(g).replace(/<\/(script)/gi, '<\\/$1').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029'))
  .replace(/__CODEMAP_TITLE__/g, () => escapeHtml(`${arch.project.name} map`))
  .replace(/__CODEMAP_LOGO__/g, () => dataUri('logo.png'))
  .replace(/__CODEMAP_FAVICON__/g, () => dataUri('favicon.png'))
  .replace('<!--__UI_EXTENSIONS__-->', () => uiScripts);
const uiDir = path.join(SKILL_DIR, 'assets', 'ui');
// the map's own words, for translating it: every short label in the viewer and its extensions, written once to
// .cache/ui-strings.en.json; the agent's translation (codemap/ui-strings.json) goes into graph.uiStrings
const uiStringsEn = (() => {
  const set = new Set();
  // (not code that happens to sit between > and <, font names, or product and technology names)
  const NOT_UI = /[{}<>$=;'`"|\\]|\/\*|^__|,$|\(|\)$|^[a-z-]+$|\.(js|json|md|html|mjs)$|^https?:|^(Inter|SF Mono|Segoe UI|Cascadia Code|DOMContentLoaded|Claude|Claude Code|Claude Code CLI|Codex|Codemap|Codemap Cloud|OAuth|SQLAlchemy|Vitest|Cloud Run|App Router|Enter|Escape|Backspace)$/;
  const add = (s) => { s = String(s).replace(/\s+/g, ' ').trim(); if (s.length >= 2 && s.length <= 80 && /[A-Za-z]{2}/.test(s) && !NOT_UI.test(s)) set.add(s); };
  const sources = [template, ...(fs.existsSync(uiDir) ? fs.readdirSync(uiDir).filter((n) => n.endsWith('.js')).map((n) => fs.readFileSync(path.join(uiDir, n), 'utf8')) : [])];
  for (const src of sources) {
    for (const m of src.matchAll(/>([^<>{}\n]{2,80})</g)) add(m[1]);
    for (const m of src.matchAll(/\b(?:title|aria-label|placeholder|label)\s*[:=]\s*(["'])([^"'\n]{2,80})\1/g)) add(m[2]);
    for (const m of src.matchAll(/\b(?:toast|setText)\(\s*(["'])([^"'\n]{2,80})\1/g)) add(m[2]);
    // short capitalised phrases in quotes (labels chosen in code: PLAN ? 'Review' : 'Health')
    for (const m of src.matchAll(/(["'])([A-Z][A-Za-z][A-Za-z ,.’'!?…-]{0,58})\1/g)) if (!/^[A-Z][A-Z_]+$|^[A-Z][a-z]+[A-Z]/.test(m[2])) add(m[2]);
  }
  return [...set].sort();
})();
try { fs.mkdirSync(path.join(outDir, '.cache'), { recursive: true }); fs.writeFileSync(path.join(outDir, '.cache', 'ui-strings.en.json'), JSON.stringify(uiStringsEn, null, 1)); } catch {}
const uiStringsFile = path.join(outDir, 'ui-strings.json');
// the most visible words come built in for common languages (assets/i18n); the agent's ui-strings.json adds to them
const LANG_CODES = { es: /^(es|spanish|español|espanol)\b/i, fr: /^(fr|french|français|francais)\b/i, de: /^(de|german|deutsch)\b/i, pt: /^(pt|portuguese|português|portugues)\b/i, zh: /^(zh|chinese|mandarin|中文|简体中文)/i, ja: /^(ja|japanese|日本語)/i, hi: /^(hi|hindi|हिन्दी|हिंदी)/i, ur: /^(ur|urdu|اردو)/i, ar: /^(ar|arabic|العربية)/i };
const langCode = graph.meta.language ? Object.keys(LANG_CODES).find((c) => LANG_CODES[c].test(graph.meta.language.trim())) : null;
if (langCode) graph.meta.languageCode = langCode;
// languages written right to left: the page reads that way too (code, paths and the map itself stay left to right)
if (graph.meta.language && /^(ar|ur|fa|he)\b|arabic|urdu|persian|farsi|hebrew|العربية|اردو|فارسی|עברית/i.test(graph.meta.language)) graph.meta.rtl = true;
let builtIn = 0;
if (graph.meta.language && !/^en(glish)?$/i.test(graph.meta.language)) {
  const merged = {};
  const take = (t) => { for (const [k, v] of Object.entries(t || {})) if (typeof v === 'string' && v.trim() && uiStringsEn.includes(k)) merged[k] = v; };
  if (langCode) { try { take(JSON.parse(fs.readFileSync(path.join(SKILL_DIR, 'assets', 'i18n', `${langCode}.json`), 'utf8'))); builtIn = Object.keys(merged).length; } catch {} }
  if (fs.existsSync(uiStringsFile)) { try { take(JSON.parse(fs.readFileSync(uiStringsFile, 'utf8'))); } catch (e) { report.push(`! ui-strings.json is not valid JSON: ${e.message}`); } }
  if (Object.keys(merged).length) graph.uiStrings = merged;
}
const uiScripts = fs.existsSync(uiDir) ? fs.readdirSync(uiDir).filter((n) => n.endsWith('.js')).sort().map((n) => `<script>/* ui/${n} */\n${fs.readFileSync(path.join(uiDir, n), 'utf8').replace(/<\/script/gi, '<\\/script')}</script>`).join('\n') : '';
if (graph.meta.language && !/^en(glish)?$/i.test(graph.meta.language)) {
  const n = Object.keys(graph.uiStrings || {}).length;
  const rest = `translate codemap/.cache/ui-strings.en.json into ${graph.meta.language} as codemap/ui-strings.json ({ "English": "translation" }), then build again`;
  report.push(!n ? `UI STRINGS  the map's buttons are still in English: ${rest}` : n === builtIn && !fs.existsSync(uiStringsFile) ? `UI STRINGS  ${n}/${uiStringsEn.length} of the map's own words built in for ${graph.meta.language} (the most visible ones); for the rest, ${rest}` : `UI STRINGS  ${n}/${uiStringsEn.length} of the map's own words in ${graph.meta.language}`);
}
const html = page(graph);
fs.writeFileSync(path.join(outDir, 'index.html'), html);
// --artifact: a copy to publish to the Claude app, without this machine's absolute path (editor links)
// (and without the reasons on dismissed health issues, which are notes to self)
const sharedHealth = graph.health?.dismissed ? { ...graph.health, dismissed: graph.health.dismissed.map(({ reason, ...d }) => d) } : graph.health;
if (args.artifact) fs.writeFileSync(path.join(outDir, 'artifact.html'), page({ ...graph, ...(sharedHealth ? { health: sharedHealth } : {}), meta: { ...graph.meta, root: null, agent: 'claude' } }));
// Self-contained helpers next to the map: ask questions through the Claude Code CLI or Codex (serve.mjs)
// and the graph lookups it hands to them (query.mjs). They need only Node, not this skill.
fs.writeFileSync(path.join(outDir, 'query.mjs'), `${graphQuery}
// ---- cli ----
${fs.readFileSync(path.join(SKILL_DIR, 'assets', 'query-cli.mjs'), 'utf8')}`);
fs.copyFileSync(path.join(SKILL_DIR, 'assets', 'serve.mjs'), path.join(outDir, 'serve.mjs'));
// a blueprint can be changed from the map: serve.mjs redraws it with this skill's plan.mjs and build.mjs
if (scan.blueprint) { fs.mkdirSync(path.join(outDir, '.cache'), { recursive: true }); fs.writeFileSync(path.join(outDir, '.cache', 'skill.json'), JSON.stringify({ dir: SKILL_DIR })); }
// the logo and tab icon are inlined so the map stays one self-contained file
function dataUri(name) { return 'data:image/png;base64,' + fs.readFileSync(path.join(SKILL_DIR, 'assets', name)).toString('base64'); }
function escapeHtml(s) { return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]); }

const hs = graph.health?.summary;
if (hs && (hs.high || hs.medium || hs.low)) {
  report.push(`${scan.blueprint ? 'DESIGN REVIEW' : 'HEALTH'}  ${hs.high} important · ${hs.medium} worth fixing · ${hs.low} minor`);
  for (const i of graph.health.issues.filter((x) => x.severity !== 'low' && !dismissalFor(x, graph.health.dismissed)).slice(0, 8)) report.push(`  [${i.severity}] ${i.title}`);
}
if (graph.screens?.length) report.push(`SCREENS  ${graph.screens.length} detected`);
report.push(graph.recent
  ? `RECENT WORK  ${graph.recent.items.length} card(s) highlighted across ${graph.recent.tasks.length} task(s)`
  : `RECENT WORK  none highlighted${fs.existsSync(recentFile) ? '' : ' (no recent-work.json)'}`);
// point future Claude Code sessions in this project at the map. Codex has no personal, uncommitted
// equivalent (AGENTS.md is shared with the team), so a map built by Codex leaves the project's notes alone.
if (agent === 'codex') report.push('AGENT  Codex: questions on the map run through Codex');
else if (scan.blueprint) report.push('BLUEPRINT  planned, not built yet: drawn from codemap/plan.json');
else if (!args['no-claude-md']) report.push(`CLAUDE.LOCAL.MD  ${writeClaudeMd(root, outDir, { add: !!args['claude-md'] })}`);
report.push(trackedWarning ? `GIT  ! ${trackedWarning}` : 'GIT  codemap/ is kept out of git (it ignores itself)');
report.push('');
report.push(`✓ wrote ${path.relative(root, path.join(outDir, 'index.html'))} (${fmtNum(Math.round(html.length / 1024))} KB) and graph.json`);
if (pct > 10) report.push(`  Unassigned is ${pct.toFixed(0)}%: add nodes or globs for the directories above (or "ignore" them) and rebuild.`);
if (args.json) console.log(JSON.stringify({ ...receipt(), wrote: path.relative(root, path.join(outDir, 'index.html')), health: graph.health?.summary || null, screens: graph.screens?.length || 0, functions: graph.files.reduce((n, f) => n + (f.fn?.length || 0), 0), calls: graph.calls.length }, null, 1));
else console.log(report.join('\n'));
