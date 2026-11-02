// What a function sets off besides calls: events it fires, jobs it queues, mail and notifications it sends, and
// outside services it calls; and which code runs because of them (an event's listeners, a job's handler). Generic
// patterns per framework, regex-based like the rest of the scan.
//
// findEffects(src, lang, fns) -> [{ fn, kind, name, line }]   kind: event | job | mail | notify | outside
// linkEffects(files) -> [[file, fnIndex, kind, name, line, [[handlerFile, handlerFnIndex], …]]]

const IGNORED_HOST = /^(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?$|\.(test|example|invalid|local|localhost|internal)(:\d+)?$|(^|\.)example\.(com|org|net)$|^(www\.)?w3\.org$|schemas?\./;

const PATTERNS = [
  // ---- events ----
  ['event', /\b(?:event|broadcast|Event::dispatch|\$this->dispatcher->dispatch|publishEvent|eventPublisher\.publish|applicationEventPublisher\.publishEvent|publisher\.publishEvent)\s*\(\s*new\s+\\?(?:[\w\\]*\\)?([A-Z]\w*)/g],
  ['event', /\.(?:emit|emitAsync|publish|dispatchEvent)\(\s*['"`]([\w.:\-]+)['"`]/g],
  ['event', /\b([a-z_]\w*_signal|[a-z_]\w*)\.send(?:_robust)?\(\s*sender\s*=/g],
  // ---- jobs / queues / background tasks ----
  ['job', /\b(?:dispatch|dispatch_sync|dispatchSync|Bus::dispatch|Queue::push)\s*\(\s*new\s+\\?(?:[\w\\]*\\)?([A-Z]\w*)/g],
  ['job', /\b([A-Z]\w*)::(?:dispatch|dispatchSync|dispatchIf|dispatchUnless|dispatchAfterResponse|withChain)\s*\(/g],
  ['job', /\b([A-Z]\w*Job)\.(?:perform_later|perform_now|perform_async|perform_in|set\([^)]*\)\.perform_later)\b/g],
  ['job', /\b([a-z_]\w*)\.(?:delay|apply_async|send)\s*\(/g, (n, src) => new RegExp(`@(?:shared_task|app\\.task|celery\\.task|task)\\b[^\\n]*\\n\\s*(?:async\\s+)?def\\s+${n}\\b`).test(src) ? n : null],
  ['job', /\.(?:add|addBulk)\(\s*['"`]([\w.:\-]+)['"`]/g, (n, src) => /\bnew\s+Queue\(|\bQueue\(|bullmq|bull\b/.test(src) ? n : null],
  // ---- mail and notifications ----
  ['mail', /\bMail::(?:to|cc|bcc|send|queue)\b[^;]*?->(?:send|queue|later)\(\s*new\s+\\?(?:[\w\\]*\\)?([A-Z]\w*)/g],
  ['mail', /\b([A-Z]\w*Mailer)\.(?:with\([^)]*\)\.)?(\w+)(?:\([^)]*\))?\.deliver_(?:later|now)\b/g, (n, src, m) => `${n}.${m[2]}`],
  ['mail', /\b(?:send_mail|EmailMessage|mail\.send|transporter\.sendMail|sendgrid\.send|resend\.emails\.send|mailer\.send|sendEmail)\s*\(/g, () => 'email'],
  ['notify', /->notify\(\s*new\s+\\?(?:[\w\\]*\\)?([A-Z]\w*)|Notification::send\([^;]*?new\s+\\?(?:[\w\\]*\\)?([A-Z]\w*)/g],
  ['notify', /\b(?:messaging\(\)\.send|admin\.messaging\(\)\.send|FirebaseMessaging\.instance|sendPushNotification|sendNotification)\s*\(/g, () => 'push notification'],
];

export function findEffects(src, lang, fns = []) {
  if (!fns.length) return [];
  const lines = src.split('\n');
  const startOf = [];
  let off = 0;
  for (const l of lines) { startOf.push(off); off += l.length + 1; }
  const lineAt = (i) => { let lo = 0, hi = startOf.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (startOf[mid] <= i) lo = mid; else hi = mid - 1; } return lo + 1; };
  const fnAt = (line) => { let best = -1; fns.forEach((d, i) => { if (line >= d.line && line <= (d.end || d.line) && (best < 0 || d.line >= fns[best].line)) best = i; }); return best; };
  const out = [], seen = new Set();
  const code = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:"'`\\])\/\/[^\n]*/g, (m, p) => p + ' '.repeat(m.length - p.length));
  for (const [kind, re, pick] of PATTERNS) {
    for (const m of code.matchAll(re)) {
      const raw = m[1] || m[2] || null;
      const name = pick ? pick(raw, code, m) : raw;
      if (!name) continue;
      const line = lineAt(m.index), fn = fnAt(line);
      if (fn < 0) continue;
      const k = `${fn}|${kind}|${name}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ fn, kind, name, line });
    }
  }
  // outside services called from a function: https://api.stripe.com/… (this app's own and local hosts excluded)
  for (const m of code.matchAll(/\bhttps?:\/\/([a-z0-9.-]+\.[a-z]{2,})(?::\d+)?[/'"`\s]/gi)) {
    const host = m[1].toLowerCase();
    if (IGNORED_HOST.test(host)) continue;
    const line = lineAt(m.index), fn = fnAt(line);
    if (fn < 0 || seen.has(`${fn}|outside|${host}`)) continue;
    seen.add(`${fn}|outside|${host}`);
    out.push({ fn, kind: 'outside', name: host, line });
  }
  return out.sort((a, b) => a.line - b.line);
}

/**
 * Who runs because of an effect:
 *  event  a class name -> functions whose parameter is typed with it (Laravel listeners' handle(OrderPlaced $e), Spring
 *         @EventListener methods), or a string name -> @OnEvent('order.created') / .on('order.created', fn) handlers
 *         and Django @receiver(signal) functions
 *  job    a class -> its handle / perform / run / process / __invoke method; a Celery task or queue name -> that function
 *         or the Worker('name', fn) / .process('name', fn) handler
 *  mail / notify  the mail or notification class (no further steps)
 */
export function linkEffects(files, read) {
  const byClass = new Map();
  for (const f of files) for (const s of f.symbols || []) if (/^(class|record|struct)$/.test(s.kind) && /^[A-Z]/.test(s.name)) { if (!byClass.has(s.name)) byClass.set(s.name, []); byClass.get(s.name).push(f.path); }
  const fnsOf = new Map(files.map((f) => [f.path, f.fns || []]));
  const srcOf = new Map();
  const src = (p) => { if (!srcOf.has(p)) srcOf.set(p, read(p) || ''); return srcOf.get(p); };
  // listeners by the event class in their parameters, and handlers by event / queue name
  const byParam = new Map(), byName = new Map();
  for (const f of files) {
    const fns = f.fns || [];
    if (!fns.length || !/(listen|subscriber|handler|observer|event|job|worker|consumer|signal|receiver|task|queue)/i.test(f.path + ' ' + (f.symbols || []).map((s) => s.name).join(' ') + (/@(OnEvent|EventListener|TransactionalEventListener|receiver|Processor|Process)\b|\.on\(\s*['"`]|new Worker\(/.test(src(f.path)) ? ' event' : ''))) continue;
    const lines = src(f.path).split('\n');
    fns.forEach((d, i) => {
      const head = lines.slice(Math.max(0, d.line - 4), d.line + 1).join('\n');
      for (const m of head.matchAll(/\b(?:handle|__invoke|on\w*|handle\w*|process|consume|receive|\w*Listener|\w+)\s*\(\s*(?:final\s+)?\\?(?:[\w\\]*\\)?([A-Z]\w*)\s+\$?\w+/g)) add(byParam, m[1], [f.path, i]);
      for (const m of head.matchAll(/@(?:OnEvent|Process|EventPattern|MessagePattern)\(\s*['"`]([\w.:\-]+)['"`]/g)) add(byName, m[1], [f.path, i]);
      for (const m of head.matchAll(/@receiver\(\s*([\w.]+)/g)) add(byName, m[1].split('.').pop(), [f.path, i]);
    });
    for (const m of src(f.path).matchAll(/\.(?:on|once|subscribe)\(\s*['"`]([\w.:\-]+)['"`]\s*,\s*(?:this\.)?([A-Za-z_]\w*)/g)) { const i = fns.findIndex((d) => d.name === m[2]); if (i >= 0) add(byName, m[1], [f.path, i]); }
    for (const m of src(f.path).matchAll(/new\s+Worker\(\s*['"`]([\w.:\-]+)['"`]\s*,\s*(?:async\s*)?(?:\([^)]*\)|\w+)\s*=>|new\s+Worker\(\s*['"`]([\w.:\-]+)['"`]\s*,\s*([A-Za-z_]\w*)/g)) {
      const name = m[1] || m[2];
      const i = m[3] ? fns.findIndex((d) => d.name === m[3]) : fns.findIndex((d) => d.line >= src(f.path).slice(0, m.index).split('\n').length);
      if (i >= 0) add(byName, name, [f.path, i]);
    }
  }
  const out = [];
  for (const f of files) for (const e of f.effects || []) {
    let to = [];
    if (e.kind === 'event') to = /^[A-Z]/.test(e.name) ? byParam.get(e.name) || [] : byName.get(e.name) || [];
    // X::dispatch() is an event when listeners take X and X has no handler of its own
    let kind = e.kind;
    if (kind === 'job' && /^[A-Z]/.test(e.name) && byParam.has(e.name) && !(byClass.get(e.name) || []).some((p) => (fnsOf.get(p) || []).some((d) => /^(handle|perform|run|process|__invoke|execute)$/.test(d.name)))) kind = 'event';
    if (kind === 'event' && e.kind === 'job') to = byParam.get(e.name) || [];
    if (kind === 'job') {
      if (/^[A-Z]/.test(e.name)) for (const p of byClass.get(e.name) || []) { const i = (fnsOf.get(p) || []).findIndex((d) => /^(handle|perform|run|process|__invoke|execute)$/.test(d.name)); if (i >= 0) to.push([p, i]); }
      else { to = [...(byName.get(e.name) || [])]; for (const g of files) { const i = (g.fns || []).findIndex((d) => d.name === e.name); if (i >= 0 && g.path !== f.path && /@(shared_task|app\.task|task)/.test(src(g.path))) to.push([g.path, i]); } }
    }
    out.push([f.path, e.fn, kind, e.name, e.line, to.filter(([p, i]) => !(p === f.path && i === e.fn)).slice(0, 6)]);
  }
  return out;
}
function add(map, k, v) { if (!map.has(k)) map.set(k, []); if (!map.get(k).some(([p, i]) => p === v[0] && i === v[1])) map.get(k).push(v); }
