// Calls through typed fields and variables, in every typed language: the field's type names the class whose method runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lib } from './helpers.mjs';

const { varTypes } = await lib('calls.mjs');
const t = (src, lang) => Object.fromEntries(varTypes(src, lang));

test('typed fields and variables, language by language', () => {
  assert.equal(t(`class A { final OrderRepository _orders; }`, 'dart')._orders, 'OrderRepository');
  assert.equal(t(`class A { constructor(private readonly orders: OrderService) {} }`, 'typescript').orders, 'OrderService');
  assert.equal(t(`class A(private val orders: OrderRepository) {}`, 'kotlin').orders, 'OrderRepository');
  assert.equal(t(`final class A { let orders: OrderRepository }`, 'swift').orders, 'OrderRepository');
  assert.equal(t(`class A { private final OrderRepository orders; }`, 'java').orders, 'OrderRepository');
  assert.equal(t(`public function __construct(private OrderService $orders) {}`, 'php').orders, 'OrderService');
  assert.equal(t(`type Handler struct { orders *OrderStore }`, 'go').orders, 'OrderStore');
  assert.equal(t(`class A:\n    def __init__(self, orders: OrderRepo):\n        self.orders = orders`, 'python').orders, 'OrderRepo');
  assert.equal(t(`const orders = new OrderService(db);`, 'javascript').orders, 'OrderService');
  assert.equal(t(`$orders = new OrderService();`, 'php').orders, 'OrderService');
});

test('plain value types are not classes to follow', () => {
  assert.deepEqual(t(`final String name; int count; List<Order> orders;`, 'dart'), {});
  assert.deepEqual(t(`name: string; when: Date; items: Array<Item>`, 'typescript'), {});
});

test('an abstract method declaration is one line, so it never seems to call the next method', async () => {
  const { findDefs } = await lib('calls.mjs');
  const d = findDefs(`abstract class BookingRepository {\n  Future<Result<Booking>> getBooking(int id);\n  Future<Result<void>> createBooking(Booking booking);\n}\n`, 'dart');
  assert.deepEqual(d.map((x) => [x.name, x.line, x.end]), [['getBooking', 2, 2], ['createBooking', 3, 3]]);
});
