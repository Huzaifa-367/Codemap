// End-to-end flows across repos: from a mobile screen, through its state holder and repository, the request to the
// other repo's API, the route, controller, validation, service, database, event listener, queued job and mail, with
// what happens at each step. Same expectations for every stack in e2e-fixtures.mjs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeProject, run, readGraph, cleanup } from './helpers.mjs';
import { flutterLaravel } from './e2e-fixtures.mjs';

let root, g;
before(() => {
  root = makeProject(flutterLaravel.files, { repos: flutterLaravel.repos, arch: flutterLaravel.arch });
  run('scan.mjs', root); run('build.mjs', root, '--no-claude-md');
  g = readGraph(root);
});
after(() => cleanup(root));

const names = (n, out = []) => { out.push(n.type === 'function' ? n.name : n.type === 'endpoint' ? n.name : `[${n.type}:${n.name}]`); (n.children || []).forEach((c) => names(c, out)); return out; };
const findStep = (n, pred) => { if (pred(n)) return n; for (const c of n.children || []) { const x = findStep(c, pred); if (x) return x; } return null; };

test('Flutter + Laravel: a call through a typed field reaches the class it names', () => {
  const calls = g.calls.map(([fp, fi, tp, ti]) => `${g.files.find((f) => f.p === fp).fn[fi][0]} -> ${g.files.find((f) => f.p === tp).fn[ti][0]}`);
  assert.ok(calls.includes('placeOrder -> createOrder'), calls.join('\n'));
  assert.ok(calls.includes('store -> place'), calls.join('\n'));
  assert.ok(calls.includes('handle -> charge'), calls.join('\n'));
});

test('Flutter + Laravel: the app\'s request is matched to the API route in the other repo', () => {
  const http = g.links.filter((l) => l.k === 'http').map((l) => `${l.a} -> ${l.b} ${l.labels}`);
  assert.ok(http.includes('f:mobile/lib/data/order_repository.dart -> f:server/routes/api.php POST /api/orders'), http.join('\n'));
});

test('Flutter + Laravel: tables come from Laravel migrations, and the code that reads and writes them is known', () => {
  const t = Object.fromEntries((g.tables || []).map((x) => [x.name, x]));
  assert.ok(t.orders && t.carts, JSON.stringify(Object.keys(t)));
  const uses = (name) => (t[name].usedBy || []).map(([p, how]) => `${p} ${how}`);
  assert.ok(uses('orders').includes('server/app/Services/OrderService.php write'), uses('orders').join('\n'));
  assert.ok(uses('orders').includes('server/app/Jobs/ChargePayment.php write'), uses('orders').join('\n'));
  assert.ok(uses('carts').includes('server/app/Services/OrderService.php read'), uses('carts').join('\n'));
});

test('Flutter + Laravel: from the checkout screen to the end, in order, across both repos', () => {
  const tree = JSON.parse(run('trace.mjs', root, '/checkout', '--json')).flows[0].tree;
  const seq = names(tree);
  const want = ['placeOrder', 'createOrder', 'POST /api/orders', 'store', 'place', '[table:carts]', '[table:orders]', '[event:OrderPlaced]', 'handle', '[mail:OrderConfirmed]', '[job:ChargePayment]', 'charge', '[outside:api.stripe.com]'];
  let at = -1;
  for (const w of want) { const i = seq.indexOf(w, at + 1); assert.ok(i > at, `${w} after position ${at} in:\n${seq.join(' > ')}`); at = i; }
});

test('Flutter + Laravel: each step says what happens there', () => {
  const tree = JSON.parse(run('trace.mjs', root, '/checkout', '--json')).flows[0].tree;
  const step = (name) => findStep(tree, (n) => n.name === name && n.type === 'function');
  assert.deepEqual(step('createOrder').facts?.sends, ['cart_id', 'notes']);
  assert.deepEqual(step('store').facts?.checks, ['cart_id: required, uuid, exists:carts,id', 'notes: nullable, string, max:500']);
  assert.deepEqual(step('store').facts?.returns, ['id', 'status', 'total']);
  const place = step('place').facts;
  assert.deepEqual(place?.reads, ['carts']);
  assert.deepEqual(place?.writes, ['orders']);
  assert.deepEqual(place?.fires, ['OrderPlaced']);
  assert.deepEqual(place?.queues, ['ChargePayment']);
  assert.match(run('trace.mjs', root, '/checkout'), /sends cart_id, notes/);
});

