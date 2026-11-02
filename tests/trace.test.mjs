// The function level and traced flows: from a screen, through the functions it calls and the requests they make,
// to the endpoint in another repo, its handler and what that calls, down to the database. No tokens.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { lib, makeProject, run, readGraph, cleanup, REPO as REPO_DIR } from './helpers.mjs';

const { findDefs } = await lib('calls.mjs');

const files = {
  'web/package.json': JSON.stringify({ name: 'web', dependencies: { next: '15' } }),
  'web/app/cart/page.tsx': `import { checkout } from '../../lib/api';\nexport default function CartPage() {\n  const onPay = async () => {\n    await checkout(cartId);\n  };\n  return <button onClick={onPay}>Pay</button>;\n}\n`,
  'web/lib/api.ts': `export async function checkout(cartId: string) {\n  const res = await fetch(\`/api/orders\`, { method: 'POST', body: JSON.stringify({ cartId }) });\n  return res.json();\n}\n`,
  'api/package.json': JSON.stringify({ name: 'api', dependencies: { express: '4', pg: '8' } }),
  'api/server.js': `const express = require('express');\nconst app = express();\napp.use('/api', require('./orders'));\napp.listen(3000);\n`,
  'api/orders.js': [
    `const router = require('express').Router();`,
    `const { placeOrder } = require('./service');`,
    `router.post('/orders', requireAuth, async (req, res) => {`,
    `  const order = await placeOrder(req.user, req.body.cartId);`,
    `  res.json(order);`,
    `});`,
    `module.exports = router;`,
  ].join('\n'),
  'api/service.js': [
    `const db = require('./db');`,
    `async function placeOrder(user, cartId) {`,
    `  const cart = await loadCart(cartId);`,
    `  return db.insertOrder(user.id, cart);`,
    `}`,
    `function loadCart(id) {`,
    `  return db.query('select * from carts where id = $1', [id]);`,
    `}`,
    `module.exports = { placeOrder };`,
  ].join('\n'),
  'api/migrations/001_init.sql': `create table carts (\n  id uuid primary key,\n  user_id uuid not null\n);\ncreate table orders (\n  id uuid primary key,\n  user_id uuid not null,\n  cart_id uuid references carts(id),\n  total numeric(10,2)\n);\n`,
  'api/db.js': `const { Pool } = require('pg');\nconst pool = new Pool();\nfunction query(sql, args) { return pool.query(sql, args); }\nfunction insertOrder(userId, cart) { return query('insert into orders …', [userId]); }\nmodule.exports = { query, insertOrder };\n`,
};
const arch = {
  project: { name: 'shop', summary: 'x' },
  nodes: [
    { id: 'web', label: 'Website', kind: 'ui', summary: 'w', paths: ['web/**'] },
    { id: 'api', label: 'Server', kind: 'service', summary: 's', paths: ['api/**'] },
    { id: 'pg', label: 'Postgres', kind: 'external', summary: 'db', packages: ['pg'] },
  ],
};

let root, graph;
before(() => {
  root = makeProject(files, { repos: ['web', 'api'], arch });
  run('scan.mjs', root);
  run('build.mjs', root, '--no-claude-md');
  graph = readGraph(root);
});
after(() => cleanup(root));

const names = (n, out = []) => { out.push(n.type === 'function' ? n.name : n.type === 'endpoint' ? n.name : n.type === 'outside' ? `[${n.name}]` : `(${n.name})`); n.children.forEach((c) => names(c, out)); return out; };

test('every function, exported or not, with its lines; inline route handlers are functions too', () => {
  const svc = graph.files.find((f) => f.p === 'api/service.js');
  assert.deepEqual(svc.fn.map(([n, a, b]) => `${n} ${a}-${b}`), ['placeOrder 2-5', 'loadCart 6-8']);
  assert.ok(graph.files.find((f) => f.p === 'api/orders.js').fn.some(([n]) => n === 'POST /orders'));
  assert.ok(graph.calls.length >= 4);
});

test('trace from a screen: page → its handler → api client → request → server handler → service → db → Postgres', () => {
  const out = JSON.parse(run('trace.mjs', root, '/cart', '--json'));
  const seq = names(out.flows[0].tree);
  for (const step of ['onPay', 'checkout', 'POST /api/orders', 'POST /orders', 'placeOrder', 'loadCart', 'query', 'insertOrder', '[Postgres]']) assert.ok(seq.includes(step), `${step} in ${seq.join(' > ')}`);
  assert.ok(seq.indexOf('checkout') < seq.indexOf('POST /api/orders') && seq.indexOf('POST /api/orders') < seq.indexOf('placeOrder'));
});

