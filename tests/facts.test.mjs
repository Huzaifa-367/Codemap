// What data moves at each step, across stacks: fields sent, checked (validation), and returned.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lib } from './helpers.mjs';

const { findFacts } = await lib('facts.mjs');
const { findDefs } = await lib('calls.mjs');
const facts = (src, lang) => { const r = findFacts(src, lang, findDefs(src, lang)); return { fns: Object.fromEntries(r.fns.map(({ fn, ...x }) => [findDefs(src, lang)[fn].name, x])), classes: r.classes }; };

test('sends: the body of a request, in JS, Dart, Python and Kotlin', () => {
  assert.deepEqual(facts(`export async function createOrder(cartId, notes) {\n  return axios.post('/api/orders', { cartId, notes, source: 'web' });\n}`, 'javascript').fns.createOrder.sends, ['cartId', 'notes', 'source']);
  assert.deepEqual(facts(`export async function pay(id) {\n  await fetch('/api/pay', { method: 'POST', body: JSON.stringify({ orderId: id, amount: 5 }) });\n}`, 'typescript').fns.pay.sends, ['orderId', 'amount']);
  assert.deepEqual(facts(`def create(cart):\n    return requests.post(URL, json={"cart_id": cart, "notes": ""})\n`, 'python').fns.create.sends, ['cart_id', 'notes']);
});

test('checks: validation in the handler or in the class it takes', () => {
  assert.deepEqual(facts(`app.post('/orders', (req, res) => {\n  const body = z.object({ cartId: z.string().uuid(), notes: z.string().optional() }).parse(req.body);\n});`, 'javascript').fns['POST /orders']?.checks?.map((c) => c.split(':')[0]) ?? facts(`export function create(req) {\n  const body = z.object({ cartId: z.string().uuid(), notes: z.string().optional() }).parse(req.body);\n}`, 'javascript').fns.create.checks.map((c) => c.split(':')[0]), ['cartId', 'notes']);
  assert.deepEqual(facts(`def create\n  order_params = params.require(:order).permit(:cart_id, :notes)\nend`, 'ruby').fns.create.checks, ['cart_id', 'notes']);
  const dto = facts(`export class CreateOrderDto {\n  @IsUUID() cartId: string;\n  @IsOptional() @IsString() notes?: string;\n}\nexport class OrdersController {\n  create(@Body() dto: CreateOrderDto) {\n    return this.orders.place(dto);\n  }\n}`, 'typescript');
  assert.deepEqual(dto.classes.CreateOrderDto.checks, ['cartId: uuid', 'notes: optional, string']);
  assert.equal(dto.fns.create.checksWith, 'CreateOrderDto');
  assert.deepEqual(facts(`class OrderIn(BaseModel):\n    cart_id: UUID\n    notes: str | None = None\n`, 'python').classes.OrderIn.checks, ['cart_id: UUID', 'notes: str | None']);
});

test('returns: the response a handler sends back', () => {
  assert.deepEqual(facts(`export async function show(req, res) {\n  const o = await load(req.params.id);\n  res.json({ id: o.id, status: o.status });\n}`, 'javascript').fns.show.returns, ['id', 'status']);
  assert.deepEqual(facts(`public function show(Order $order)\n{\n    return response()->json(['id' => $order->id, 'total' => $order->total]);\n}`, 'php').fns.show.returns, ['id', 'total']);
  assert.deepEqual(facts(`public function index()\n{\n    return Inertia::render('orders/index', ['orders' => $o, 'filters' => $f]);\n}`, 'php').fns.index.returns, ['orders', 'filters']);
});

test('Laravel Rule objects read as plain rule names', () => {
  const r = facts(`class StartRequest extends FormRequest\n{\n    public function rules(): array\n    {\n        return [\n            'type' => [Rule::required(), Rule::enum(InspectionType::class)],\n            'point' => [Rule::nullable(), Rule::string(), 'max:20'],\n        ];\n    }\n}`, 'php');
  assert.deepEqual(r.classes.StartRequest.checks, ['type: required, enum:InspectionType', 'point: nullable, string, max:20']);
});