test('Flutter + Laravel: from a function in the middle, up to the screen that starts it and down to the end', () => {
  const out = run('trace.mjs', root, 'server/app/Services/OrderService.php#place');
  assert.match(out, /STARTED FROM[\s\S]*Checkout screen[\s\S]*POST \/api\/orders/);
  assert.match(out, /writes table orders/);
});

// ---------- React website + Django REST API ----------
import { reactDjango } from './e2e-fixtures.mjs';

test('React + Django: from the checkout page to the end, with what happens at each step', () => {
  const r = makeProject(reactDjango.files, { repos: reactDjango.repos, arch: reactDjango.arch });
  try {
    run('scan.mjs', r); run('build.mjs', r, '--no-claude-md');
    const tree = JSON.parse(run('trace.mjs', r, '/checkout', '--json')).flows[0].tree;
    const seq = names(tree);
    const want = ['placeOrder', 'create', 'ANY /api/orders', 'post', 'place_order', '[table:cart]', '[table:order]', '[event:order_placed]', 'send_confirmation', '[mail:an email]', '[job:charge_payment]', 'charge_payment', '[outside:api.stripe.com]'];
    let at = -1;
    for (const w of want) { const i = seq.indexOf(w, at + 1); assert.ok(i > at, `${w} after position ${at} in:\n${seq.join(' > ')}`); at = i; }
    const step = (name) => findStep(tree, (n) => n.name === name && n.type === 'function');
    assert.deepEqual(step('create').facts?.sends, ['cart_id', 'notes']);
    assert.deepEqual(step('post').facts?.checks, ['cart_id: UUIDField', 'notes: CharField']);
    assert.deepEqual(step('post').facts?.returns, ['id', 'status']);
    assert.deepEqual(step('charge_payment').facts?.writes, ['order']);
    assert.match(run('trace.mjs', r, 'api/shop/services.py#place_order'), /STARTED FROM[\s\S]*Checkout[\s\S]*ANY \/api\/orders/);
  } finally { cleanup(r); }
});

// ---------- Android (Kotlin, Compose) + NestJS ----------
import { androidNest } from './e2e-fixtures.mjs';

test('Android + NestJS: from the Compose screen to the end, with what happens at each step', () => {
  const r = makeProject(androidNest.files, { repos: androidNest.repos, arch: androidNest.arch });
  try {
    run('scan.mjs', r); run('build.mjs', r, '--no-claude-md');
    const tree = JSON.parse(run('trace.mjs', r, '/checkout', '--json')).flows[0].tree;
    const seq = names(tree);
    const want = ['placeOrder', 'createOrder', 'createOrder', 'POST /orders', 'create', 'place', '[table:orders]', '[event:order.placed]', 'handle', 'sendConfirmation', '[mail:an email]', '[job:payments]', 'process', '[outside:api.stripe.com]'];
    let at = -1;
    for (const w of want) { const i = seq.indexOf(w, at + 1); assert.ok(i > at, `${w} after position ${at} in:\n${seq.join(' > ')}`); at = i; }
    assert.deepEqual(findStep(tree, (n) => n.name === 'create' && n.type === 'function').facts?.checks, ['cartId: uuid', 'notes: optional, string']);
    assert.doesNotMatch(run('trace.mjs', r, '/checkout'), /~ createOrder/); // the typed field is followed exactly
  } finally { cleanup(r); }
});

test('each traced flow gets a story: describe writes the worksheet, the build puts the story on the flow and the trace', async () => {
  const fs = (await import('node:fs')).default, path = (await import('node:path')).default;
  const out = run('describe.mjs', root);
  assert.match(out, /traced flow\(s\) to explain/);
  const ws = fs.readFileSync(path.join(root, 'codemap', '.cache', 'worksheets', 'flows.md'), 'utf8');
  assert.match(ws, /POST \/api\/orders[\s\S]*writes table orders/);
  const file = path.join(root, 'codemap', 'descriptions', 'flows.json');
  const d = JSON.parse(fs.readFileSync(file, 'utf8'));
  const id = Object.keys(d.flows).find((k) => /checkout/.test(k));
  d.flows[id].story = 'The customer taps Place order; the app sends the cart to the API, which checks it, saves the order and charges the card in the background.';
  fs.writeFileSync(file, JSON.stringify(d));
  run('build.mjs', root, '--no-claude-md');
  const flow = readGraph(root).flows.find((f) => f.id === id);
  assert.equal(flow.description, d.flows[id].story);
  assert.match(run('trace.mjs', root, '/checkout'), /^IN SHORT: The customer taps Place order/);
});