test('trace from an endpoint, as text and as a sequence diagram', () => {
  const text = run('trace.mjs', root, 'POST /api/orders');
  assert.match(text, /FLOW from POST \/api\/orders: \d+ steps across Server/);
  assert.match(text, /placeOrder\(\)\s+api\/service\.js:2/);
  const mer = run('trace.mjs', root, 'POST /api/orders', '--mermaid');
  assert.match(mer, /^sequenceDiagram/);
  assert.match(mer, /->>.*: placeOrder\(\)/);
});

test('a traced flow can be saved to the map\'s Flows, and the build keeps it', () => {
  run('trace.mjs', root, '/cart', '--save', 'Paying for a cart');
  const saved = JSON.parse(fs.readFileSync(path.join(root, 'codemap', 'custom-flows.json'), 'utf8')).flows[0];
  assert.equal(saved.title, 'Paying for a cart');
  assert.ok(saved.steps.some((s) => s.ref === 'route:POST /api/orders'));
  run('build.mjs', root, '--no-claude-md');
  const flow = readGraph(root).flows.find((f) => f.title === 'Paying for a cart');
  assert.ok(flow && flow.steps.length >= 4, JSON.stringify(flow));
});

test('function definitions across languages', () => {
  const n = (src, lang) => findDefs(src, lang).map((d) => d.name);
  assert.deepEqual(n(`class A:\n    def load(self):\n        return 1\n\nasync def main():\n    pass\n`, 'python'), ['load', 'main']);
  assert.deepEqual(n(`func (s *Store) Get(id string) (*Order, error) {\n  return nil, nil\n}\nfunc main() {}\n`, 'go'), ['Get', 'main']);
  assert.deepEqual(n(`class Repo(private val api: Api) {\n  suspend fun order(id: String): Order {\n    return api.order(id)\n  }\n}\n@Composable\nfun OrdersScreen() { }\n`, 'kotlin'), ['order', 'OrdersScreen']);
  assert.deepEqual(n(`final class APIClient {\n  func order(id: String) async throws -> Order {\n    return x\n  }\n  private static func make() {}\n}\n`, 'swift'), ['order', 'make']);
  assert.deepEqual(n(`class Repo {\n  Future<Order> load(String id) async {\n    return x;\n  }\n  void clear() {}\n}\n`, 'dart'), ['load', 'clear']);
  assert.deepEqual(n(`export const total = (items: Item[]) => items.length;\nclass Cart {\n  add(item: Item): void {\n    this.items.push(item);\n  }\n}\n`, 'typescript'), ['total', 'add']);
});

import { execFileSync } from 'node:child_process';
const readJsonFile = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const query = (...a) => execFileSync(process.execPath, [path.join(root, 'codemap', 'query.mjs'), ...a], { encoding: 'utf8' });

test('for agents: context lists the line ranges a task needs, with callers, in far fewer tokens than exploring', () => {
  const c = JSON.parse(query('context', 'place an order from the cart', '--json'));
  const svc = c.read.find((x) => x.file === 'api/service.js');
  assert.ok(svc, JSON.stringify(c.read.map((x) => x.file)));
  assert.ok(svc.ranges.some(([a, b, n]) => `${a}-${b} ${n}` === '2-5 placeOrder'), JSON.stringify(svc.ranges));
  assert.ok(svc.calledBy.some((x) => x.startsWith('api/orders.js#POST')));
  assert.ok(c.endpoints.some((e) => e.startsWith('POST /api/orders')));
  assert.ok(c.readTokens < c.exploreTokens);
  const text = query('context', 'place an order from the cart');
  assert.match(text, /^CONTEXT for "place an order from the cart": read these \d+ ranges/);
  assert.match(text, /api\/service\.js {2}2-5 placeOrder/);
});

