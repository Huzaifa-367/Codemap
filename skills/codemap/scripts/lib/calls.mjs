// Function level: every function and method in a file (exported or not), with the line range it covers, and
// the calls between them: within a file, through imports, and through the types Swift / Kotlin / Dart files
// see without importing. Regex-based like the rest of the scan: no parser, no dependencies, no tokens.
//
// findDefs(src, lang)            -> [{ name, line, end }]   (1-based, inclusive)
// linkCalls({ files, edges })    -> calls: [[fromPath, fromIdx, toPath, toIdx, line, loose?]]
//   files: scanned files with .fns (from findDefs) and .imports (resolved); read(path) returns a file's source
//   edges: file -> file links already known (imports and same-module references), used for member calls

const KEYWORDS = new Set('if for while switch catch return function typeof new await yield throw case do else try finally with elif except lambda def class super this self print assert import from export sizeof when guard defer match loop unsafe async'.split(' '));
// calls that are the language's or framework's own, never a function of the app
const NOISE = new Set(('log error warn info debug map filter reduce forEach some every find findIndex includes push pop shift unshift slice splice concat join split ' +
  'replace trim toString toLowerCase toUpperCase then catch finally resolve reject keys values entries assign freeze stringify parse json text send status end ' +
  'set get has add delete clear emit on once off use listen next require setTimeout setInterval clearTimeout useState useEffect useMemo useCallback useRef ' +
  'useContext useReducer setState notifyListeners len str int float bool dict list tuple range enumerate zip sorted isinstance append extend items format ' +
  'print println printf Sprintf Errorf Println Printf append make copy panic close fmt toJson fromJson copyWith dispose initState build Text Container ' +
  'Column Row Padding SizedBox Scaffold Center Expanded ListView Icon Spacer VStack HStack ZStack Image Button Label NavigationStack List ForEach ' +
  'Modifier remember mutableStateOf LaunchedEffect collectAsState launch withContext emptyList listOf mapOf mutableListOf require check error toInt ' +
  'Date Promise Error Object Array String Number Boolean Math JSON Map Set URL Response Request fetch axios create isEmpty isNotEmpty contains decode encode').split(' '));

