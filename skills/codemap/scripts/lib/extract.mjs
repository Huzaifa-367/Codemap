import { laravelRoutes, railsRoutes, aspnetRoutes, chiSpans } from './routes-more.mjs';

// Per-language, regex-based extraction of imports, exported symbols, HTTP routes and HTTP calls.
// Deliberately approximate: good enough to draw the map, cheap enough to run on any repo.

const lineIndex = (src) => {
  const starts = [0];
  for (let i = 0; i < src.length; i++) if (src.charCodeAt(i) === 10) starts.push(i + 1);
  return (offset) => {
    let lo = 0, hi = starts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= offset) lo = mid; else hi = mid - 1; }
    return lo + 1;
  };
};

const blank = (s) => s.replace(/[^\n]/g, ' ');
// Strip comments while keeping offsets (so line numbers stay right).
const stripCStyle = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, blank)
  .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, (m, pre) => pre + blank(m.slice(pre.length)));
const stripHash = (src) => src.replace(/(^|\s)#[^\n]*/g, (m, pre) => pre + blank(m.slice(pre.length)));

const all = (re, s) => [...s.matchAll(re)];

// ---------- HTTP call literals ----------

const HTTP_CONTEXT = /\b(fetch|axios|ky|got|request|requests|httpx|aiohttp|session|client|http|https|api|Api|API|endpoint|Endpoint|url|Url|URL|BASE|base)\b|\.(get|post|put|patch|delete|head)\s*(<[^>]*>)?\s*\(|(?<![.\w$])(get|post|put|patch|delete)\s*\(\s*[rf]?["'`]\//;
const NAV_CONTEXT = /\b(router\.(push|replace|prefetch)|navigate|redirect|href|revalidatePath|pathname|Link|to=|location\.)\b|window\.location/;
const STR_LITERAL = /(["'`])((?:\\.|(?!\1)[^\\\n])*)\1/g;
const IGNORED_HOST = /^(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?$|\.(test|example|invalid|local|localhost|internal)(:\d+)?$|(^|\.)example\.(com|org|net)$/;
const FILE_EXT_TAIL = /\.(png|jpe?g|gif|svg|ico|webp|css|js|mjs|ts|tsx|json|html?|txt|md|pdf|csv|xml|woff2?|ttf|map)$/i;

function normalizeCallLiteral(raw) {
  let s = raw.trim();
  let host = null;
  // a Firebase function's own address (https://us-central1-<project>.cloudfunctions.net/signDocument) is
  // this app's backend, not an outside service
  const fn = /^https?:\/\/[^/\s]*\.cloudfunctions\.net(\/.*)$/i.exec(s);
  if (fn) s = fn[1];
  const abs = /^https?:\/\/([^/${}\s]+)(.*)$/i.exec(s);
  if (abs) { host = abs[1].toLowerCase(); s = abs[2] || '/'; }
  // Swift \(id) and Dart/Kotlin $id interpolations read like ${id}
  s = s.replace(/\\\(([^()]*(?:\([^()]*\))?[^()]*)\)/g, '{$1}').replace(/\$(?!\{)([A-Za-z_][\w.]*)/g, '{$1}');
  // leading interpolations: ${API_BASE}/x, {BASE_URL}/x
  s = s.replace(/^(?:\$\{[^}]*\}|\{[^}]*\})+/, '');
  if (!s.startsWith('/')) return null;
  s = s.split(/[?#]/)[0];
  // a query string interpolated straight onto the last segment: `/cost-lots${qs}`, `/items{query}`
  s = s.replace(/([A-Za-z0-9_\-])(?:\$\{[^}]*\}|\{[^}]*\})+$/, '$1');
  if (!/^\/[\w\-.~%/*${}:@<>\[\]]*$/.test(s)) return null;
  if (FILE_EXT_TAIL.test(s)) return null;
  if (!/[a-zA-Z]{2,}/.test(s.replace(/\$\{[^}]*\}|\{[^}]*\}/g, ''))) return host ? { host, path: null } : null;
  return { host, path: s };
}

/**
 * Collapse every ${…} inside template literals to ${x}, counting braces, so nested templates like
 * `/orders${q ? `?${q}` : ''}` read as one literal "/orders${x}" instead of breaking at the inner backtick.
 */
export function flattenTemplates(line) {
  let out = '', inTpl = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '\\') { out += c + (line[i + 1] ?? ''); i++; continue; }
    if (c === '`') { inTpl = !inTpl; out += c; continue; }
    if (inTpl && c === '$' && line[i + 1] === '{') {
      let depth = 1, j = i + 2;
      for (; j < line.length && depth; j++) { if (line[j] === '{') depth++; else if (line[j] === '}') depth--; }
      out += '${x}'; i = j - 1; continue;
    }
    out += c;
  }
  return out;
}

// `api.post(…)`, or a bare helper imported from an API client: `post("/orders", …)`
const METHOD_CALL = /(?:\.|(?<![\w$])(?=(?:get|post|put|patch|delete)\s*\(\s*[rf]?["'`]\/))(get|post|put|patch|delete)\s*(?:<[^>]*>)?\s*\(/i;
const METHOD_OPT = /method\s*[:=]\s*(?:["'`]|(?:HTTPMethod|HttpMethod|Method)?\.)(get|post|put|patch|delete|head|options)\b/i;
// Swift URLRequest / Kotlin builders set the method on a following line: request.httpMethod = "POST"
const METHOD_NEXT = /\b(?:httpMethod|requestMethod)\s*=\s*["'](\w+)["']|\.method\(\s*["'](\w+)["']/i;
// `const url = …`, `url = f"…"`, `this.endpoint = …`: a URL kept in a variable for the call below
const ASSIGN = /(?:\b(?:const|let|var)\s+|^\s*(?:self\.|this\.)?)([A-Za-z_$][\w$]*)\s*(?::\s*[\w<>[\]|. ]+?\s*)?=(?![=>])/;
/** Where a variable is passed to an HTTP call within the next few lines, and with which method. */
function variableUse(lines, i, name) {
  const use = new RegExp(`(?:\\.(get|post|put|patch|delete|head|request)\\s*(?:<[^>]*>)?\\s*\\(|\\b(?:fetch|axios|ky|got|request|urlopen)\\s*\\(|\\brequests\\.(get|post|put|patch|delete)\\s*\\()\\s*${name}\\b`, 'i');
  for (let j = i + 1; j < Math.min(lines.length, i + 10); j++) {
    const m = use.exec(lines[j]);
    if (!m) continue;
    const verb = (m[1] && m[1].toLowerCase() !== 'request' ? m[1] : m[2]) || METHOD_OPT.exec(lines.slice(j, j + 4).join(' '))?.[1] || '';
    return { method: verb.toUpperCase() || null };
  }
  return null;
}

function extractCalls(src, at, { skip } = {}) {
  const calls = [];
  const hosts = [];
  const lines = src.split('\n');
  let offset = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = flattenTemplates(lines[i]);
    const lineStart = offset;
    offset += lines[i].length + 1;
    if (line.length > 500 || NAV_CONTEXT.test(line)) continue;
    if (skip && skip.test(line)) continue;
    // a URL assigned to a variable counts when an HTTP call below uses that variable
    const assigned = ASSIGN.exec(line)?.[1];
    const use = assigned ? variableUse(lines, i, assigned) : null;
    if (!HTTP_CONTEXT.test(line) && !use) continue;
    let method = (METHOD_CALL.exec(line)?.[1] || METHOD_OPT.exec(line)?.[1] || use?.method || '').toUpperCase() || null;
    if (!method) { const nx = METHOD_NEXT.exec(lines.slice(i + 1, i + 5).join('\n')); if (nx) method = (nx[1] || nx[2]).toUpperCase(); }
    for (const m of line.matchAll(STR_LITERAL)) {
      const n = normalizeCallLiteral(m[2]);
      if (!n) continue;
      const lineNo = at(lineStart);
      if (n.host && !IGNORED_HOST.test(n.host) &&!n.host.includes('${') && !n.host.includes('{')) hosts.push({ host: n.host, line: lineNo });
      if (n.path && !n.host) calls.push({ path: n.path, method, line: lineNo });
    }
  }
  return { calls, hosts };
}

// ---------- JS / TS ----------

/** Imported names plus their local bindings: `import users, { a as b } from` → locals { users: 'default', b: 'a' }. */
function parseImportClause(clause) {
  const names = [];
  const locals = {};
  const c = clause.replace(/^type\s+/, '').trim();
  const brace = /\{([^}]*)\}/.exec(c);
  if (brace) for (const part of brace[1].split(',')) {
    const [orig, alias] = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/).map((s) => s?.trim());
    if (orig) { names.push(orig); locals[alias || orig] = orig; }
  }
  const head = c.replace(/\{[^}]*\}/, '').replace(/,/g, ' ').trim();
  const ns = /\*\s+as\s+([A-Za-z_$][\w$]*)/.exec(head);
  if (ns) locals[ns[1]] = '*';
  const def = /^([A-Za-z_$][\w$]*)/.exec(head);
  if (def && def[1] !== 'as') { names.push('default'); locals[def[1]] = 'default'; }
  return { names, locals };
}

function extractJs(src, filePath) {
  const code = stripCStyle(src);
  const at = lineIndex(code);
  const imports = [];
  for (const m of all(/(?:^|[;\n}])\s*import\s+(?!\()((?:type\s+)?[^'";]*?)\s+from\s+["']([^"'\n]+)["']/g, code)) imports.push({ spec: m[2], ...parseImportClause(m[1]), line: at(m.index) });
  for (const m of all(/(?:^|[;\n])\s*import\s+["']([^"'\n]+)["']/g, code)) imports.push({ spec: m[1], names: [], line: at(m.index) });
  for (const m of all(/\bexport\s+(?:type\s+)?(\*(?:\s+as\s+\w+)?|\{[^}]*\})\s+from\s+["']([^"'\n]+)["']/g, code)) {
    // `export { a as b } from` → exported { b: 'a' }, the names this file passes on
    const clause = m[1].startsWith('{') ? parseImportClause(m[1]) : null;
    imports.push({ spec: m[2], names: clause ? clause.names : [], ...(clause ? { exported: clause.locals } : {}), line: at(m.index), reexport: true });
  }
  for (const m of all(/\brequire\(\s*["']([^"'\n]+)["']\s*\)/g, code)) {
    // `const usersRouter = require('./users')` / `const { a, b: c } = require(…)` bind local names
    const before = code.slice(code.lastIndexOf('\n', m.index) + 1, m.index);
    const bind = /(?:const|let|var)\s+(\{[^}]*\}|[A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?$/.exec(before);
    const locals = {};
    if (bind?.[1].startsWith('{')) for (const part of bind[1].slice(1, -1).split(',')) { const [orig, alias] = part.trim().split(/\s*:\s*/); if (orig) locals[(alias || orig).trim()] = orig.trim(); }
    else if (bind) locals[bind[1]] = 'default';
    imports.push({ spec: m[1], names: Object.values(locals), locals, line: at(m.index) });
  }
  for (const m of all(/\bimport\(\s*["']([^"'\n]+)["']\s*\)/g, code)) imports.push({ spec: m[1], names: [], line: at(m.index), dynamic: true });

  const symbols = [];
  const seen = new Set();
  const addSym = (name, kind, idx, isDefault) => {
    const key = name + (isDefault ? '#d' : '');
    if (seen.has(key)) return;
    seen.add(key);
    symbols.push({ name, kind, line: at(idx), ...(isDefault ? { default: true } : {}) });
  };
  for (const m of all(/^[ \t]*export\s+(default\s+)?(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(function\*?|class|const|let|var|interface|type|enum)\s+([A-Za-z_$][\w$]*)/gm, code)) {
    const kind = m[2].startsWith('function') ? 'function' : ['const', 'let', 'var'].includes(m[2]) ? 'const' : m[2];
    addSym(m[3], kind, m.index, !!m[1]);
  }
  for (const m of all(/^[ \t]*export\s+default\s+([A-Za-z_$][\w$]*)\s*;?\s*$/gm, code)) {
    if (!['function', 'class', 'async'].includes(m[1])) addSym(m[1], 'default', m.index, true);
  }
  for (const m of all(/^[ \t]*export\s*\{([^}]*)\}\s*;?\s*$/gm, code)) {
    for (const part of m[1].split(',')) {
      const [orig, alias] = part.trim().split(/\s+as\s+/);
      if (orig) addSym((alias || orig).trim(), 'export', m.index, (alias || '').trim() === 'default');
    }
  }
  // Next.js route handlers / module exports
  for (const m of all(/^[ \t]*module\.exports\s*=\s*([A-Za-z_$][\w$]*)?/gm, code)) addSym(m[1] || 'module.exports', 'default', m.index, true);

  // Express / Koa / Hono style routes and mounts
  const routes = [];
  const mounts = [];
  // any name bound to a router or app object counts too: const r = express.Router(), const api = new Hono()
  const routerVars = new Set([...code.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?(?:new\s+)?(?:require\(\s*["']express["']\s*\)\s*\.\s*)?(?:express\s*\.\s*Router|Router|express|Hono|Koa|KoaRouter|fastify|Fastify|createRouter|polka|restify\s*\.\s*createServer)\s*\(/g)].map((m) => m[1]));
  for (const m of all(/\b([A-Za-z_$][\w$]*)\.(get|post|put|patch|delete|all|options|head)\(\s*["'`](\/[^"'`]*)["'`]/g, code)) {
    if (!/^(app|server|fastify|hono|routes?|[a-z]*Router|router)$/.test(m[1]) && !routerVars.has(m[1])) continue;
    routes.push({ method: m[2].toUpperCase(), path: m[3], var: m[1], line: at(m.index) });
  }
  for (const m of all(/\b([A-Za-z_$][\w$]*)\.(use|route)\(\s*["'`](\/[^"'`]*)["'`]\s*,([^\n;]*)/g, code)) {
    const req = /require\(\s*["']([^"']+)["']\s*\)/.exec(m[4]);
    const mw = (m[4].split(',').map((s) => s.trim()).filter((s) => /^[A-Za-z_$][\w$.]*$/.test(s))).map((s) => s.split('.').pop());
    if (req) { mounts.push({ prefix: m[3], spec: req[1], line: at(m.index), ...(mw.length ? { mw } : {}) }); continue; }
    const args = m[4].replace(/\)\s*$/, '').split(',').map((s) => s.trim()).filter((s) => /^[A-Za-z_$][\w$.]*$/.test(s));
    if (args.length) mounts.push({ prefix: m[3], var: args[args.length - 1], line: at(m.index), ...(args.length > 1 ? { mw: args.slice(0, -1).map((s) => s.split('.').pop()) } : {}) });
  }

  // Fastify's object form: fastify.route({ method: ['GET', 'HEAD'], url: '/orders/:id', handler })
  for (const m of all(/\b([A-Za-z_$][\w$]*)\.route\(\s*\{/g, code)) {
    if (!/^(app|server|fastify|router|routes?|api|instance|f)$/.test(m[1]) && !routerVars.has(m[1])) continue;
    const body = code.slice(m.index, m.index + 600).split(/\}\s*\)/)[0];
    const url = /\b(?:url|path)\s*:\s*["'`](\/[^"'`]*)["'`]/.exec(body)?.[1];
    const ms = /\bmethod\s*:\s*(\[[^\]]*\]|["'`]\w+["'`])/.exec(body)?.[1];
    if (!url || !ms) continue;
    for (const v of ms.match(/[A-Za-z]+/g) || []) routes.push({ method: v.toUpperCase(), path: url, var: m[1], line: at(m.index) });
  }

  // NestJS: @Controller('cats') class … { @Get(':id') findOne() {} }, the class prefix joined to each method's
  for (const m of all(/@Controller\(\s*(?:(["'`])([^"'`]*)\1|\{[^}]*path\s*:\s*(["'`])([^"'`]*)\3[^}]*\})?\s*\)/g, code)) {
    const prefix = m[2] ?? m[4] ?? '';
    const next = code.slice(m.index + m[0].length).search(/@Controller\(/);
    const body = code.slice(m.index + m[0].length, next < 0 ? undefined : m.index + m[0].length + next);
    const base = m.index + m[0].length;
    for (const d of body.matchAll(/@(Get|Post|Put|Patch|Delete|All|Options|Head)\(\s*(?:(["'`])([^"'`]*)\2)?\s*\)/g)) {
      const p = ('/' + [prefix, d[3] || ''].map((x) => x.replace(/^\/+|\/+$/g, '')).filter(Boolean).join('/'));
      routes.push({ method: d[1] === 'All' ? 'ANY' : d[1].toUpperCase(), path: p, var: null, line: at(base + d.index), framework: 'nest' });
    }
  }

  // Next.js app/pages API routes, derived from the file path
  // (app router: the file must be named route.*, so _route.ts or myroute.ts are not endpoints)
  const next = /(?:^|\/)(?:src\/)?app\/(?:(.*?)\/)?route\.(?:t|j)sx?$/.exec(filePath) || /(?:^|\/)(?:src\/)?pages\/(api\/.*?)(?:\/index)?\.(?:t|j)sx?$/.exec(filePath);
  if (next) {
    const p = '/' + (next[1] || '').split('/').filter((s) => s && !/^\(.*\)$/.test(s) && !s.startsWith('@')).join('/');
    const methods = [...new Set([
      ...all(/export\s+(?:async\s+)?(?:function|const)\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g, code).map((m) => m[1]),
      // export { handler as GET, handler as POST } (NextAuth and shared handlers)
      ...all(/export\s*\{([^}]*)\}/g, code).flatMap((m) => all(/\bas\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g, m[1]).map((x) => x[1])),
    ])];
    for (const method of methods.length ? methods : ['ANY']) routes.push({ method, path: p, var: null, line: 1, framework: 'next' });
  }

  const triggers = /firebase-functions/.test(code) ? firebaseFunctions(code, at, routes, mounts) : [];

  const serverLine = /\b\w+\.(use|route)\(\s*["'`]\/|\b(?:app|server|fastify|hono|routes?|router|[a-z]+Router)\.(?:get|post|put|patch|delete|all|options|head)\(\s*["'`]\//;
  const { calls, hosts } = extractCalls(code, at, { skip: serverLine });
  const seenCall = new Set(calls.map((c) => `${c.line}|${c.path}`));
  for (const c of wrapperCalls(code, at)) if (!seenCall.has(`${c.line}|${c.path}`)) calls.push(c);
  const callables = /\bhttpsCallable\b/.test(code) ? callableCalls(code, at) : { calls: [], wrappers: [] };
  calls.push(...callables.calls);
  return { imports, symbols, routes, mounts, calls, hosts, ...(triggers.length ? { triggers } : {}), ...(callables.wrappers.length ? { callableWrappers: callables.wrappers } : {}) };
}

// ---------- Firebase Cloud Functions ----------

// `export const approveItem = onCall(…)`, `exports.sign = functions.region('eu').https.onRequest(…)`,
// `export const nightly = onSchedule('every day 03:00', …)`: the exported name, the chain before the
// trigger (v1 style `functions.firestore.document('x')`), and the trigger itself
const FIREBASE_FN = /(?:\bexport\s+(?:const|let|var)\s+|(?:^|[;\n])[ \t]*(?:const|let|var)\s+|\b(?:module\.)?exports\.)([A-Za-z_$][\w$]*)\s*(?::[^=\n]*)?=\s*((?:[A-Za-z_$][\w$]*(?:\([^()]*\))?\s*\.\s*)*)((?:on|before)[A-Z]\w*)\s*(?:<[^;]{0,300}?>)?\s*\(/g;
const FIRST_STRING = /["'`]([^"'`\n]{1,120})["'`]/;

/**
 * Callable and onRequest functions become endpoints named after their export (CALL /approveItem,
 * ANY /signDocument); Firebase serves an Express app passed to onRequest under the function's name,
 * so that becomes a mount. Every other trigger (schedules, Firestore, Storage, Pub/Sub, Auth) is a
 * background job, returned for the scan summary.
 */
function firebaseFunctions(code, at, routes, mounts) {
  const triggers = [];
  for (const m of code.matchAll(FIREBASE_FN)) {
    const [, name, chain, on] = m;
    const line = at(m.index + m[0].indexOf(name));
    const args = code.slice(m.index + m[0].length, m.index + m[0].length + 300);
    if (on === 'onCall' || on === 'onCallGenkit' || on === 'onRequest') {
      routes.push({ method: on === 'onRequest' ? 'ANY' : 'CALL', path: '/' + name, var: null, line, framework: 'firebase', handler: name });
      const app = on === 'onRequest' && /^\s*(?:\{[^{}]*\}\s*,\s*)?([A-Za-z_$][\w$]*)\s*\)/.exec(args)?.[1];
      if (app) mounts.push({ prefix: '/' + name, var: app, line });
      continue;
    }
    // v1 triggers name the provider in the chain (functions.pubsub.schedule(…).onRun); v2 ones are named for it
    const provider = /\b(pubsub|firestore|storage|auth|database|tasks|analytics|remoteConfig|testLab)\b/.exec(chain)?.[1];
    if (chain ? !provider : !/^(onSchedule|onDocument|onObject|onMessagePublished|onValue|onTaskDispatched|onCustomEventPublished|on\w*Alert|onTestMatrix|onConfigUpdated|before[A-Z])/.test(on)) continue;
    // what it runs on: the last string in the chain (after any region), else the first argument
    const what = [...chain.matchAll(new RegExp(FIRST_STRING, 'g'))].pop()?.[1] || FIRST_STRING.exec(/^[^)]*/.exec(args)[0])?.[1] || null;
    triggers.push({ name, on: provider ? `${provider}.${on}` : on, ...(what ? { what } : {}), line });
  }
  return triggers;
}

// httpsCallable(functions, 'approveItem'), httpsCallable<Req, Res>(getFunctions(app), 'x') and the
// older functions.httpsCallable('x'); the generic arguments may span lines
const CALLABLE = /\bhttpsCallable\s*(?:<[^;]{0,300}?>)?\s*\(\s*(?:[^,()'"`]*(?:\([^()]*\))?\s*,\s*)?(["'`])([\w-]+)\1/g;
const DEFS = /(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\(([^)]*)\)|\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:<[^>]*>\s*)?\(([^)]*)\)\s*(?::\s*[^=]+?)?=>/g;
/** A callable's name as a path: grouped functions deploy as `group-name`, so 'items-approve' → /items/approve. */
const callablePath = (name) => '/' + name.split('-').filter(Boolean).join('/');

/**
 * Calls to Firebase callable functions, by name, plus helpers that wrap httpsCallable
 * (`const call = (name, data) => httpsCallable(functions, name)(data)`) and their same-file uses.
 * The helpers' names are returned too, so scan.mjs can follow uses in the files that import them.
 */
function callableCalls(code, at) {
  const calls = [...code.matchAll(CALLABLE)].map((m) => ({ path: callablePath(m[2]), method: 'CALL', line: at(m.index) }));
  const wrappers = [];
  for (const m of code.matchAll(DEFS)) {
    const name = m[1] || m[3];
    const p0 = /^[A-Za-z_$][\w$]*/.exec((m[2] ?? m[4]).trim())?.[0];
    if (!p0) continue;
    const body = code.slice(m.index + m[0].length, m.index + m[0].length + 400);
    if (!new RegExp(`\\bhttpsCallable\\s*(?:<[^;]{0,300}?>)?\\s*\\(\\s*(?:[^,()'"\`]*(?:\\([^()]*\\))?\\s*,\\s*)?${p0}\\s*[,)]`).test(body)) continue;
    wrappers.push(name);
    calls.push(...callsVia(code, name, at(m.index)));
  }
  return { calls, wrappers };
}

/** Uses of a callable helper: `callFunction('approveItem', data)` → CALL /approveItem. */
function callsVia(code, name, skipLine = 0) {
  const out = [];
  const re = new RegExp(`(?<![\\w$.])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*(?:<[^;]{0,300}?>)?\\s*\\(\\s*(["'\`])([\\w-]+)\\1`, 'g');
  const at = lineIndex(code);
  for (const m of code.matchAll(re)) {
    const line = at(m.index);
    if (line !== skipLine) out.push({ path: callablePath(m[2]), method: 'CALL', line });
  }
  return out;
}
/** The same, in another file that imports the helper (under its local name there). */
export const callableCallsVia = (src, localName) => callsVia(stripCStyle(src), localName);

/**
 * Calls through a helper defined in the same file that adds a prefix and fetches, e.g.
 *   const call = (path, method = 'GET') => apiClient.request(`/inventory${path}`, { method });
 *   definitions: () => call('/definitions'),
 * becomes GET /inventory/definitions. Only same-file helpers whose first parameter is
 * spliced into a URL that an HTTP call fetches.
 */
function wrapperCalls(code, at) {
  const out = [];
  for (const m of code.matchAll(DEFS)) {
    const name = m[1] || m[3];
    const params = (m[2] ?? m[4]).split(',').map((p) => p.trim()).filter(Boolean);
    const pnames = params.map((p) => /^[A-Za-z_$][\w$]*/.exec(p)?.[0]);
    if (!pnames[0] || /^(get|post|put|patch|delete|request|fetch)$/i.test(name)) continue;
    const rawBody = code.slice(m.index + m[0].length, m.index + m[0].length + 700);
    const body = flattenTemplates(rawBody);
    if (!HTTP_CONTEXT.test(body)) continue;
    const tpl = spliced(rawBody, pnames[0]);
    if (tpl == null) continue;
    const methodIdx = pnames.findIndex((p, i) => i > 0 && (/^method$/i.test(p) || new RegExp(`method\\s*:\\s*${p}\\b`).test(body)));
    const defMethod = (methodIdx > 0 && /=\s*["'`](\w+)["'`]/.exec(params[methodIdx])?.[1]) || METHOD_CALL.exec(body)?.[1] || 'GET';
    const callRe = new RegExp(`\\b${name}\\s*(?:<[^>]*>)?\\(\\s*([\"'\`])((?:\\\\.|(?!\\1)[^\\\\\\n])*)\\1([^\\n]*)`, 'g');
    const defLine = at(m.index);
    code.split('\n').forEach((raw, i) => {
      if (i + 1 === defLine) return; // the definition itself
      for (const c of flattenTemplates(raw).matchAll(callRe)) {
        const n = normalizeCallLiteral(tpl + c[2]);
        if (!n?.path || n.host) continue;
        const verb = methodIdx > 0 ? /["'`](GET|POST|PUT|PATCH|DELETE)["'`]/i.exec(c[3])?.[1] : null;
        out.push({ path: n.path, method: (verb || defMethod).toUpperCase(), line: i + 1 });
      }
    });
  }
  return out;
}
/** The literal prefix right before ${param} in the helper's URL template (`${BASE}/prefix${path}` → "/prefix"), or null. */
function spliced(rawBody, param) {
  const raw = new RegExp(`\`((?:\\$\\{[^}]*\\})*)([^\`$]*)\\$\\{\\s*${param}\\s*\\}`).exec(rawBody);
  return raw ? raw[2] : null;
}

// ---------- Python ----------

function extractPy(src) {
  const code = stripHash(src);
  const at = lineIndex(code);
  const imports = [];
  for (const m of all(/^[ \t]*import[ \t]+([\w., \t]+)$/gm, code)) {
    for (const part of m[1].split(',')) {
      const [mod, alias] = part.trim().split(/\s+as\s+/);
      if (mod) imports.push({ spec: mod.trim(), names: [], alias: alias?.trim(), line: at(m.index) });
    }
  }
  for (const m of all(/^[ \t]*from[ \t]+(\.*[\w.]*)[ \t]+import[ \t]+(\([^)]*\)|[^\n]+)/gm, code)) {
    const names = [];
    const aliases = {};
    for (const part of m[2].replace(/[()\\]/g, ' ').split(',')) {
      const [orig, alias] = part.trim().split(/\s+as\s+/);
      if (orig && orig !== '*') { names.push(orig.trim()); if (alias) aliases[alias.trim()] = orig.trim(); }
    }
    imports.push({ spec: m[1], names, aliases, from: true, line: at(m.index) });
  }

  const symbols = [];
  for (const m of all(/^(?:async[ \t]+)?def[ \t]+([A-Za-z]\w*)/gm, code)) symbols.push({ name: m[1], kind: 'function', line: at(m.index) });
  for (const m of all(/^class[ \t]+([A-Za-z]\w*)/gm, code)) symbols.push({ name: m[1], kind: 'class', line: at(m.index) });
  symbols.sort((a, b) => a.line - b.line);

  const routes = [];
  const routers = {};
  for (const m of all(/^[ \t]*([A-Za-z_]\w*)\s*=\s*(?:\w+\.)?(Blueprint|APIRouter|Router)\(([^)]*)\)/gm, code)) {
    routers[m[1]] = /(?:url_)?prefix\s*=\s*["']([^"']*)["']/.exec(m[3])?.[1] || '';
  }
  for (const m of all(/^[ \t]*@([A-Za-z_]\w*)\.(route|get|post|put|patch|delete|api_route|websocket)\(\s*[rf]?["']([^"']*)["']([^\n]*)/gm, code)) {
    let methods = [m[2].toUpperCase()];
    if (m[2] === 'route' || m[2] === 'api_route') {
      // the decorator's arguments may continue over several lines, up to the next decorator or def
      const rest = code.slice(m.index + m[0].length - m[4].length, m.index + m[0].length + 400).split(/\n\s*(?:@|def |async def )/)[0];
      const ms = /methods\s*=\s*[\[(]([^\])]*)[\])]/.exec(rest);
      methods = ms ? [...ms[1].matchAll(/["'](\w+)["']/g)].map((x) => x[1].toUpperCase()) : ['GET'];
    }
    for (const method of methods) routes.push({ method, path: m[3], var: m[1], line: at(m.index) });
  }
  // Django urls.py
  for (const m of all(/\b(?:re_)?path\(\s*r?["']([^"']*)["']\s*,\s*(?!include)/g, code)) routes.push({ method: 'ANY', path: '/' + m[1].replace(/^\^|\$$/g, ''), var: null, line: at(m.index), framework: 'django' });

  const mounts = [];
  for (const m of all(/\b(register_blueprint|include_router|mount)\(\s*([A-Za-z_][\w.]*)/g, code)) {
    // the call's arguments, up to its own closing bracket: dependencies=[Depends(x)] holds brackets of its own
    let depth = 1, j = m.index + m[0].length;
    while (j < code.length && depth && j - m.index < 2000) { if (code[j] === '(') depth++; else if (code[j] === ')') depth--; j++; }
    const args = code.slice(m.index + m[0].length, j - 1);
    // FastAPI checks applied to every route of the router where it's included:
    // app.include_router(admin.router, dependencies=[Depends(require_admin)])
    const deps = m[1] === 'include_router' ? /dependencies\s*=\s*\[([\s\S]*?)\]/.exec(args)?.[1] : null;
    const mw = deps ? [...deps.matchAll(/\b(?:Depends|Security)\(\s*([\w.]+)/g)].map((d) => d[1].split('.').pop()) : [];
    mounts.push({ var: m[2], prefix: /(?:url_)?prefix\s*=\s*["']([^"']*)["']/.exec(args)?.[1] || '', line: at(m.index), ...(mw.length ? { mw } : {}) });
  }

  const routeLine = /^\s*@\w+\.(route|get|post|put|patch|delete)\(/;
  const { calls, hosts } = extractCalls(code, at, { skip: routeLine });
  return { imports, symbols, routes, mounts, calls, hosts, routers };
}

// ---------- Go ----------

function extractGo(src) {
  const code = stripCStyle(src);
  const at = lineIndex(code);
  const imports = [];
  for (const m of all(/^import\s+(?:[\w.]+\s+)?"([^"]+)"/gm, code)) imports.push({ spec: m[1], names: [], line: at(m.index) });
  for (const block of all(/^import\s*\(([\s\S]*?)\)/gm, code)) {
    for (const m of all(/(?:[\w.]+\s+)?"([^"]+)"/g, block[1])) imports.push({ spec: m[1], names: [], line: at(block.index) });
  }
  const symbols = [];
  for (const m of all(/^func\s+(?:\([^)]*\)\s*)?([A-Z]\w*)/gm, code)) symbols.push({ name: m[1], kind: 'function', line: at(m.index) });
  for (const m of all(/^type\s+([A-Z]\w*)\s+(struct|interface)?/gm, code)) symbols.push({ name: m[1], kind: m[2] || 'type', line: at(m.index) });
  const routes = [];
  // Gin / Echo / Fiber groups: v1 := r.Group("/api/v1"); users := v1.Group("/users"); users.GET("/:id", h)
  const groups = new Map();
  for (const m of all(/\b(\w+)\s*:?=\s*(\w+)\.Group\(\s*"([^"]*)"/g, code)) groups.set(m[1], (groups.get(m[2]) || '') + m[3]);
  const groupOf = (v) => groups.get(v) || '';
  const chiPrefix = chiSpans(code);
  // Go 1.22 patterns carry the method: http.HandleFunc("POST /items/{id}", h)
  for (const m of all(/\b(\w+)\.(HandleFunc|Handle|GET|POST|PUT|PATCH|DELETE|Get|Post|Put|Patch|Delete)\(\s*"((?:(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+)?(?:[\w.-]+)?\/[^"]*)"/g, code)) {
    const verb = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+/.exec(m[3])?.[1];
    const method = /^handle/i.test(m[2]) ? (verb || 'ANY') : m[2].toUpperCase();
    // a host in the pattern ("example.com/x") isn't part of the path
    const chi = chiPrefix(m.index);
    let p = (chi === '/' ? '' : chi) + groupOf(m[1]) + m[3].replace(/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+/, '').replace(/^[\w.-]+(?=\/)/, '');
    if (chi !== '/') p = p.replace(/(.)\/$/, '$1'); // r.Get("/") inside r.Route("/users") is /users
    routes.push({ method, path: p, var: null, line: at(m.index) });
  }
  const { calls, hosts } = extractCalls(code, at, { skip: /\.(HandleFunc|Handle|GET|POST)\(/ });
  return { imports, symbols, routes, mounts: [], calls, hosts };
}

// ---------- Rust ----------

function extractRust(src) {
  const code = stripCStyle(src);
  const at = lineIndex(code);
  const imports = [];
  for (const m of all(/^[ \t]*(?:pub(?:\([^)]*\))?\s+)?mod\s+(\w+)\s*;/gm, code)) imports.push({ spec: m[1], kind: 'mod', names: [], line: at(m.index) });
  for (const m of all(/^[ \t]*(?:pub(?:\([^)]*\))?\s+)?use\s+([\w:]+)/gm, code)) imports.push({ spec: m[1], kind: 'use', names: [], line: at(m.index) });
  const symbols = [];
  for (const m of all(/^[ \t]*pub\s+(?:async\s+)?(fn|struct|enum|trait|type|const|static)\s+(\w+)/gm, code)) symbols.push({ name: m[2], kind: m[1] === 'fn' ? 'function' : m[1], line: at(m.index) });
  const routes = [];
  for (const m of all(/#\[(get|post|put|patch|delete)\(\s*"([^"]+)"/g, code)) routes.push({ method: m[1].toUpperCase(), path: m[2], var: null, line: at(m.index) });
  for (const m of all(/\.route\(\s*"([^"]+)"\s*,\s*(get|post|put|patch|delete)/g, code)) routes.push({ method: m[2].toUpperCase(), path: m[1], var: null, line: at(m.index) });
  const { calls, hosts } = extractCalls(code, at);
  return { imports, symbols, routes, mounts: [], calls, hosts };
}

// ---------- JVM ----------

function extractJvm(src, filePath) {
  const code = stripCStyle(src);
  const at = lineIndex(code);
  const pkg = /^\s*package\s+([\w.]+)/m.exec(code)?.[1] || null;
  const imports = all(/^\s*import\s+(?:static\s+)?([\w.*]+)/gm, code).map((m) => ({ spec: m[1], names: [], line: at(m.index) }));
  const symbols = [];
  for (const m of all(/^\s*(?:public\s+|internal\s+)?(?:abstract\s+|final\s+|data\s+|sealed\s+|open\s+)*(class|interface|enum|record|object)\s+(\w+)/gm, code)) symbols.push({ name: m[2], kind: m[1], line: at(m.index) });
  // Kotlin top-level functions, which include Jetpack Compose screens: @Composable fun OrderScreen(…)
  if (/\.kts?$/.test(filePath || '')) for (const m of all(/^(?:@\w+(?:\([^)]*\))?\s+)*(?:(?:private|internal|public|suspend|inline)\s+)*fun\s+(?:<[^>\n]*>\s*)?([A-Za-z_]\w*)\s*\(/gm, code)) symbols.push({ name: m[1], kind: 'function', line: at(m.index) });
  const routes = [];
  const classPrefix = /@RequestMapping\(\s*(?:value\s*=\s*|path\s*=\s*)?"([^"]*)"[^)]*\)\s*(?:@\w+(?:\([^)]*\))?\s*)*(?:public\s+)?class/.exec(code)?.[1] || '';
  // @GetMapping, @GetMapping("/x"), @GetMapping(value = {"/a", "/b"}), @RequestMapping(path = "/x", method = RequestMethod.POST)
  const classAt = /@RequestMapping\([^)]*\)\s*(?:@\w+(?:\([^)]*\))?\s*)*(?:public\s+|open\s+|internal\s+)?(?:final\s+)?class/.exec(code)?.index ?? -1;
  for (const m of all(/@(Get|Post|Put|Patch|Delete|Request)Mapping\b(?:\(([^)]*)\))?/g, code)) {
    if (m[1] === 'Request' && m.index === classAt) continue;
    const args = m[2] || '';
    const list = /\{([^}]*)\}/.exec(args)?.[1] ?? /^\s*(?:(?:value|path)\s*=\s*)?("[^"]*")/.exec(args)?.[1] ?? /(?:value|path)\s*=\s*("[^"]*")/.exec(args)?.[1] ?? '';
    const paths = [...list.matchAll(/"([^"]*)"/g)].map((x) => x[1]);
    const verb = m[1] === 'Request' ? (/RequestMethod\.(GET|POST|PUT|PATCH|DELETE)/.exec(args)?.[1] || 'ANY') : m[1].toUpperCase();
    for (const p of paths.length ? paths : ['']) routes.push({ method: verb, path: ('/' + [classPrefix, p].map((x) => x.replace(/^\/+|\/+$/g, '')).filter(Boolean).join('/')), var: null, line: at(m.index) });
  }
  const { calls, hosts } = extractCalls(code, at, { skip: /@\w+Mapping|^\s*@(GET|POST|PUT|PATCH|DELETE|HEAD)\(/ });
  calls.push(...annotationCalls(code, at), ...mobileCallables(code, at));
  return { imports, symbols, routes, mounts: [], calls, hosts, pkg, idents: typeIdents(code), ...(/\bcomposable\b|\bobject\s+\w+\s*:/.test(code) ? { consts: routeConsts(code, 'kotlin') } : {}) };
}

// ---------- mobile: Dart (Flutter), Swift (iOS), Kotlin client calls (Android) ----------

const ANNOT_CALL = /@(GET|POST|PUT|PATCH|DELETE|HEAD)\(\s*(?:value\s*=\s*)?(["'])([^"'\n]*)\2/g;
/**
 * Retrofit-style client interfaces (Retrofit on Android, retrofit.dart in Flutter): `@GET("users/{id}")`
 * names a request the app makes. Paths may be relative to a base URL, so they get a leading slash; a
 * retrofit.dart `@RestApi(baseUrl: '/tasks')` prefix is joined on. (Spring uses @GetMapping, and JAX-RS a
 * bare @GET with @Path, so neither reads as a call.)
 */
function annotationCalls(code, at) {
  const base = /@RestApi\(\s*(?:baseUrl\s*:\s*)?(["'])([^"'\n]*)\1/.exec(code)?.[2] || '';
  const basePath = /^https?:\/\//i.test(base) ? '' : base;
  const out = [];
  for (const m of code.matchAll(ANNOT_CALL)) {
    let p = m[3];
    if (/^https?:\/\//i.test(p)) { const n = normalizeCallLiteral(p); if (n?.path) out.push({ path: n.path, method: m[1], line: at(m.index) }); continue; }
    if (basePath && !p.startsWith('/')) p = basePath.replace(/\/$/, '') + '/' + p;
    const n = normalizeCallLiteral(('/' + p).replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/');
    if (n?.path) out.push({ path: n.path, method: m[1], line: at(m.index) });
  }
  return out;
}
/** Firebase callables from a mobile app: httpsCallable('x') (Flutter, Swift), getHttpsCallable("x") (Android). */
function mobileCallables(code, at) {
  return [...code.matchAll(/\b(?:get)?[Hh]ttpsCallable\(\s*(?:name\s*:\s*)?(["'])([\w-]+)\1/g)].map((m) => ({ path: callablePath(m[2]), method: 'CALL', line: at(m.index) }));
}
/** Capitalised identifiers a file mentions: Swift and Kotlin see types of their own module without importing them. */
const typeIdents = (code) => [...new Set(code.replace(/(["'])(?:\\.|(?!\1)[^\\\n])*\1/g, '""').match(/\b[A-Z][A-Za-z0-9_]{2,}\b/g) || [])];

function extractDart(src, filePath) {
  const code = stripCStyle(src);
  const at = lineIndex(code);
  const imports = [];
  for (const m of all(/^[ \t]*(import|export|part)\s+(["'])([^"'\n]+)\2([^;\n]*)/gm, code)) {
    if (/^\s*of\b/.test(m[4]) || m[1] === 'part' && /^\s*of\b/.test(m[3])) continue;
    const show = /\bshow\s+([\w\s,]+)/.exec(m[4])?.[1];
    imports.push({ spec: m[3], names: show ? show.split(',').map((x) => x.trim()).filter(Boolean) : [], line: at(m.index), ...(m[1] === 'export' ? { reexport: true } : {}) });
  }
  const symbols = [];
  for (const m of all(/^(?:(?:abstract|sealed|base|final|interface|mixin)\s+)*(class|mixin|enum|extension|typedef)\s+([A-Za-z_]\w*)/gm, code)) symbols.push({ name: m[2], kind: m[1] === 'extension' ? 'extension' : m[1], line: at(m.index) });
  // top-level functions: `Future<void> bootstrap() async {`, `String formatPrice(int c) =>`
  for (const m of all(/^(?:[A-Za-z_][\w.]*(?:<[^>\n]*>)?\??\s+)?([a-z_]\w*)\s*(?:<[^>\n]*>)?\s*\([^;{]*\)\s*(?:async\*?\s*)?(?:\{|=>)/gm, code)) {
    if (!/^(if|for|while|switch|return|main)$/.test(m[1])) symbols.push({ name: m[1], kind: 'function', line: at(m.index) });
  }
  symbols.sort((a, b) => a.line - b.line);
  // Dart servers: shelf_router (router.get('/x', h), ..mount('/api', Api().router.call)) and dart_frog file routes
  const routes = [], mounts = [];
  const shelf = /package:shelf_router\//.test(code);
  if (shelf) {
    for (const m of all(/(?:\b(\w+)|\))\s*\.\.?(get|post|put|patch|delete|head|options|all)\s*\(\s*(['"])(\/[^'"\n]*)\3/g, code)) routes.push({ method: m[2] === 'all' ? 'ANY' : m[2].toUpperCase(), path: m[4], var: m[1] || null, line: at(m.index) });
    for (const m of all(/\.\.?mount\(\s*(['"])([^'"\n]*)\1\s*,\s*(?:const\s+|new\s+)?([A-Za-z_]\w*)(\s*\()?/g, code)) mounts.push({ prefix: m[2], ...(m[4] && /^[A-Z]/.test(m[3]) ? { cls: m[3] } : { var: m[3] }), line: at(m.index) });
  }
  const frog = /(?:^|\/)routes\/(.*?)\.dart$/.exec(filePath || '');
  if (frog && /package:dart_frog\//.test(code) && /\bonRequest\s*\(/.test(code)) {
    const p = '/' + frog[1].split('/').filter((x) => x && x !== 'index' && !x.startsWith('_')).join('/');
    routes.push({ method: 'ANY', path: p, var: null, line: at(code.search(/\bonRequest\s*\(/)), framework: 'dart_frog' });
  }
  const { calls, hosts } = extractCalls(code, at, { skip: shelf ? /^\s*@(GET|POST|PUT|PATCH|DELETE|HEAD)\(|\.\.?(get|post|put|patch|delete|head|options|all|mount)\s*\(\s*['"]\// : /^\s*@(GET|POST|PUT|PATCH|DELETE|HEAD)\(/ });
  calls.push(...annotationCalls(code, at), ...mobileCallables(code, at));
  return { imports, symbols, routes, mounts, calls, hosts, consts: routeConsts(code, 'dart') };
}

/**
 * String constants a router may refer to by name: Dart `static const login = '/login'` (also as
 * Routes.login, with $other interpolations filled in) and Kotlin `const val HOME = "home"`,
 * `data object Home : Screen("home")`. Used to turn GoRoute(path: Routes.login) and
 * composable(Screen.Home.route) into URLs.
 */
function routeConsts(code, lang) {
  const raw = [];
  const classAt = (i) => [...code.slice(0, i).matchAll(/\b(?:class|object|interface)\s+(\w+)/g)].pop()?.[1] || null;
  if (lang === 'dart') for (const m of code.matchAll(/\b(?:static\s+)?const\s+(?:String\s+)?(\w+)\s*=\s*(['"])([^'"\n]*)\2\s*;/g)) raw.push([m[1], m[3], classAt(m.index)]);
  else {
    for (const m of code.matchAll(/\b(?:const\s+val|val)\s+(\w+)\s*(?::\s*String)?\s*=\s*"([^"\n]*)"/g)) raw.push([m[1], m[2], classAt(m.index)]);
    for (const m of code.matchAll(/\bobject\s+(\w+)\s*:\s*[\w.]+\s*\(\s*(?:route\s*=\s*)?"([^"\n]*)"/g)) raw.push([m[1], m[2], null]);
  }
  const out = {};
  const local = new Map(raw.map(([n, v]) => [n, v]));
  const fill = (v, depth = 0) => depth > 4 ? v : v.replace(/\$\{?(\w+)\}?/g, (m0, n) => (local.has(n) ? fill(local.get(n), depth + 1) : m0));
  for (const [n, v, cls] of raw) {
    if (!/^[\w\-/:{}$<>.]*$/.test(v) || v.length > 200) continue;
    const val = fill(v);
    if (/\$/.test(val)) continue;
    out[n] = val;
    if (cls) out[`${cls}.${n}`] = val;
  }
  return Object.keys(out).length ? out : undefined;
}


function extractSwift(src) {
  const code = stripCStyle(src);
  const at = lineIndex(code);
  const imports = all(/^[ \t]*(?:@testable\s+|@_exported\s+)?import\s+(?:(?:class|struct|enum|protocol|func|var|typealias)\s+)?([A-Za-z_][\w]*)/gm, code)
    .map((m) => ({ spec: m[1], names: [], line: at(m.index), kind: 'module' }));
  const symbols = [];
  for (const m of all(/^[ \t]*(?:@\w+(?:\([^)]*\))?\s+)*(?:(?:public|internal|private|fileprivate|open|final|indirect|nonisolated)\s+)*(class|struct|enum|protocol|actor)\s+([A-Za-z_]\w*)/gm, code)) symbols.push({ name: m[2], kind: m[1], line: at(m.index) });
  const { calls, hosts } = extractCalls(code, at);
  calls.push(...mobileCallables(code, at));
  return { imports, symbols, routes: [], mounts: [], calls, hosts, idents: typeIdents(code) };
}

// ---------- small ones ----------

function extractSimple(src, lang, filePath = '') {
  const code = lang === 'ruby' ? stripHash(src) : stripCStyle(src);
  const at = lineIndex(code);
  const imports = [];
  if (lang === 'ruby') for (const m of all(/\brequire_relative\s*\(?\s*["']([^"']+)["']/g, code)) imports.push({ spec: './' + m[1].replace(/^\.\//, ''), names: [], line: at(m.index) });
  if (lang === 'c' || lang === 'cpp' || lang === 'objc') for (const m of all(/^\s*#\s*(?:include|import)\s+"([^"]+)"/gm, code)) imports.push({ spec: m[1], names: [], kind: 'include', line: at(m.index) });
  if (lang === 'php') for (const m of all(/\b(?:require|include)(?:_once)?\s*\(?\s*(?:__DIR__\s*\.\s*)?["']([^"']+)["']/g, code)) imports.push({ spec: m[1].startsWith('/') ? '.' + m[1] : m[1], names: [], line: at(m.index) });
  if (lang === 'css') for (const m of all(/@(?:import|use|forward)\s+(?:url\()?["']([^"']+)["']/g, code)) imports.push({ spec: m[1].startsWith('.') ? m[1] : './' + m[1], names: [], line: at(m.index) });
  const symbols = [];
  if (lang === 'ruby') for (const m of all(/^\s*(class|module)\s+([A-Z][\w:]*)/gm, code)) symbols.push({ name: m[2], kind: m[1], line: at(m.index) });
  if (lang === 'csharp') for (const m of all(/^\s*public\s+(?:static\s+|abstract\s+|sealed\s+|partial\s+)*(class|interface|enum|record|struct)\s+(\w+)/gm, code)) symbols.push({ name: m[2], kind: m[1], line: at(m.index) });
  const { calls, hosts } = ['ruby', 'php', 'csharp'].includes(lang) ? extractCalls(code, at) : { calls: [], hosts: [] };
  const routes = lang === 'php' ? laravelRoutes(code, at, filePath) : lang === 'ruby' ? railsRoutes(code, filePath) : lang === 'csharp' ? aspnetRoutes(code, at) : [];
  return { imports, symbols, routes, mounts: [], calls, hosts };
}

function extractByLang(src, lang, filePath) {
  switch (lang) {
    case 'typescript': case 'javascript': case 'vue': case 'svelte': case 'astro': return extractJs(src, filePath);
    case 'python': return extractPy(src);
    case 'go': return extractGo(src);
    case 'rust': return extractRust(src);
    case 'dart': return extractDart(src, filePath);
    case 'swift': return extractSwift(src);
    case 'java': case 'kotlin': case 'scala': case 'groovy': return extractJvm(src, filePath);
    default: return extractSimple(src, lang, filePath);
  }
}

export function extract(src, lang, filePath) {
  const r = extractByLang(src, lang, filePath);
  addDocs(src, lang, r);
  return r;
}

// ---------- docs: file headers, docstrings, JSDoc, route handlers ----------

const HASH_LANGS = new Set(['python', 'ruby', 'shell', 'powershell', 'r', 'elixir', 'perl']);
const LICENSE = /copyright|license|spdx|eslint-disable|@ts-nocheck|prettier-ignore|^-\*-|coding[:=]|generated by|do not edit/i;

export function cleanDoc(text) {
  if (!text) return null;
  const lines = text.split('\n')
    .map((l) => l.replace(/^\s*(\/\*\*?|\*\/|\*|\/\/\/?|#+|"""|''')\s?/, '').replace(/(\*\/|"""|''')\s*$/, '').trim())
    .filter((l) => l && !/^@\w+/.test(l) && !/^[-=*_]{3,}$/.test(l));
  // first paragraph only
  const para = [];
  for (const l of lines) { if (!l && para.length) break; para.push(l); }
  let s = para.join(' ').replace(/\s+/g, ' ').trim();
  if (!s || s.length < 8 || LICENSE.test(s)) return null;
  const sentence = /^(.{20,220}?[.!?])(\s|$)/.exec(s);
  s = sentence ? sentence[1] : s.length > 220 ? s.slice(0, 217).replace(/\s+\S*$/, '') + '…' : s;
  return s;
}

function pyDocAfter(lines, idx) {
  // idx: 0-based line of the def/class (or -1 for module). Find the end of the signature, then a string literal.
  let i = idx;
  if (idx >= 0) {
    while (i < lines.length && i < idx + 20 && !/:\s*(#.*)?$/.test(lines[i])) i++;
    i++;
  } else i = 0;
  while (i < lines.length && (!lines[i].trim() || (idx < 0 && /^\s*(#|from __future__)/.test(lines[i])))) i++;
  const first = lines[i];
  if (!first) return null;
  const m = /^\s*[rRbBuUfF]?("""|''')(.*)$/.exec(first);
  if (!m) return idx < 0 ? hashHeader(lines) : null;
  const q = m[1];
  if (m[2].includes(q)) return cleanDoc(m[2].slice(0, m[2].indexOf(q)));
  const buf = [m[2]];
  for (let j = i + 1; j < lines.length && j < i + 40; j++) {
    const k = lines[j].indexOf(q);
    if (k >= 0) { buf.push(lines[j].slice(0, k)); break; }
    buf.push(lines[j]);
  }
  return cleanDoc(buf.join('\n'));
}

function hashHeader(lines) {
  const buf = [];
  for (const l of lines) {
    if (/^#!/.test(l)) continue;
    if (/^\s*#/.test(l)) { buf.push(l); continue; }
    if (!l.trim() && !buf.length) continue;
    break;
  }
  return cleanDoc(buf.join('\n'));
}

function commentBefore(lines, idx) {
  // idx: 0-based line of the declaration. Skip decorators/annotations, then read a /** */ block or // run.
  let i = idx - 1;
  while (i >= 0 && /^\s*@/.test(lines[i])) i--;
  if (i < 0) return null;
  if (/\*\/\s*$/.test(lines[i])) {
    const end = i;
    while (i >= 0 && !/\/\*/.test(lines[i])) i--;
    return i >= 0 ? cleanDoc(lines.slice(i, end + 1).join('\n')) : null;
  }
  const buf = [];
  while (i >= 0 && /^\s*(\/\/|#(?!!))/.test(lines[i])) buf.unshift(lines[i--]);
  return buf.length ? cleanDoc(buf.join('\n')) : null;
}

function headerComment(lines) {
  let i = 0;
  while (i < lines.length && (!lines[i].trim() || /^\s*['"]use (client|server|strict)['"];?\s*$/.test(lines[i]) || /^#!/.test(lines[i]))) i++;
  const l = lines[i] || '';
  if (/^\s*\/\*/.test(l)) {
    const start = i;
    while (i < lines.length && !/\*\//.test(lines[i])) i++;
    return cleanDoc(lines.slice(start, i + 1).join('\n'));
  }
  const buf = [];
  while (i < lines.length && /^\s*\/\//.test(lines[i])) buf.push(lines[i++]);
  return cleanDoc(buf.join('\n'));
}

function addDocs(src, lang, r) {
  const lines = src.split('\n');
  r.doc = lang === 'python' ? pyDocAfter(lines, -1) : HASH_LANGS.has(lang) ? hashHeader(lines) : headerComment(lines);
  for (const s of r.symbols || []) {
    const d = lang === 'python' ? pyDocAfter(lines, s.line - 1) : commentBefore(lines, s.line - 1);
    if (d) s.doc = d;
  }
  // A route's handler is the first declaration after it (decorator-style frameworks).
  // (a Firebase function's export isn't the handler of the Express routes above it)
  const fbNames = new Set((r.routes || []).filter((rt) => rt.framework === 'firebase').map((rt) => rt.handler));
  const syms = (r.symbols || []).filter((s) => !fbNames.has(s.name)).sort((a, b) => a.line - b.line);
  for (const rt of r.routes || []) {
    if (rt.framework === 'next') { rt.handler = rt.method; continue; }
    if (rt.framework === 'firebase') { const d = r.symbols.find((s) => s.name === rt.handler)?.doc || commentBefore(lines, rt.line - 1); if (d) rt.doc = d; continue; }
    // (not the router itself: `module.exports = router` right after the routes isn't their handler)
    const h = syms.find((s) => s.line >= rt.line && s.line - rt.line <= 12 && s.name !== rt.var);
    if (h) { rt.handler = h.name; if (h.doc) rt.doc = h.doc; }
    else if (lang === 'python') {
      const m = lines.slice(rt.line, rt.line + 12).findIndex((l) => /^\s*(async\s+)?def\s+\w+/.test(l));
      if (m >= 0) {
        rt.handler = /def\s+(\w+)/.exec(lines[rt.line + m])[1];
        const d = pyDocAfter(lines, rt.line + m);
        if (d) rt.doc = d;
      }
    }
  }
}