test('for agents: fn gives callers and callees; map fits its budget', () => {
  const f = JSON.parse(query('fn', 'placeOrder'));
  assert.equal(f.matches[0].at, 'api/service.js:2-5');
  assert.ok(f.matches[0].calledBy.some((x) => /api\/orders\.js:\d+ POST \/orders/.test(x)));
  assert.ok(f.matches[0].calls.some((x) => /loadCart/.test(x)) && f.matches[0].calls.some((x) => /insertOrder/.test(x)));
  const m = query('map', '--budget', '400');
  assert.match(m, /## Server \[service\]/);
  assert.ok(m.length / 4 < 600, `map ${m.length} chars`);
});

test('for agents: trace and impact also work from the map folder itself, without the skill', () => {
  assert.match(query('trace', 'POST /api/orders'), /FLOW from POST \/api\/orders/);
  const im = JSON.parse(query('impact', '--files', 'api/service.js', '--json'));
  assert.ok(im.affected.some((a) => a.file === 'api/orders.js'));
  assert.ok(im.affected.some((a) => a.file === 'web/lib/api.ts' && a.via === 'http'));
});

test('the map carries the Follow panel and the flow engine; build --json gives a machine-readable receipt', () => {
  const html = fs.readFileSync(path.join(root, 'codemap', 'index.html'), 'utf8');
  assert.match(html, /ui\/45-follow\.js/);
  assert.match(html, /function traceReport\(G, start/);
  const ok = JSON.parse(run('build.mjs', root, '--no-claude-md', '--json'));
  assert.equal(ok.ok, true);
  assert.ok(ok.functions >= 6 && ok.calls >= 4);
  const archFile = path.join(root, 'codemap', 'architecture.json');
  const good = fs.readFileSync(archFile, 'utf8');
  fs.writeFileSync(archFile, good.replace('"kind":"ui"', '"kind":"uii"').replace('"kind": "ui"', '"kind": "uii"'));
  let bad;
  try { run('build.mjs', root, '--no-claude-md', '--json'); } catch (e) { bad = JSON.parse(e.stdout); }
  fs.writeFileSync(archFile, good);
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((e) => e.fix === 'use "ui"'), JSON.stringify(bad.errors));
});

test('for agents: context --brief is a ready subagent brief', () => {
  const b = query('context', 'place an order', '--brief');
  assert.match(b, /^## Task\nplace an order/);
  assert.match(b, /## Read first[^\n]*\n(?:- [^\n]*\n)*- `api\/service\.js` lines 2-5 \(placeOrder\)/);
  assert.match(b, /## How to work/);
});

test('repos kept elsewhere join through a link in the root folder', () => {
  const ws = makeProject({ 'README.md': 'workspace' });
  const elsewhere = makeProject({ 'api/server.js': `const app = require('express')();\napp.get('/ping', (req, res) => res.send('ok'));\n` }, { repos: ['api'] });
  try {
    fs.symlinkSync(path.join(elsewhere, 'api'), path.join(ws, 'api'), process.platform === 'win32' ? 'junction' : 'dir');
    run('scan.mjs', ws);
    const s = JSON.parse(fs.readFileSync(path.join(ws, 'codemap', '.cache', 'scan.json'), 'utf8'));
    assert.deepEqual(s.repos.map((r) => r.path), ['api']);
    assert.deepEqual(s.routes.map((r) => `${r.method} ${r.path}`), ['GET /ping']);
  } finally { cleanup(ws); cleanup(elsewhere); }
});

test('data: tables from migrations, the code that uses them, flows that end at a table, and an ERD', () => {
  const g = readGraph(root);
  const orders = g.tables.find((t) => t.name === 'orders');
  assert.deepEqual(orders.columns.map((c) => c.join(' ')), ['id uuid pk', 'user_id uuid ', 'cart_id uuid fk', 'total numeric(10,2) ']);
  assert.deepEqual(orders.refs, [['cart_id', 'carts']]);
  assert.ok(orders.usedBy.some(([p, how]) => p === 'api/db.js' && how === 'write'));
  const t = query('trace', 'POST /api/orders');
  assert.match(t, /→ writes table orders/);
  assert.match(t, /→ reads table carts/);
  const erd = query('erd', '--mermaid');
  assert.match(erd, /^erDiagram/);
  assert.match(erd, /carts \|\|--o\{ orders : "cart_id"/);
});

test('the map\'s Follow panel works: functions map, trace board and reach, run against the built graph', () => {
  const G = readGraph(root);
  let section, click, modal, board;
  const win = { Codemap: { graph: G, h: (s) => String(s ?? '').replace(/[&<>"]/g, ''), info: () => ({ name: 'x' }), exists: () => true, files: new Map(G.files.map((f) => [f.p, f])),
    addPanelSection: (k, fn) => { section = fn; }, showBoard: (b) => { board = b; }, modal: (a) => { modal = a; return { el: { style: {}, addEventListener() {} }, close() {} }; }, toast() {}, go() {} } };
  const doc = { addEventListener: (e, fn) => { click = fn; } };
  const engine = fs.readFileSync(path.join(REPO_DIR, 'skills/codemap/assets/graph-query.js'), 'utf8') + fs.readFileSync(path.join(REPO_DIR, 'skills/codemap/scripts/lib/flows.mjs'), 'utf8').replace(/^export /gm, '');
  const ui = fs.readFileSync(path.join(REPO_DIR, 'skills/codemap/assets/ui/45-follow.js'), 'utf8');
  new Function('window', 'document', `${engine}\n;var traceReport = traceReport;\n${ui}`)(win, doc);
  assert.match(section('f:api/service.js').html, /Functions map/);
  const ev = (ds) => ({ target: { closest: () => ({ dataset: ds }) }, preventDefault() {} });
  click(ev({ follow: 'fnmap', start: 'api/service.js', title: 't' }));
  assert.match(modal.html, /placeOrder\(\)/);
  assert.match(modal.html, /<path d=/);
  click(ev({ follow: 'trace', start: '/cart', title: 'Paying' }));
  assert.ok(board.steps.length >= 4 && board.steps.some((s) => s.id.startsWith('r:')));
  click(ev({ follow: 'up', start: 'f:api/db.js', title: 'Used by' }));
  assert.ok(board.items.some((x) => x.id === 'f:api/service.js'));
});

test('lenses: layers, a delta against the previous map, and a board saved as a one-page HTML', () => {
  const G = readGraph(root);
  assert.equal(G.files.find((f) => f.p === 'web/app/cart/page.tsx').ly, 'screen');
  assert.equal(G.files.find((f) => f.p === 'api/orders.js').ly, 'api');
  assert.ok(G.nodes.filter((n) => !n.parent).every((n) => n.boundary));
  assert.match(query('layers'), /^screen \(1\): web\/app\/cart\/page\.tsx/m);
  // a new endpoint, then a rebuild: delta names it
  fs.writeFileSync(path.join(root, 'api/refunds.js'), `const router = require('express').Router();\nrouter.post('/refunds', (req, res) => res.json({}));\nmodule.exports = router;\n`);
  run('scan.mjs', root); run('build.mjs', root, '--no-claude-md');
  const d = query('delta');
  assert.match(d, /^DELTA since the map of/);
  assert.match(d, /Endpoints: \+1 −0\n {2}\+ POST \/refunds/);
  // headless: the Save button turns the open board into a page
  const G2 = readGraph(root);
  let saved = null, buttons = [];
  const win = { Codemap: { graph: G2, h: (s) => String(s ?? '').replace(/[&<>"]/g, ''), md: (s) => s, info: (id) => ({ name: id, path: id.startsWith('f:') ? id.slice(2) : '' }), toast() {},
    state: { answer: { title: 'Paying', question: 'q', answer: 'It works like this.', items: [{ id: 'f:api/service.js', note: 'places the order' }], steps: [] } },
    addHeaderButton: (b) => buttons.push(b), modal: () => ({ el: { addEventListener() {} }, close() {} }), showBoard() {}, playFlow() {} } };
  const doc = { createElement: () => ({ click() {}, remove() {} }), body: { appendChild() {} } };
  const URL_ = { createObjectURL: () => 'blob:x', revokeObjectURL() {} };
  class Blob_ { constructor(parts) { saved = parts.join(''); } }
  new Function('window', 'document', 'URL', 'Blob', 'setTimeout', fs.readFileSync(path.join(REPO_DIR, 'skills/codemap/assets/ui/55-lenses.js'), 'utf8'))(win, doc, URL_, Blob_, () => {});
  assert.deepEqual(buttons.map((b) => b.label), ['Layers', 'Domains', 'Save']); // Domains: the traced flows have one
  win.CodemapLenses.savePage();
  assert.match(saved, /<h1>Paying<\/h1>/);
  assert.match(saved, /<code>api\/service\.js<\/code>/);
});

test('a call through an interface reaches every implementation', () => {
  const r = makeProject({
    'pay/gateway.ts': `export interface PaymentGateway {\n  charge(amount: number): Promise<void>;\n}\n`,
    'pay/stripe.ts': `import { PaymentGateway } from './gateway';\nexport class StripeGateway implements PaymentGateway {\n  async charge(amount: number) {\n    await fetch('https://api.stripe.com/v1/charges');\n  }\n}\n`,
    'pay/paypal.ts': `import { PaymentGateway } from './gateway';\nexport class PaypalGateway implements PaymentGateway {\n  async charge(amount: number) {\n    return amount;\n  }\n}\n`,
    'pay/checkout.ts': `import type { PaymentGateway } from './gateway';\nexport async function checkout(gateway: PaymentGateway, total: number) {\n  await gateway.charge(total);\n}\n`,
  }, { repos: ['pay'], arch: { project: { name: 'pay' }, nodes: [{ id: 'pay', label: 'Payments', kind: 'service', summary: 'p', paths: ['pay/**'] }] } });
  try {
    run('scan.mjs', r); run('build.mjs', r, '--no-claude-md');
    const g = readGraph(r);
    const fnOf = (p, i) => g.files.find((f) => f.p === p).fn[i][0];
    const from = g.calls.filter((c) => c[0] === 'pay/checkout.ts').map((c) => `${c[2]}#${fnOf(c[2], c[3])}`).sort();
    assert.deepEqual(from, ['pay/gateway.ts#charge', 'pay/paypal.ts#charge', 'pay/stripe.ts#charge']);
  } finally { cleanup(r); }
});

test('a board saves as a 1200×630 PNG card (drawn on a canvas, checked with a stand-in)', () => {
  const ops = [];
  const ctx = new Proxy({}, { get: (t, k) => (k === 'measureText' ? (s) => ({ width: String(s).length * 9 }) : k in t ? t[k] : (...a) => ops.push(k)), set: (t, k, v) => { t[k] = v; return true; } });
  let blob = null;
  const canvas = { getContext: () => ctx, toBlob: (cb) => { blob = cb; } };
  const doc = { createElement: (t) => (t === 'canvas' ? canvas : { click() {}, remove() {} }), body: { appendChild() {} }, documentElement: {} };
  const win = { Codemap: { graph: { project: { name: 'p' }, flows: [], files: [] }, h: (s) => s, info: (id) => ({ name: id }), toast() {}, addHeaderButton() {}, modal: () => ({ el: { addEventListener() {} }, close() {} }),
    state: { answer: { title: 'Paying', question: 'q', items: [], steps: [1, 2, 3, 4, 5].map((i) => ({ id: 'f:a' + i, note: 'does a thing' })) } } } };
  new Function('window', 'document', 'URL', 'Blob', 'setTimeout', 'getComputedStyle', fs.readFileSync(path.join(REPO_DIR, 'skills/codemap/assets/ui/55-lenses.js'), 'utf8'))(win, doc, { createObjectURL: () => 'x', revokeObjectURL() {} }, class {}, () => {}, () => ({ getPropertyValue: () => '', backgroundColor: '#fff' }));
  win.CodemapLenses.saveCard();
  assert.equal(canvas.width, 2400);
  assert.ok(ops.filter((o) => o === 'fillText').length >= 12);
  assert.equal(typeof blob, 'function');
});

test('the whole board saves as a PNG at full size, whatever the zoom (checked with stand-ins)', () => {
  const el = () => ({ style: {}, classList: { remove() {} }, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, insertBefore() {}, querySelector() { return vpCopy; } });
  const vpCopy = el();
  const copy = el();
  const svg = { cloneNode: () => copy, getBoundingClientRect: () => ({ width: 800, height: 500 }), querySelector: () => ({ getBBox: () => ({ x: -100, y: 20, width: 3000, height: 1200 }) }) };
  const ctx = { scale() {}, drawImage() {} };
  let saved = null;
  const canvas = { getContext: () => ctx, toBlob: (cb) => cb({}) };
  const link = { click() {}, remove() {} };
  const doc = { getElementById: () => svg, querySelectorAll: () => [], createElementNS: el, createElement: (t) => (t === 'canvas' ? canvas : link), body: { appendChild() {} }, documentElement: {} };
  class Image_ { set src(u) { this.u = u; this.onload(); } }
  const win = { Codemap: { graph: { project: { name: 'Shop' }, flows: [], files: [] }, h: (s) => s, toast() {}, addHeaderButton() {}, modal() {} } };
  new Function('window', 'document', 'URL', 'Blob', 'setTimeout', 'getComputedStyle', 'XMLSerializer', 'Image', fs.readFileSync(path.join(REPO_DIR, 'skills/codemap/assets/ui/55-lenses.js'), 'utf8'))(
    win, doc, { createObjectURL: () => (saved = 'blob:x'), revokeObjectURL() {} }, class {}, () => {}, () => ({ backgroundColor: '#fff' }), class { serializeToString() { return '<svg/>'; } }, Image_);
  win.CodemapLenses.savePng();
  assert.deepEqual([copy.attrs.width, copy.attrs.height], [3080, 1280]); // the board plus a margin, not the 800×500 view
  assert.equal(vpCopy.style.transform, 'translate(140px,20px) scale(1)');
  assert.deepEqual([canvas.width, canvas.height], [6160, 2560]);
  assert.equal(link.download, 'shop-board.png');
  assert.equal(saved, 'blob:x');
});

test("the map's own buttons in the map's language: the English list, the translation, and the swap", () => {
  const r = makeProject({ 'app/a.js': `export const a = () => 1;\n` }, { repos: ['app'], arch: { project: { name: 'x' }, language: 'Swahili', nodes: [{ id: 'app', label: 'App', kind: 'service', summary: 's', paths: ['app/**'] }] } });
  try {
    run('scan.mjs', r);
    const first = run('build.mjs', r, '--no-claude-md');
    assert.match(first, /UI STRINGS {2}the map's buttons are still in English/);
    const en = JSON.parse(fs.readFileSync(path.join(r, 'codemap', '.cache', 'ui-strings.en.json'), 'utf8'));
    for (const k of ['Follow it', 'Layers', 'Save']) assert.ok(en.includes(k), k);
    fs.writeFileSync(path.join(r, 'codemap', 'ui-strings.json'), JSON.stringify({ 'Follow it': 'Síguelo', Layers: 'Capas', 'not a ui string': 'x' }));
    assert.match(run('build.mjs', r, '--no-claude-md'), /UI STRINGS {2}2\/\d+ of the map's own words in Swahili/);
    const html = fs.readFileSync(path.join(r, 'codemap', 'index.html'), 'utf8');
    assert.match(html, /"uiStrings":\{"Follow it":"Síguelo","Layers":"Capas"\}/);
    assert.match(html, /ui\/02-i18n\.js/);
  } finally { cleanup(r); }
  // the swap itself, on a tiny stand-in DOM
  const text = { nodeType: 3, nodeValue: ' Layers ', parentElement: { closest: () => null } };
  const btn = { getAttribute: (a) => (a === 'title' ? 'Follow it' : null), setAttribute(a, v) { this[a] = v; } };
  const body = { querySelectorAll: () => [btn], getAttribute: () => null };
  const doc = { readyState: 'complete', body, documentElement: {}, createTreeWalker: () => { let done = false; return { nextNode: () => (done ? null : ((done = true), text)) }; } };
  new Function('window', 'document', 'NodeFilter', 'MutationObserver', fs.readFileSync(path.join(REPO_DIR, 'skills/codemap/assets/ui/02-i18n.js'), 'utf8'))({ Codemap: { graph: { uiStrings: { Layers: 'Capas', 'Follow it': 'Síguelo' }, meta: {} } } }, doc, { SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2 }, class { observe() {} });
  assert.equal(text.nodeValue, ' Capas ');
  assert.equal(btn.title, 'Síguelo');
});

test('bench-agent: runs each question without and with the map (plumbing checked with a stand-in CLI)', () => {
  const log = path.join(root, 'fake.log');
  const fake = path.join(REPO_DIR, 'tests', 'fixtures', 'fake-cli', 'fake-claude.mjs');
  const out = execFileSync(process.execPath, [path.join(REPO_DIR, 'tools', 'bench-agent.mjs'), root, '--tasks', '2', '--claude', fake, '--json'], { encoding: 'utf8', env: { ...process.env, FAKE_LOG: log } });
  const r = JSON.parse(out);
  assert.equal(r.summary.tasks, 2);
  const runs = fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(runs.length, 4);
  assert.ok(runs[0].args.includes('Read(codemap/**)') && !runs[0].args.includes('--append-system-prompt'));
  assert.ok(!runs[1].args.includes('--append-system-prompt') && runs[1].args.includes('Bash(node codemap/query.mjs:*)'));
  assert.match(runs[1].input, /codemap\/query\.mjs context[\s\S]*Which file/); // the hint travels with the question, so both runs share the cached system prompt
});

test('every function is a card in technical detail, and the build marks the ones that are not exported', () => {
  const g = readGraph(root);
  const svc = g.files.find((f) => f.p === 'api/service.js');
  const names = svc.s.map((s) => `${s[0]}${s[5] ? ' (internal)' : ''}`);
  assert.ok(names.includes('loadCart (internal)'), names.join(', '));
  const html = fs.readFileSync(path.join(root, 'codemap', 'index.html'), 'utf8');
  assert.match(html, /inside a file: calls between its functions/);
});

test('a trace from a busy file starts at the functions that reach out of it, and names the rest', () => {
  const n = 9;
  const util = Array.from({ length: n }, (_, i) => `export function u${i}() { return ${i}; }`).join('\n');
  const busy = [
    `import { ${Array.from({ length: n }, (_, i) => `u${i}`).join(', ')} } from './util';`,
    ...Array.from({ length: n }, (_, i) => `export function step${i}() {\n  return u${i}();\n}`),
    `export function local() {\n  return tidy();\n}`,
    `function tidy() {\n  return 1;\n}`,
  ].join('\n');
  const r = makeProject({ 'package.json': '{"name":"x"}', 'src/util.js': util, 'src/busy.js': busy }, { arch: { project: { name: 'x', summary: 'x' }, nodes: [{ id: 's', label: 'Source', kind: 'service', summary: 's', paths: ['src/**'] }] } });
  try {
    run('scan.mjs', r); run('build.mjs', r, '--no-claude-md');
    const tree = JSON.parse(run('trace.mjs', r, 'src/busy.js', '--json')).flows[0].tree;
    const starts = tree.children.filter((c) => c.type === 'function').map((c) => c.name);
    assert.ok(starts.length <= 6, starts.join(', '));
    assert.ok(!starts.includes('local') && !starts.includes('tidy'), starts.join(', '));
    assert.ok(tree.also.length >= 3, JSON.stringify(tree.also));
    assert.match(run('trace.mjs', r, 'src/busy.js'), /also starts here: .*step\d\(\)/);
  } finally { cleanup(r); }
});

test('function cards are wide enough to read and say which file and line they are in', () => {
  const html = fs.readFileSync(path.join(root, 'codemap', 'index.html'), 'utf8');
  const w = +/symbol: \[(\d+), \d+\]/.exec(html)?.[1];
  assert.ok(w >= 300, `symbol card width ${w}`);
  assert.match(html, /i\.type === 'symbol'\) size = `\$\{h\(i\.f\.p\.split\('\/'\)\.pop\(\)\)\} · L\$\{i\.s\[2\]\}`/);
});

test('two services with the same endpoint keep their own descriptions (keys gain "@ file" only when shared)', () => {
  const r = makeProject({
    'billing/server.js': `const app = require('express')();\napp.get('/health', (req, res) => res.send('ok'));\napp.get('/invoices', (req, res) => res.json([]));\n`,
    'search/server.js': `const app = require('express')();\napp.get('/health', (req, res) => res.send('ok'));\n`,
  }, { repos: ['billing', 'search'], arch: { project: { name: 'x' }, nodes: [{ id: 'b', label: 'Billing', kind: 'service', summary: 'b', paths: ['billing/**'] }, { id: 's', label: 'Search', kind: 'service', summary: 's', paths: ['search/**'] }] } });
  try {
    run('scan.mjs', r); run('build.mjs', r, '--no-claude-md'); run('describe.mjs', r);
    const ws = fs.readdirSync(path.join(r, 'codemap', '.cache', 'worksheets')).map((n) => fs.readFileSync(path.join(r, 'codemap', '.cache', 'worksheets', n), 'utf8')).join('\n');
    assert.match(ws, /GET \/health @ billing\/server\.js/);
    assert.match(ws, /GET \/health @ search\/server\.js/);
    assert.match(ws, /route: GET \/invoices /);
    fs.writeFileSync(path.join(r, 'codemap', 'descriptions', 'all.json'), JSON.stringify({ files: {}, routes: {
      'GET /health @ billing/server.js': { name: 'Billing is up', description: 'Says billing is running.' },
      'GET /health @ search/server.js': { name: 'Search is up', description: 'Says search is running.' },
    } }));
    run('build.mjs', r, '--no-claude-md');
    const names = readGraph(r).routes.map((x) => `${x.f} ${x.name}`).sort();
    assert.deepEqual(names.filter((n) => /is up/.test(n)), ['billing/server.js Billing is up', 'search/server.js Search is up']);
    run('refresh.mjs', r);
    const kept = JSON.parse(fs.readFileSync(path.join(r, 'codemap', 'descriptions', 'all.json'), 'utf8')).routes;
    assert.ok(kept['GET /health @ billing/server.js'] && kept['GET /health @ search/server.js']);
  } finally { cleanup(r); }
});

test('imports through aliases: vite, the @/ convention, tsconfig extends lists, package #imports and exports maps', () => {
  const r = makeProject({
    'web/package.json': JSON.stringify({ name: 'web', imports: { '#lib/*': './src/lib/*.ts' } }),
    'web/vite.config.ts': `import { fileURLToPath, URL } from 'node:url';\nexport default defineConfig({ resolve: { alias: { '@app': fileURLToPath(new URL('./src/app', import.meta.url)), '~': '/src' } } });\n`,
    'web/src/app/cart.ts': `export const cart = 1;\n`,
    'web/src/lib/money.ts': `export const money = 1;\n`,
    'web/src/ui/Button.ts': `export const Button = 1;\n`,
    'web/src/main.ts': `import { cart } from '@app/cart';\nimport { money } from '#lib/money';\nimport { Button } from '~/ui/Button';\nimport { api } from '@shop/api/client';\nimport { x } from '@/util/x';\n`,
    'web/src/util/x.ts': `export const x = 1;\n`,
    'packages/api/package.json': JSON.stringify({ name: '@shop/api', exports: { './client': { types: './dist/client.d.ts', import: './dist/client.js' } } }),
    'packages/api/src/client.ts': `export const api = 1;\n`,
    'packages/tsconfig/base.json': JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@core/*': ['../core/src/*'] } } }),
    'packages/core/src/price.ts': `export const price = 1;\n`,
    'packages/app2/tsconfig.json': JSON.stringify({ extends: ['../tsconfig/base.json'] }),
    'packages/app2/index.ts': `import { price } from '@core/price';\n`,
  }, { repos: ['.'] });
  try {
    run('scan.mjs', r);
    const s = readJsonFile(path.join(r, 'codemap', '.cache', 'scan.json'));
    const to = (from) => s.edges.filter((e) => e.from === from).map((e) => e.to).sort();
    assert.deepEqual(to('web/src/main.ts'), ['packages/api/src/client.ts', 'web/src/app/cart.ts', 'web/src/lib/money.ts', 'web/src/ui/Button.ts', 'web/src/util/x.ts']);
    assert.deepEqual(to('packages/app2/index.ts'), ['packages/core/src/price.ts']);
  } finally { cleanup(r); }
});

test('the most visible buttons come translated for common languages, with no agent run', () => {
  const r = makeProject({ 'app/a.js': `export const a = () => 1;\n` }, { repos: ['app'], arch: { project: { name: 'x' }, language: 'Japanese', nodes: [{ id: 'app', label: 'App', kind: 'service', summary: 's', paths: ['app/**'] }] } });
  try {
    run('scan.mjs', r);
    assert.match(run('build.mjs', r, '--no-claude-md'), /UI STRINGS {2}\d+\/\d+ of the map's own words built in for Japanese/);
    const g = JSON.parse(/window\.CODEMAP = (\{[\s\S]*?\});<\/script>/.exec(fs.readFileSync(path.join(r, 'codemap', 'index.html'), 'utf8'))?.[1] || '{}');
    assert.equal(g.uiStrings?.Layers, 'レイヤー');
    assert.equal(g.meta.languageCode, 'ja');
  } finally { cleanup(r); }
  for (const code of ['ar', 'de', 'es', 'fr', 'hi', 'ja', 'pt', 'ur', 'zh']) {
    const t = JSON.parse(fs.readFileSync(path.join(REPO_DIR, 'skills/codemap/assets/i18n', code + '.json'), 'utf8'));
    assert.ok(Object.keys(t).length >= 100 && Object.values(t).every((v) => typeof v === 'string' && v.trim()), code);
  }
});

test('Arabic and Urdu maps read right to left, while code, paths and the map itself stay left to right', () => {
  const r = makeProject({ 'app/a.js': `export const a = () => 1;\n` }, { repos: ['app'], arch: { project: { name: 'x' }, language: 'Urdu', nodes: [{ id: 'app', label: 'App', kind: 'service', summary: 's', paths: ['app/**'] }] } });
  try {
    run('scan.mjs', r); run('build.mjs', r, '--no-claude-md');
    const g = JSON.parse(/window\.CODEMAP = (\{[\s\S]*?\});<\/script>/.exec(fs.readFileSync(path.join(r, 'codemap', 'index.html'), 'utf8'))?.[1] || '{}');
    assert.equal(g.meta.rtl, true);
    assert.equal(g.uiStrings?.Layers, 'پرتیں');
  } finally { cleanup(r); }
  const html = { dir: '' }, head = { kids: [], appendChild(x) { this.kids.push(x); } };
  new Function('window', 'document', fs.readFileSync(path.join(REPO_DIR, 'skills/codemap/assets/ui/02-i18n.js'), 'utf8'))({ Codemap: { graph: { meta: { rtl: true } } } }, { documentElement: html, head, createElement: () => ({}) });
  assert.equal(html.dir, 'rtl');
  assert.match(head.kids[0].textContent, /direction:ltr/);
});

test('a map made before the rename (floorplan/) moves to codemap/, and its old CLAUDE.local.md note is replaced', () => {
  const r = makeProject({ 'app/a.js': `export const a = () => 1;\n` }, { repos: ['app'] });
  try {
    fs.mkdirSync(path.join(r, 'floorplan'), { recursive: true });
    fs.writeFileSync(path.join(r, 'floorplan', 'architecture.json'), JSON.stringify({ project: { name: 'x' }, nodes: [{ id: 'app', label: 'App', kind: 'service', summary: 's', paths: ['app/**'] }] }));
    fs.writeFileSync(path.join(r, 'CLAUDE.local.md'), '# mine\n\n<!-- floorplan:start -->\nold note\n<!-- floorplan:end -->\n');
    run('scan.mjs', r);
    assert.ok(fs.existsSync(path.join(r, 'codemap', 'architecture.json')) && !fs.existsSync(path.join(r, 'floorplan')));
    run('build.mjs', r, '--claude-md');
    const md = fs.readFileSync(path.join(r, 'CLAUDE.local.md'), 'utf8');
    assert.match(md, /<!-- codemap:start -->/);
    assert.doesNotMatch(md, /floorplan:start|old note/);
    assert.match(md, /^# mine/);
  } finally { cleanup(r); }
});

test('flows traced function by function come with every map: function cards, the calls between them, down to the endpoint', () => {
  const g = readGraph(root);
  const t = g.flows.find((f) => f.traced && /Cart page|cart/i.test(f.title));
  assert.ok(t, g.flows.map((f) => f.title).join(', '));
  const refs = t.steps.map((s) => s.ref);
  assert.ok(refs.some((r) => /^s:web\/lib\/api\.ts#/.test(r)), refs.join(' '));
  assert.ok(refs.some((r) => r.startsWith('r:')));
  assert.ok(refs.some((r) => /^s:api\/service\.js#/.test(r)));
  assert.ok(t.edges.some(([a, b, k]) => k === 'http' && b.startsWith('r:')));
  assert.ok(t.edges.every(([a, b]) => refs.includes(a) && refs.includes(b)));
  const html = fs.readFileSync(path.join(root, 'codemap', 'index.html'), 'utf8');
  assert.match(html, /if \(f\.traced\) \{ showBoard\(/);
});
