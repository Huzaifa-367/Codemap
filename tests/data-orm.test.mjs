// Tables from migrations and model classes, and reads/writes through models, across frameworks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lib } from './helpers.mjs';

const { findTables, findTableUses, tableOf } = await lib('data.mjs');
const code = (path, lang) => ({ path, lang, category: 'code' });
const models = (src, path, lang) => findTables(src, code(path, lang)).filter((t) => t.model).map((t) => `${t.model}=${t.name}`);
const uses = (src, path, lang) => findTableUses(src, code(path, lang)).map((u) => `${u.model || u.table}:${u.how}`);

test('model names become table names the way each framework does it', () => {
  assert.equal(tableOf('OrderItem'), 'order_items');
  assert.equal(tableOf('Category'), 'categories');
  assert.equal(tableOf('Address'), 'addresses');
});

test('tables from migrations and schema builders', () => {
  const lv = findTables(`Schema::create('orders', function (Blueprint $table) {\n  $table->id();\n  $table->foreignId('user_id')->constrained();\n  $table->string('status');\n  $table->timestamps();\n});`, code('database/migrations/x.php', 'php'))[0];
  assert.equal(lv.name, 'orders');
  assert.deepEqual(lv.columns.map((c) => c[0]), ['id', 'user_id', 'status', 'created_at', 'updated_at']);
  assert.deepEqual(lv.refs, [['user_id', 'users']]);
  const rb = findTables(`create_table :orders do |t|\n  t.string :status\n  t.references :user\nend`, code('db/migrate/1_orders.rb', 'ruby'))[0];
  assert.deepEqual([rb.name, rb.refs], ['orders', [['user_id', 'users']]]);
  assert.equal(findTables(`await knex.schema.createTable('orders', (t) => { t.string('status') })`, code('migrations/1.js', 'javascript'))[0].name, 'orders');
  assert.equal(findTables(`export const orders = pgTable('orders', { id: serial('id') })`, code('db/schema.ts', 'typescript'))[0].name, 'orders');
  assert.equal(findTables(`db.execute('CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY)');`, code('lib/db.dart', 'dart'))[0].name, 'orders');
});

test('model classes in each framework name their table', () => {
  assert.deepEqual(models(`class OrderItem extends Model\n{\n}`, 'app/Models/OrderItem.php', 'php'), ['OrderItem=order_items']);
  assert.deepEqual(models(`class Order extends Model\n{\n    protected $table = 'shop_orders';\n}`, 'app/Models/Order.php', 'php'), ['Order=shop_orders']);
  assert.deepEqual(models(`class Order < ApplicationRecord\nend`, 'app/models/order.rb', 'ruby'), ['Order=orders']);
  assert.deepEqual(models(`class Order(models.Model):\n    status = models.CharField()\n`, 'shop/models.py', 'python'), ['Order=order']);
  assert.deepEqual(models(`class Order(Base):\n    __tablename__ = "orders"\n`, 'app/models.py', 'python'), ['Order=orders']);
  assert.deepEqual(models(`@Entity()\nexport class Order {\n  @PrimaryGeneratedColumn() id: number;\n}`, 'src/order.entity.ts', 'typescript'), ['Order=order']);
  assert.deepEqual(models(`@Entity\n@Table(name = "orders")\npublic class Order {\n}`, 'src/main/java/Order.java', 'java'), ['Order=orders']);
  assert.deepEqual(models(`const Order = mongoose.model('Order', orderSchema);`, 'models/order.js', 'javascript'), ['Order=orders']);
  assert.deepEqual(models(`public DbSet<Order> Orders { get; set; }`, 'Data/ShopContext.cs', 'csharp'), ['Order=orders']);
});

test('reads and writes through models, typed variables and repositories', () => {
  assert.deepEqual(uses(`$cart = Cart::findOrFail($id);\nOrder::create([...]);`, 'app/S.php', 'php'), ['Cart:read', 'Order:write']);
  assert.deepEqual(uses(`public function handle(Order $order) { $order->update(['status' => 'paid']); }`, 'app/J.php', 'php'), ['Order:write']);
  assert.deepEqual(uses(`orders = Order.objects.filter(user=u)\nOrder.objects.create(user=u)`, 'shop/views.py', 'python'), ['Order:read', 'Order:write']);
  assert.deepEqual(uses(`order = Order.create!(params)\nOrder.where(user: u)`, 'app/x.rb', 'ruby'), ['Order:write', 'Order:read']);
  assert.deepEqual(uses(`class S { constructor(private orders: OrderRepository) {}\n  place(o) { return this.orders.save(o); } }`, 'src/s.ts', 'typescript'), ['Order:write']);
  assert.deepEqual(uses(`class S { constructor(@InjectRepository(Order) private repo: Repository<Order>) {}\n  list() { return this.repo.find(); } }`, 'src/s.ts', 'typescript'), ['Order:read']);
  assert.deepEqual(uses(`DB::table('orders')->insert(['a' => 1]);`, 'app/x.php', 'php'), ['orders:write']);
  assert.deepEqual(uses(`db.Create(&Order{Status: "new"})`, 'internal/orders.go', 'go'), ['Order:write']);
});