const stripStrings = (line) => line.replace(/(["'`])(?:\\.|(?!\1)[^\\])*\1/g, (m) => m[0] + ' '.repeat(Math.max(0, m.length - 2)) + m[m.length - 1]);
const stripComments = (src, hash) => {
  let s = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  s = s.replace(/(^|[^:"'`\\])\/\/[^\n]*/g, (m, pre) => pre + ' '.repeat(m.length - pre.length));
  if (hash) s = s.replace(/(^|\s)#[^\n]*/g, (m, pre) => pre + ' '.repeat(m.length - pre.length));
  return s;
};

const DEF = {
  js: [
    /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*[<(]/,
    /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s+)?(?:function\b|(?:<[^>]*>)?\([^)]*\)\s*(?::[^=]+)?=>|[A-Za-z_$][\w$]*\s*=>)/,
    /^\s+(?:(?:public|private|protected|static|async|override|readonly|get|set)\s+)*(?!(?:if|for|while|switch|catch|function|return|constructor)\b)([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\((?:[^;()]|\{[^{}]*\}|\([^()]*\))*\)\s*(?::\s*[^{=;]+)?\{\s*$/,
    /^\s+([A-Za-z_$][\w$]*)\s*:\s*(?:async\s+)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/,
    // an interface or abstract method: charge(amount: number): Promise<void>;
    /^\s+(?:abstract\s+)?(?!(?:if|for|while|switch|catch|return|await|new|throw)\b)([A-Za-z_$][\w$]*)\s*\??\s*(?:<[^>]*>)?\([^()]*\)\s*:\s*[^;{=]+;\s*$/,
  ],
  python: [/^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/],
  go: [/^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*[\[(]/],
  rust: [/^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:const\s+)?(?:unsafe\s+)?fn\s+([A-Za-z_]\w*)/],
  kotlin: [/^\s*(?:@\w+(?:\([^)]*\))?\s+)*(?:(?:private|public|internal|protected|override|suspend|inline|open|operator|abstract|final|tailrec)\s+)*fun\s+(?:<[^>]*>\s*)?(?:[\w.]+\.)?([A-Za-z_]\w*)\s*\(/],
  swift: [/^\s*(?:@\w+(?:\([^)]*\))?\s+)*(?:(?:public|private|internal|fileprivate|open|static|class|override|mutating|nonisolated|final|convenience|required)\s+)*func\s+([A-Za-z_]\w*)/],
  java: [/^\s*(?:@\w+(?:\([^)]*\))?\s+)*(?:(?:public|private|protected|static|final|abstract|synchronized|async|override|virtual|internal|sealed)\s+)+[\w<>\[\],.? ]+?\s+([A-Za-z_]\w*)\s*\([^;]*$/],
  dart: [
    // (return types may nest generics: Future<Result<List<Order>>> _load(int id) async {)
    /^\s*(?:static\s+|external\s+|@override\s+)*(?:void|int|double|bool|String|dynamic|num|[A-Z][\w.]*(?:<(?:[^<>]|<(?:[^<>]|<[^<>]*>)*>)*>)?)\??\s+([a-z_]\w*)\s*(?:<[^>]*>)?\s*\([^;]*$/,
    // an abstract method: Future<Result<Booking>> getBooking(int id);
    /^\s+(?:(?:Future|Stream|FutureOr)<(?:[^<>]|<(?:[^<>]|<[^<>]*>)*>)*>|void|int|double|bool|String|[A-Z][\w.]*(?:<(?:[^<>]|<[^<>]*>)*>)?)\??\s+([a-z_]\w*)\s*\([^()]*\)\s*;\s*$/,
  ],
  php: [/\bfunction\s+([A-Za-z_]\w*)\s*\(/],
  ruby: [/^\s*def\s+(?:self\.)?([A-Za-z_]\w*[?!]?)/],
};
const FAMILY = { typescript: 'js', javascript: 'js', vue: 'js', svelte: 'js', astro: 'js', python: 'python', go: 'go', rust: 'rust', kotlin: 'kotlin', swift: 'swift', java: 'java', scala: 'java', csharp: 'java', groovy: 'java', dart: 'dart', php: 'php', ruby: 'ruby' };
export const callableLang = (lang) => !!FAMILY[lang];

/** Functions and methods in a file, each with the lines it covers. */
export function findDefs(src, lang) {
  const fam = FAMILY[lang];
  if (!fam) return [];
  const hash = fam === 'python' || fam === 'ruby';
  const lines = stripComments(src, hash).split('\n').map(stripStrings);
  const defs = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.length > 400) continue;
    for (const re of DEF[fam]) {
      const m = re.exec(l);
      if (!m || KEYWORDS.has(m[1])) continue;
      defs.push({ name: m[1], line: i + 1, end: endOf(lines, i, fam) });
      break;
    }
  }
  return defs.slice(0, 600);
}

/**
 * An endpoint whose handler is written inline (router.get('/x', async (req, res) => { … })) becomes a function of
 * its own, named after the route, so what it calls is followed too. Routes whose handler is a named function
 * (decorators, router.get('/x', listOrders)) keep that function.
 */
export function withRouteBodies(src, lang, routes, defs) {
  const fam = FAMILY[lang];
  if (!fam || !routes?.length) return defs;
  const lines = stripComments(src, fam === 'python' || fam === 'ruby').split('\n').map(stripStrings);
  const out = [...defs];
  for (const r of routes) {
    if (!r.line || r.line < 1 || r.line > lines.length) continue;
    if (defs.some((d) => d.name === r.handler || (d.line >= r.line && d.line - r.line <= 3))) continue;
    out.push({ name: `${r.method} ${r.path}`, line: r.line, end: endOf(lines, r.line - 1, fam), route: true });
  }
  return out.sort((a, b) => a.line - b.line);
}

/** The last line of a definition starting at index i: its indented block (Python), or its matching brace. */
function endOf(lines, i, fam) {
  if (fam === 'python') {
    const ind = /^\s*/.exec(lines[i])[0].length;
    let j = i + 1, last = i;
    // the signature may run over several lines
    while (j < lines.length && !/:\s*(#.*)?$/.test(lines[j - 1]) && j < i + 15) j++;
    for (; j < lines.length; j++) { if (!lines[j].trim()) continue; if (/^\s*/.exec(lines[j])[0].length <= ind) break; last = j; }
    return last + 1;
  }
  if (fam === 'ruby') {
    const ind = /^\s*/.exec(lines[i])[0].length;
    for (let j = i + 1; j < lines.length; j++) if (/^\s*end\b/.test(lines[j]) && /^\s*/.exec(lines[j])[0].length === ind) return j + 1;
    return Math.min(lines.length, i + 40);
  }
  // brace languages: from the first { on or after the line to its match; an expression body (=>) ends at the statement
  // (braces inside the parameter list before the body opens, Dart's {String? notes} or TS's ({ a, b }), don't count)
  let depth = 0, opened = false, parens = 0;
  for (let j = i; j < lines.length && j < i + 2000; j++) {
    const l = lines[j];
    for (let k = 0; k < l.length; k++) {
      if (!opened && l[k] === '(') parens++;
      else if (!opened && l[k] === ')') parens = Math.max(0, parens - 1);
      else if (!opened && parens > 0) continue;
      else if (l[k] === '{') { depth++; opened = true; } else if (l[k] === '}') { depth--; if (opened && depth <= 0) return j + 1; }
    }
    if (!opened && j > i && (/;\s*$/.test(lines[j]) || (j - i > 6))) return j + 1;
    if (!opened && /=>\s*[^{\s]/.test(l) && /[;,)]\s*$/.test(l)) return j + 1;
  }
  return Math.min(lines.length, i + 1);
}

/** Names called inside a body: free calls `load(…)` and member calls `api.load(…)`. */
function callsIn(text) {
  const out = [];
  for (const m of text.matchAll(/(?:(?<obj>[A-Za-z_$][\w$]*)\s*\??\.\s*)?(?<![\w$])(?<name>[A-Za-z_$][\w$]*)\s*(?:<[^<>()\n]*>)?\s*\(/g)) {
    const { obj, name } = m.groups;
    if (KEYWORDS.has(name) || name.length < 2) continue;
    out.push({ obj: obj || null, name, at: m.index, ...(NOISE.has(name) ? { noise: true } : {}) });
  }
  return out;
}

/**
 * Calls between functions. Resolution, most certain first:
 *  1. a function of the same file (free call, this./self. call);
 *  2. an imported name (JS locals, Python from-imports and module aliases, Dart `show`), in the file it comes from;
 *  3. a member call on an imported module or object (api.getOrders(), orders_service.place());
 *  4. otherwise a function with that name in exactly one file this file is linked to (Swift, Kotlin and Dart see their
 *     module's types without importing them; also calls on an instance of an imported class). Marked loose.
 */
/** Types a file declares and the types they extend or implement: [[name, [supertypes]]]. */
export function findTypes(src, lang) {
  const fam = FAMILY[lang];
  if (!fam) return [];
  const out = [];
  const re = fam === 'kotlin' || fam === 'swift'
    ? /\b(?:class|struct|object|actor|enum)\s+([A-Z]\w*)(?:<[^>]*>)?\s*(?:\([^)]*\))?\s*:\s*([^{\n]+)/g
    : /\bclass\s+([A-Z]\w*)(?:<[^>]*>)?\s+((?:extends|implements|with)[^{\n]+)/g;
  for (const m of src.matchAll(re)) {
    const sup = m[2].replace(/\b(extends|implements|with|where)\b/g, ',').replace(/<[^>]*>|\([^)]*\)/g, '').split(',').map((s) => s.trim().split(/\s+/)[0]).filter((s) => /^[A-Z]\w*$/.test(s));
    if (sup.length) out.push([m[1], sup]);
  }
  return out.slice(0, 50);
}

/**
 * Variables and fields whose type is written down: name -> Type. Covers the common shapes in every typed language:
 *   Dart/Java/C#  final OrderRepository _orders;  OrderRepository orders,
 *   TS/Kotlin/Swift/Python/Rust  orders: OrderRepository   private readonly orders: OrderService
 *   PHP  private OrderService $orders   Go  orders *OrderRepository
 *   any  orders = OrderRepository(…) / new OrderRepository(…)
 */
const NOT_TYPE = /^(String|Int|Integer|Long|Double|Float|Bool|Boolean|Object|Map|List|Set|Array|Future|Promise|Stream|Optional|Void|Any|Self|This|Type|Some|Never|Record|Partial|Readonly|Widget|BuildContext|Key|Request|Response|Number|Date|DateTime|Duration)$/;
export function varTypes(src, lang) {
  const fam = FAMILY[lang];
  const out = new Map();
  const put = (name, type) => { if (name && type && !NOT_TYPE.test(type) && !out.has(name)) out.set(name, type); };
  const code = src.replace(/\/\/[^\n]*|#[^\n{[]*$/gm, '');
  if (fam === 'php') for (const m of code.matchAll(/\b\??\\?(?:[\w\\]*\\)?([A-Z]\w*)\s+(?:&\s*)?\$(\w+)/g)) put(m[2], m[1]);
  if (fam === 'go') for (const m of code.matchAll(/\b([a-z_]\w*)\s+\*?(?:\w+\.)?([A-Z]\w*)\b/g)) put(m[1], m[2]);
  if (['js', 'kotlin', 'swift', 'python', 'rust'].includes(fam)) for (const m of code.matchAll(/\b(_?[A-Za-z]\w*)\s*\??\s*:\s*(?:[\w.]*\.)?([A-Z]\w*)/g)) put(m[1], m[2]);
  if (['dart', 'java'].includes(fam)) for (const m of code.matchAll(/\b([A-Z]\w*)(?:<[^<>;(){}]*>)?\??\s+(_?[a-z]\w*)\s*[;=,)]/g)) put(m[2], m[1]);
  for (const m of code.matchAll(/\b(?:this\.|self\.|\$this->|\$)?(_?[a-z]\w*)\s*=\s*(?:new\s+|await\s+)?(?:[\w.]*\.)?([A-Z]\w*)\s*(?:<[^<>]*>)?\s*\(/g)) put(m[1], m[2]);
  return out;
}

export function linkCalls({ files, edges, read }) {
  // interface -> implementations: a call that lands on an abstract method also reaches the same method in every
  // class that extends or implements the type that file declares (marked loose, up to four)
  const implsOf = new Map();
  for (const f of files) for (const [name, sups] of f.types || []) for (const s of sups) { if (!implsOf.has(s)) implsOf.set(s, new Set()); implsOf.get(s).add(f.path); }
  const declares = new Map();
  for (const f of files) for (const [name] of f.types || []) declares.set(name, f.path);
  const typesIn = new Map();
  for (const f of files) for (const s of f.symbols || []) if (/^(class|interface|protocol|abstract|struct|object)$/.test(s.kind) || implsOf.has(s.name)) { if (!typesIn.has(f.path)) typesIn.set(f.path, []); typesIn.get(f.path).push(s.name); }
  const byPath = new Map(files.map((f) => [f.path, f]));
  const fnIndex = (f, name) => (f?.fns || []).findIndex((d) => d.name === name);
  const linked = new Map();
  for (const e of edges) { if (!linked.has(e.from)) linked.set(e.from, new Set()); linked.get(e.from).add(e.to); }
  // functions by name per repo, for calls on injected objects (this._orderRepository.load() -> order_repository*.dart)
  const byName = new Map();
  for (const f of files) (f.fns || []).forEach((d, i) => { const k = `${f.repo ?? ''}|${d.name}`; if (!byName.has(k)) byName.set(k, []); byName.get(k).push([f.path, i]); });
  // (test doubles are never where production calls land)
  const TESTY = /(^|\/)(tests?|testing|__tests__|spec|fakes?|mocks?|stubs?|fixtures?)\/|(_test|\.test|\.spec|Tests?)\.\w+$/i;
  const norm = (s) => String(s).replace(/^_+|^m(?=[A-Z])/, '').replace(/[^A-Za-z0-9]/g, '').toLowerCase();
  // classes by name, for calls on typed fields and variables (orders.place() where `orders: OrderService`)
  const classIn = new Map();
  for (const f of files) for (const s of f.symbols || []) if (/^(class|interface|protocol|abstract|struct|object|enum|trait|mixin|record|type)$/.test(s.kind) && /^[A-Z]/.test(s.name)) { if (!classIn.has(s.name)) classIn.set(s.name, []); classIn.get(s.name).push(f.path); }
  /** The method `name` on class `T`, from this file's point of view: the file it imports, else one in its repo. Also
   * every implementation when T is an interface or abstract class with the method only declared. */
  const onType = (f, T, name) => {
    const all = (classIn.get(T) || []).filter((p) => TESTY.test(f.path) || !TESTY.test(p));
    const lk = linked.get(f.path) || new Set();
    const ordered = [...all.filter((p) => lk.has(p)), ...all.filter((p) => !lk.has(p) && byPath.get(p)?.repo === f.repo), ...all.filter((p) => !lk.has(p) && byPath.get(p)?.repo !== f.repo)];
    for (const p of ordered) { const i = fnIndex(byPath.get(p), name); if (i >= 0) return [[p, i]]; }
    const impls = [...(implsOf.get(T) || [])].filter((p) => !TESTY.test(p)).map((p) => [p, fnIndex(byPath.get(p), name)]).filter(([, i]) => i >= 0);
    return impls.slice(0, 4);
  };
  const calls = [];
  for (const f of files) {
    if (!f.fns?.length) continue;
    const src = read(f.path);
    if (!src) continue;
    const fam = FAMILY[f.lang];
    const types = varTypes(src, f.lang);
    let lines = stripComments(src, fam === 'python' || fam === 'ruby').split('\n').map(stripStrings);
    // PHP: $this->repo->save() and Cache::get() read like this.repo.save() and Cache.get()
    if (fam === 'php') lines = lines.map((l) => l.replace(/\??->|::/g, '.').replace(/\$(?=[A-Za-z_])/g, ''));
    // imported bindings: local name -> { file, orig }
    const binds = new Map();
    for (const imp of f.imports || []) {
      if (!imp.files?.length) continue;
      for (const [local, orig] of Object.entries(imp.locals || {})) binds.set(local, { file: imp.files[0], orig });
      (imp.names || []).forEach((n, i) => { if (!binds.has(n)) binds.set(n, { file: imp.files[i] || imp.files[0], orig: n }); });
      for (const [alias, orig] of Object.entries(imp.aliases || {})) { const i = (imp.names || []).indexOf(orig); binds.set(alias, { file: imp.files[i] || imp.files[0], orig }); }
      // python `import pkg.mod as m` / `from pkg import mod`: the module itself
      const modName = imp.alias || (imp.spec || '').split(/[./]/).pop();
      if (modName && !binds.has(modName) && imp.files.length === 1) binds.set(modName, { file: imp.files[0], orig: '*' });
    }
    const near = [...(linked.get(f.path) || [])].map((p) => byPath.get(p)).filter((x) => x?.fns?.length);
    const seen = new Set();
    f.fns.forEach((d, di) => {
      // the body only: nested definitions inside it count as their own
      // (lines of functions nested inside it are blanked: their calls are theirs, not this function's)
      const nested = f.fns.filter((x) => x !== d && x.line > d.line && (x.end || x.line) <= d.end);
      const text = lines.slice(d.line - 1, d.end).map((l, k) => (nested.some((x) => d.line + k >= x.line && d.line + k <= (x.end || x.line)) ? '' : l)).join('\n');
      let n = 0;
      // (first, so the name-only guess below doesn't claim these calls) a class looked up by type, then called: context.read<CheckoutCubit>().placeOrder(), getIt<Api>().load(),
      // Provider.of<Cart>(context).add(), get<Repo>().save(), app(OrderService::class)->place()
      for (const m of text.matchAll(/<\s*([A-Z]\w*)\s*(?:<[^<>]*>)?\s*>\s*\(\s*[^()]*\)\s*\.\s*([a-z_]\w*)\s*\(|\b(?:app|resolve|inject|get|make)\(\s*([A-Z]\w*)(?:\.class|::class|\.self)?\s*\)\s*\.\s*([a-z_]\w*)\s*\(/g)) {
        const hits = onType(f, m[1] || m[3], m[2] || m[4]);
        const line = d.line + text.slice(0, m.index).split('\n').length - 1;
        for (const h of hits) { const k = `${di}|${h[0]}|${h[1]}`; if (seen.has(k)) continue; seen.add(k); calls.push([f.path, di, h[0], h[1], line, ...(hits.length > 1 ? [1] : [])]); }
      }
      for (const c of callsIn(text)) {
        if (n >= 60) break;
        // common names (create, send, get…) count only on an object we know: an import or a typed field
        if (c.noise && !(c.obj && (binds.has(c.obj) || types.has(c.obj)))) continue;
        // the function's own name in its signature is not a call
        if (!c.obj && c.name === d.name && !text.slice(0, c.at).includes('\n')) continue;
        const line = d.line + text.slice(0, c.at).split('\n').length - 1;
        let to = null, loose = false;
        const self = !c.obj || c.obj === 'this' || c.obj === 'self';
        if (self) { const i = fnIndex(f, c.name); if (i >= 0 && i !== di) to = [f.path, i]; }
        if (!to && !c.obj && binds.has(c.name)) {
          const b = binds.get(c.name);
          const t = byPath.get(b.file);
          const name = b.orig === 'default' ? (t?.symbols || []).find((s) => s.default)?.name || c.name : b.orig === '*' ? null : b.orig;
          const i = name ? fnIndex(t, name) : -1;
          if (i >= 0) to = [b.file, i];
        }
        if (!to && c.obj && binds.has(c.obj)) { const b = binds.get(c.obj); const i = fnIndex(byPath.get(b.file), c.name); if (i >= 0) to = [b.file, i]; }
        // a call on a field or variable whose type is written down: the method on that class (or its implementations)
        if (!to && c.obj && !self && types.has(c.obj)) {
          const hits = onType(f, types.get(c.obj), c.name);
          if (hits.length === 1) to = hits[0];
          else if (hits.length) { for (const h of hits) { const k = `${di}|${h[0]}|${h[1]}`; if (!seen.has(k)) { seen.add(k); n++; calls.push([f.path, di, h[0], h[1], line, 1]); } } continue; }
        }
        if (!to && c.name.length >= 3) {
          const hits = near.filter((t) => TESTY.test(f.path) || !TESTY.test(t.path)).map((t) => [t.path, fnIndex(t, c.name)]).filter(([, i]) => i >= 0);
          if (hits.length === 1) { to = hits[0]; loose = true; }
        }
        // a call on an object named after a class kept elsewhere in the repo (dependency injection): every file named
        // like it that defines the method, up to three (an interface and its implementations)
        if (!to && c.obj && !self && c.name.length >= 3 && norm(c.obj).length >= 5) {
          const o = norm(c.obj);
          const hits = (byName.get(`${f.repo ?? ''}|${c.name}`) || []).filter(([p]) => p !== f.path && (TESTY.test(f.path) || !TESTY.test(p)) && norm(p.split('/').pop().replace(/\.\w+$/, '')).includes(o)).slice(0, 3);
          for (const h of hits) {
            const k = `${di}|${h[0]}|${h[1]}`;
            if (seen.has(k)) continue;
            seen.add(k); n++;
            calls.push([f.path, di, h[0], h[1], line, 1]);
          }
          continue;
        }
        if (!to) continue;
        const k = `${di}|${to[0]}|${to[1]}`;
        if (seen.has(k)) continue;
        seen.add(k); n++;
        calls.push([f.path, di, to[0], to[1], line, ...(loose ? [1] : [])]);
        const tf = byPath.get(to[0]);
        const mName = tf?.fns?.[to[1]]?.name;
        for (const t of typesIn.get(to[0]) || []) for (const impl of [...(implsOf.get(t) || [])].filter((p) => p !== to[0] && !TESTY.test(p)).slice(0, 4)) {
          const ii = fnIndex(byPath.get(impl), mName);
          const kk = `${di}|${impl}|${ii}`;
          if (ii < 0 || seen.has(kk)) continue;
          seen.add(kk);
          calls.push([f.path, di, impl, ii, line, 1]);
        }
      }
      // a function of this file handed over as a callback (Command1(_load), onPressed: _submit, .map(toRow))
      for (const m of text.matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)(?=\s*[,)\]}])/g)) {
        const i = fnIndex(f, m[1]);
        if (i < 0 || i === di || seen.has(`${di}|${f.path}|${i}`)) continue;
        seen.add(`${di}|${f.path}|${i}`);
        calls.push([f.path, di, f.path, i, d.line + text.slice(0, m.index).split('\n').length - 1]);
      }
    });
  }
  return calls;
}
