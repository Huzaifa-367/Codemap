// Requests whose path is a constant kept in another file, in several languages, matched to the server's routes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeProject, run, readGraph, cleanup } from './helpers.mjs';

test('path constants in TypeScript objects and Kotlin objects reach the server route', () => {
  const r = makeProject({
    'web/package.json': JSON.stringify({ name: 'web', dependencies: { axios: '1' } }),
    'web/src/api/endpoints.ts': `export const ENDPOINTS = {\n  orders: '/api/orders',\n  order: '/api/orders/:id',\n};\n`,
    'web/src/api/orders.ts': `import axios from 'axios';\nimport { ENDPOINTS } from './endpoints';\nexport function createOrder(body) {\n  return axios.post(ENDPOINTS.orders, body);\n}\n`,
    'android/app/src/main/java/shop/ApiRoutes.kt': `package shop\nobject ApiRoutes {\n    const val ORDERS = "/api/orders"\n}\n`,
    'android/app/src/main/java/shop/OrderApi.kt': `package shop\nclass OrderApi(private val client: HttpClient) {\n    suspend fun create(body: OrderBody) = client.post(ApiRoutes.ORDERS) { setBody(body) }\n}\n`,
    'api/package.json': JSON.stringify({ name: 'api', dependencies: { express: '4' } }),
    'api/server.js': `const app = require('express')();\napp.post('/api/orders', (req, res) => res.json({}));\napp.listen(3000);\n`,
  }, { repos: ['web', 'android', 'api'], arch: { project: { name: 'x', summary: 'x' }, nodes: [
    { id: 'web', label: 'Web', kind: 'ui', summary: 'w', paths: ['web/**'] },
    { id: 'android', label: 'Android', kind: 'ui', summary: 'a', paths: ['android/**'] },
    { id: 'api', label: 'API', kind: 'service', summary: 's', paths: ['api/**'] },
  ] } });
  try {
    run('scan.mjs', r); run('build.mjs', r, '--no-claude-md');
    const http = readGraph(r).links.filter((l) => l.k === 'http').map((l) => `${l.a} -> ${l.b} ${l.labels}`).sort();
    assert.deepEqual(http, ['f:android/app/src/main/java/shop/OrderApi.kt -> f:api/server.js POST /api/orders', 'f:web/src/api/orders.ts -> f:api/server.js POST /api/orders']);
  } finally { cleanup(r); }
});
