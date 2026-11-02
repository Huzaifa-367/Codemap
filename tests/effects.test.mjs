// Events, jobs, mail and outside services that a function sets off, and the code that runs because of them,
// across frameworks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lib } from './helpers.mjs';

const { findEffects, linkEffects } = await lib('effects.mjs');
const { findDefs } = await lib('calls.mjs');
const { extract } = await lib('extract.mjs');

/** files: { path: [lang, src] } -> linked effects as "fromFn kind name -> handlerFile#handlerFn" */
function run(files) {
  const fs = Object.entries(files).map(([path, [lang, src]]) => { const fns = findDefs(src, lang); return { path, lang, fns, symbols: extract(src, lang, path).symbols, effects: findEffects(src, lang, fns) }; });
  const byPath = new Map(fs.map((f) => [f.path, f]));
  return linkEffects(fs, (p) => files[p][1]).map(([p, fi, kind, name, , to]) => `${byPath.get(p).fns[fi].name} ${kind} ${name}${to.map(([q, j]) => ` -> ${q}#${byPath.get(q).fns[j].name}`).join('')}`);
}

test('NestJS events and BullMQ queues', () => {
  assert.deepEqual(run({
    'src/orders.service.ts': ['typescript', `export class OrdersService {\n  constructor(private events: EventEmitter2, private queue: Queue) {}\n  async place(dto) {\n    this.events.emit('order.created', dto);\n    await this.queue.add('charge', dto);\n  }\n}\nconst q = new Queue('charge');\n`],
    'src/order.listener.ts': ['typescript', `export class OrderListener {\n  @OnEvent('order.created')\n  handleCreated(payload) {\n    return payload;\n  }\n}\n`],
    'src/charge.worker.ts': ['typescript', `export async function charge(job) {\n  await fetch('https://api.stripe.com/v1/charges');\n}\nnew Worker('charge', charge);\n`],
  }), ['place event order.created -> src/order.listener.ts#handleCreated', 'place job charge -> src/charge.worker.ts#charge', 'charge outside api.stripe.com']);
});

test('Spring application events', () => {
  assert.deepEqual(run({
    'src/main/java/shop/OrderService.java': ['java', `public class OrderService {\n  public Order place(Cart c) {\n    publisher.publishEvent(new OrderPlaced(c));\n    return null;\n  }\n}\n`],
    'src/main/java/shop/OrderEvents.java': ['java', `public class OrderEvents {\n  @EventListener\n  public void onPlaced(OrderPlaced event) {\n    log(event);\n  }\n}\n`],
  }), ['place event OrderPlaced -> src/main/java/shop/OrderEvents.java#onPlaced']);
});

test('Rails jobs and mailers, Celery tasks', () => {
  const rails = run({
    'app/services/order_service.rb': ['ruby', `class OrderService\n  def place(order)\n    ChargeJob.perform_later(order.id)\n    OrderMailer.with(order: order).confirmation.deliver_later\n  end\nend\n`],
    'app/jobs/charge_job.rb': ['ruby', `class ChargeJob < ApplicationJob\n  def perform(order_id)\n    Order.find(order_id)\n  end\nend\n`],
  });
  assert.deepEqual(rails, ['place job ChargeJob -> app/jobs/charge_job.rb#perform', 'place mail OrderMailer.confirmation']);
  const celery = run({
    'shop/tasks.py': ['python', `@shared_task\ndef charge(order_id):\n    return order_id\n`],
    'shop/views.py': ['python', `from .tasks import charge\n@shared_task\ndef charge(x):\n    pass\ndef place(request):\n    charge.delay(1)\n`],
  });
  assert.ok(celery.includes('place job charge -> shop/tasks.py#charge'), celery.join('\n'));
});
