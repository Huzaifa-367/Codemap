// What happens inside a function, in data terms: the fields a request sends, the fields a handler checks
// (validation), and the fields a response returns. Read from the code with patterns per framework; no tokens.
// Tables read/written and events/jobs/mail come from lib/data.mjs and lib/effects.mjs and are merged in flows.
//
// findFacts(src, lang, fns) -> { fns: [{ fn, sends?, checks?, returns?, checksWith?, returnsWith? }], classes: { Name: { checks?, returns? } } }

const HTTP_SEND = /\.(post|put|patch|delete|get|request|fetch)\s*(?:<[^>]*>)?\s*\(|\bfetch\s*\(|\baxios\s*\(|\bhttp\.(?:post|put|patch)\s*\(|\brequests\.(?:post|put|patch)\s*\(|\bhttpx?\.(?:post|put|patch)\s*\(|\.(?:visit|submit|form)\s*\(/;

/** Keys of the object / map / array literal that starts at `open` ({ or [), one level deep. */
function keysAt(text, open) {
  const close = text[open] === '{' ? '}' : ']';
  let d = 0, j = open;
  for (; j < text.length; j++) { const c = text[j]; if (c === '{' || c === '[' || c === '(') d++; else if (c === '}' || c === ']' || c === ')') { d--; if (d === 0) break; } }
  const body = text.slice(open + 1, j);
  const keys = [];
  let depth = 0, cur = '';
  for (const c of body) { if ('{[('.includes(c)) depth++; if ('}])'.includes(c)) depth--; if (c === ',' && depth === 0) { keys.push(cur); cur = ''; } else cur += c; }
  keys.push(cur);
  return keys.map((k) => k.trim()).filter(Boolean).map((k) => {
    let m;
    if ((m = /^["'`]?([A-Za-z_][\w.-]*)["'`]?\s*(?:=>|:)\s*([\s\S]*)$/.exec(k))) return [m[1], m[2].trim()];
    if ((m = /^\.\.\./.exec(k))) return null;
    if ((m = /^([A-Za-z_]\w*)$/.exec(k))) return [m[1], m[1]]; // shorthand { cartId }
    if (close === ']' && (m = /^["'](\w[\w.-]*)["']$/.exec(k))) return [m[1], '']; // a list of field names
    return null;
  }).filter(Boolean);
}
/** Rule text in plain words: ['required', 'uuid'] / 'required|uuid' / Rule::exists(...) -> "required, uuid" */
const ruleText = (v) => {
  const t = v.trim();
  // an array of rules: split on commas outside quotes and brackets; a 'required|uuid' string: split on |
  const parts = t.startsWith('[') ? (t.slice(1, -1).match(/(["'])(?:\\.|(?!\1).)*\1|[^,\s][^,]*/g) || []) : t.replace(/^['"]|['"]$/g, '').split('|');
  return parts.map((x) => x.trim().replace(/^['"]|['"]$/g, '').replace(/^Rule::(\w+)\((.*)\)$/, '$1:$2').replace(/^new\s+/, '')).filter(Boolean).join(', ');
};

export function findFacts(src, lang, fns = []) {
  const out = { fns: [], classes: {} };
  const lines = src.split('\n');
  const body = (d) => lines.slice(d.line - 1, d.end || d.line).join('\n');
  fns.forEach((d, fn) => {
    const text = body(d);
    const f = { fn };
    // ---- sends: the body of a request made here ----
    if (HTTP_SEND.test(text)) {
      const m = /(?:\b(?:data|body|json|form|params|payload)\s*[:=]\s*(?:JSON\.stringify\(\s*)?|\.(?:post|put|patch)\s*(?:<[^>]*>)?\s*\(\s*[^,()]+(?:\([^()]*\))?\s*,\s*(?:JSON\.stringify\(\s*)?)([{[])/.exec(text);
      if (m) { const k = keysAt(text, m.index + m[0].length - 1).map(([n]) => n); if (k.length) f.sends = k.slice(0, 20); }
    }
    // ---- checks: validation written in the handler ----
    let m;
    if ((m = /(?:->validate|Validator::make\s*\([^,]+,|\$this->validate\s*\([^,]+,)\s*\(?\s*\[/.exec(text))) f.checks = keysAt(text, text.indexOf('[', m.index + m[0].length - 1)).map(([n, v]) => v ? `${n}: ${ruleText(v)}` : n);
    else if ((m = /\b(?:z\.object|Joi\.object|yup\.object|t\.Object|v\.object)\s*\(\s*\{/.exec(text))) f.checks = keysAt(text, m.index + m[0].length - 1).map(([n, v]) => `${n}: ${v.replace(/^(z|Joi|yup|t|v)\./, '').replace(/\(\)/g, '').replace(/\.(\w+)/g, ', $1').slice(0, 80)}`);
    else if ((m = /params\.require\(\s*:(\w+)\s*\)\.permit\(([^)]*)\)/.exec(text))) f.checks = m[2].split(',').map((x) => x.trim().replace(/^:/, '')).filter(Boolean);
    // a typed request / DTO / form parameter whose class holds the rules: store(StoreOrderRequest $request), create(@Body() dto: CreateOrderDto), def create(body: OrderIn)
    const sig = lines.slice(d.line - 1, Math.min(d.end || d.line, d.line + 3)).join(' ');
    const KIND = '(?:Request|Dto|DTO|Input|Form|Payload|Body|Command|Params|In|Create|Update|Schema)';
    const typed = new RegExp(`\\b([A-Z]\\w*${KIND})\\s+\\$?\\w+`).exec(sig) || new RegExp(`\\b\\w+\\s*\\??:\\s*([A-Z]\\w*${KIND})\\b`).exec(sig);
    if (typed && !f.checks) f.checksWith = typed[1];
    // ---- returns: the response this handler sends back ----
    if ((m = /\breturn\s+(?:new\s+|)([A-Z]\w*(?:Resource|Collection|Response|Dto|DTO|Out|Serializer|View))\s*(?:::make|::collection)?\s*\(/.exec(text))) f.returnsWith = m[1];
    else if ((m = /(?:res\.(?:status\(\d+\)\.)?json|response\(\)->json|Response\.json|NextResponse\.json|jsonify|JsonResponse|c\.JSON\(\s*[\w.]+\s*,|ctx\.body\s*=|return\s+Inertia::render\(\s*['"][^'"]+['"]\s*,|return\s+inertia\(\s*['"][^'"]+['"]\s*,)\s*\(?\s*([{[])/.exec(text))) {
      const k = keysAt(text, m.index + m[0].length - 1).map(([n]) => n);
      if (k.length) f.returns = k.slice(0, 20);
    }
    if (Object.keys(f).length > 1) out.fns.push(f);
  });
  // ---- classes that hold checks or responses (form requests, DTOs, schemas, resources, serializers) ----
  for (const c of src.matchAll(/\bclass\s+([A-Z]\w*)\b([^{:;]*)[{:]/g)) {
    const name = c[1], head = c[2];
    const rest = src.slice(c.index, c.index + 6000);
    let m;
    if ((m = /function\s+rules\s*\([^)]*\)[^{]*\{[\s\S]*?return\s*\[/.exec(rest))) out.classes[name] = { checks: keysAt(rest, rest.indexOf('[', m.index + m[0].length - 1)).map(([n, v]) => v ? `${n}: ${ruleText(v)}` : n) };
    else if ((m = /function\s+toArray\s*\([^)]*\)[^{]*\{[\s\S]*?return\s*\[/.exec(rest))) out.classes[name] = { returns: keysAt(rest, rest.indexOf('[', m.index + m[0].length - 1)).map(([n]) => n) };
    else if (/\b(BaseModel|Schema|Serializer|ModelSerializer)\b/.test(head) || /@(IsString|IsInt|IsNotEmpty|IsEmail|IsOptional|IsUUID|Length|Min|Max)\b/.test(rest.split(/\n\}/)[0])) {
      // pydantic / DRF / marshmallow fields, class-validator DTOs: `name: str`, `email = serializers.EmailField()`, `@IsEmail() email: string`
      const block = rest.split(/\n(?:\}|\S)/)[0];
      const fields = [...block.matchAll(/^\s*(?:@\w+\([^)]*\)\s*)*(?:readonly\s+|public\s+)?([a-z_]\w*)\s*[?!]?\s*(?::\s*([\w[\]|. ]+?)(?:\s*=.*)?|=\s*(?:serializers|fields|ma\.fields)\.(\w+)\([^)]*\))\s*;?\s*$/gm)].map((x) => `${x[1]}: ${(x[2] || x[3] || '').trim()}`);
      const decos = [...block.matchAll(/((?:@\w+\([^)]*\)\s*)+)(?:readonly\s+)?([a-z_]\w*)[?!]?\s*:/g)].map((x) => `${x[2]}: ${[...x[1].matchAll(/@(\w+)/g)].map((y) => y[1].replace(/^Is/, '').toLowerCase()).join(', ')}`);
      const list = decos.length ? decos : fields;
      if (list.length) out.classes[name] = { checks: list.slice(0, 30) };
    }
  }
  return out;
}
