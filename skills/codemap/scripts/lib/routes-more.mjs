// Endpoints in frameworks whose routes live in route files or attributes: Laravel (routes/*.php), Rails
// (config/routes.rb), ASP.NET (attribute routing and minimal APIs), and chi's nested r.Route groups in Go.
// Regex-based like the rest of extraction; each returns [{ method, path, var: null, line, framework }].

const join = (...parts) => '/' + parts.map((p) => String(p || '').replace(/^\/+|\/+$/g, '')).filter(Boolean).join('/');

/** Index of the bracket that closes the one at i (strings skipped roughly). */
function closeOf(s, i, open, close) {
  let d = 0, q = null;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (q) { if (c === '\\') { j++; continue; } if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === open) d++;
    else if (c === close && --d === 0) return j;
  }
  return -1;
}

// ---------- Laravel ----------
const LARAVEL_RESOURCE = [['GET', ''], ['POST', ''], ['GET', '/{id}'], ['PUT', '/{id}'], ['PATCH', '/{id}'], ['DELETE', '/{id}']];
export function laravelRoutes(code, at, filePath) {
  if (!/\bRoute::/.test(code)) return [];
  // routes/api.php is served under /api by default
  const base = /(^|\/)routes\/api\.php$/.test(filePath) ? '/api' : '';
  // groups: Route::prefix('admin')->middleware('auth')->group(function () { … })  /  Route::group(['prefix' => 'x'], function …)
  const groups = [];
  for (const m of code.matchAll(/Route::([^;]*?)group\(\s*(\[[^\]]*\]\s*,\s*)?(?:static\s+)?function\s*\([^)]*\)\s*(?:use\s*\([^)]*\)\s*)?\{/g)) {
    const chain = m[1] + (m[2] || '');
    const prefix = /prefix\(\s*['"]([^'"]*)['"]\s*\)/.exec(chain)?.[1] ?? /['"]prefix['"]\s*=>\s*['"]([^'"]*)['"]/.exec(chain)?.[1] ?? '';
    const open = m.index + m[0].length - 1;
    groups.push({ open, close: closeOf(code, open, '{', '}'), prefix, auth: /middleware\([^)]*auth|['"]middleware['"]\s*=>[^,\]]*auth/.test(chain) });
  }
  const prefixAt = (i) => groups.filter((g) => g.open < i && g.close > i).sort((a, b) => a.open - b.open);
  const out = [];
  const add = (method, p, i, extra = {}) => { const gs = prefixAt(i); out.push({ method, path: join(base, ...gs.map((g) => g.prefix), p), var: null, line: at(i), framework: 'laravel', ...(gs.some((g) => g.auth) ? { mw: ['auth'] } : {}), ...extra }); };
  for (const m of code.matchAll(/Route::(get|post|put|patch|delete|options|any)\(\s*['"]([^'"]*)['"]/g)) add(m[1] === 'any' ? 'ANY' : m[1].toUpperCase(), m[2], m.index);
  for (const m of code.matchAll(/Route::match\(\s*\[([^\]]*)\]\s*,\s*['"]([^'"]*)['"]/g)) for (const v of m[1].match(/[a-zA-Z]+/g) || []) add(v.toUpperCase(), m[2], m.index);
  for (const m of code.matchAll(/Route::(apiResource|resource)\(\s*['"]([^'"]*)['"]/g)) for (const [v, sfx] of LARAVEL_RESOURCE) add(v, m[2] + sfx, m.index);
  return out;
}

// ---------- Rails ----------
const RAILS_RESOURCES = [['GET', ''], ['POST', ''], ['GET', '/:id'], ['PATCH', '/:id'], ['PUT', '/:id'], ['DELETE', '/:id']];
export function railsRoutes(src, filePath) {
  if (!/(^|\/)config\/routes\.rb$/.test(filePath)) return [];
  const out = [];
  const stack = []; // prefixes of the open do…end blocks (null for blocks that add none)
  const lines = src.split('\n');
  const pre = () => stack.filter(Boolean);
  lines.forEach((raw, i) => {
    const l = raw.replace(/#.*$/, '');
    const t = l.trim();
    if (!t) return;
    let m;
    if ((m = /^(get|post|put|patch|delete|match)\s+['"]([^'"]+)['"]/.exec(t))) {
      const verbs = m[1] === 'match' ? (/via:\s*\[?([^\]\n]*)/.exec(t)?.[1].match(/\w+/g) || ['any']).map((v) => v.toUpperCase()) : [m[1].toUpperCase()];
      for (const v of verbs) out.push({ method: v === 'ANY' ? 'ANY' : v, path: join(...pre(), m[2]), var: null, line: i + 1, framework: 'rails' });
    } else if ((m = /^root\b/.exec(t))) out.push({ method: 'GET', path: join(...pre()), var: null, line: i + 1, framework: 'rails' });
    else if ((m = /^(resources|resource)\s+:(\w+)(.*)$/.exec(t))) {
      const only = /only:\s*(?:\[([^\]]*)\]|:(\w+))/.exec(m[3]);
      const keep = only ? (only[1] || only[2]).match(/\w+/g) : null;
      const actions = m[1] === 'resource'
        ? [['GET', '', 'show'], ['POST', '', 'create'], ['PATCH', '', 'update'], ['PUT', '', 'update'], ['DELETE', '', 'destroy']]
        : RAILS_RESOURCES.map(([v, s], k) => [v, s, ['index', 'create', 'show', 'update', 'update', 'destroy'][k]]);
      for (const [v, s, a] of actions) if (!keep || keep.includes(a)) out.push({ method: v, path: join(...pre(), m[2] + s), var: null, line: i + 1, framework: 'rails' });
      // nested: resources :posts do resources :comments end -> /posts/:post_id/comments
      if (/\bdo\b/.test(m[3])) stack.push(m[1] === 'resources' ? `${m[2]}/:${m[2].replace(/s$/, '')}_id` : m[2]);
      return;
    }
    if (/\bdo\b(\s*\|[^|]*\|)?\s*$/.test(t)) {
      const ns = /^(?:namespace|scope)\s+(?::(\w+)|['"]([^'"]*)['"])/.exec(t);
      const scopePath = /^scope\b.*path:\s*['"]([^'"]*)['"]/.exec(t)?.[1];
      stack.push(scopePath ?? (ns ? (ns[1] ?? ns[2]) : null));
    } else if (/^end\b/.test(t)) stack.pop();
  });
  return out;
}

// ---------- ASP.NET ----------
export function aspnetRoutes(code, at) {
  const out = [];
  // attribute routing: [Route("api/[controller]")] public class OrdersController … { [HttpGet("{id}")] … }
  for (const c of code.matchAll(/(?:\[(?:Route|ApiController)[^\]]*\]\s*)*\bclass\s+(\w+?)(Controller)?\s*:\s*\w*Controller(?:Base)?\b/g)) {
    const head = code.slice(Math.max(0, c.index - 300), c.index);
    const route = [...head.matchAll(/\[Route\(\s*"([^"]*)"\s*\)\]/g)].pop()?.[1] || '';
    const open = code.indexOf('{', c.index);
    const close = open < 0 ? -1 : closeOf(code, open, '{', '}');
    if (close < 0) continue;
    const prefix = route.replace(/\[controller\]/gi, c[1].toLowerCase());
    const body = code.slice(open, close);
    for (const m of body.matchAll(/\[Http(Get|Post|Put|Patch|Delete)(?:\(\s*"([^"]*)"[^)]*\))?\]/g)) {
      const p = m[2] || '';
      out.push({ method: m[1].toUpperCase(), path: p.startsWith('/') || p.startsWith('~/') ? join(p.replace(/^~/, '')) : join(prefix, p), var: null, line: at(open + m.index), framework: 'aspnet' });
    }
  }
  // minimal APIs: var api = app.MapGroup("/api"); api.MapGet("/orders/{id}", …)
  const groups = new Map();
  for (const m of code.matchAll(/\b(?:var\s+)?(\w+)\s*=\s*(\w+)\.MapGroup\(\s*"([^"]*)"/g)) groups.set(m[1], join(groups.get(m[2]) || '', m[3]));
  for (const m of code.matchAll(/\b(\w+)\.Map(Get|Post|Put|Patch|Delete)\(\s*"([^"]*)"/g)) out.push({ method: m[2].toUpperCase(), path: join(groups.get(m[1]) || '', m[3]), var: null, line: at(m.index), framework: 'aspnet' });
  return out;
}

// ---------- chi (Go) ----------
/** Prefix spans of r.Route("/users", func(r chi.Router) { … }): routes inside take the joined prefix. */
export function chiSpans(code) {
  const spans = [];
  for (const m of code.matchAll(/\.Route\(\s*"([^"]*)"\s*,\s*func\s*\([^)]*\)\s*\{/g)) {
    const open = m.index + m[0].length - 1;
    spans.push({ open, close: closeOf(code, open, '{', '}'), prefix: m[1] });
  }
  return (i) => join(...spans.filter((s) => s.open < i && s.close > i).sort((a, b) => a.open - b.open).map((s) => s.prefix));
}
