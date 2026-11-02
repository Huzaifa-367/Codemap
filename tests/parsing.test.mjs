// What Codemap reads out of source files: imports, endpoints, web requests and doc comments.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lib } from './helpers.mjs';

const { extract, flattenTemplates, cleanDoc } = await lib('extract.mjs');
const routes = (src, lang, file) => extract(src, lang, file).routes.map((r) => `${r.method} ${r.path}`);

test('JavaScript: imports and Express endpoints', () => {
  const r = extract([
    `import express from 'express';`,
    `import { db, cache as c } from './db.js';`,
    `const router = express.Router();`,
    `router.get('/orders', list);`,
    `router.post('/orders/:id/refund', refund);`,
  ].join('\n'), 'javascript', 'api/orders.js');
  assert.deepEqual(r.imports.map((i) => i.spec), ['express', './db.js']);
  assert.deepEqual(r.imports[1].names, ['db', 'cache']);
  assert.deepEqual(r.routes.map((x) => `${x.method} ${x.path}`), ['GET /orders', 'POST /orders/:id/refund']);
  assert.equal(r.routes[0].var, 'router');
});

test('Next.js app router: each exported method is an endpoint at the folder path', () => {
  assert.deepEqual(
    routes(`export async function GET(req) { return Response.json([]) }\nexport async function POST(req) {}\n`, 'typescript', 'web/app/api/orders/route.ts'),
    ['GET /api/orders', 'POST /api/orders'],
  );
});

test('Next.js app router: only a file named route is an endpoint, and re-exported handlers keep their methods', () => {
  const nextAuth = `import NextAuth from "next-auth"\nconst handler = NextAuth(authOptions)\nexport { handler as GET, handler as POST }\n`;
  assert.deepEqual(routes(nextAuth, 'typescript', 'app/api/auth/[...nextauth]/route.ts'), ['GET /api/auth/[...nextauth]', 'POST /api/auth/[...nextauth]']);
  assert.deepEqual(routes(nextAuth, 'typescript', 'app/api/auth/[...nextauth]/_route.ts'), []);
  assert.deepEqual(routes(`export async function GET() {}\n`, 'typescript', 'app/api/myroute.ts'), []);
  assert.deepEqual(routes(`export async function GET() {}\n`, 'typescript', 'app/route.ts'), ['GET /']);
});

test('Flask: blueprint prefix, methods list and handler docstring', () => {
  const r = extract([
    `"""Order endpoints."""`,
    `from flask import Blueprint`,
    `bp = Blueprint('orders', __name__, url_prefix='/api')`,
    ``,
    `@bp.route('/orders', methods=['GET', 'POST'])`,
    `def list_orders():`,
    `    """List them."""`,
    `    return []`,
  ].join('\n'), 'python', 'api/orders.py');
  assert.deepEqual(r.routes.map((x) => `${x.method} ${x.path}`), ['GET /orders', 'POST /orders']);
  assert.equal(r.routes[0].handler, 'list_orders');
  assert.equal(r.routes[0].doc, 'List them.');
  assert.deepEqual(r.routers, { bp: '/api' });
  assert.equal(r.doc, 'Order endpoints.');
});

test('FastAPI: router prefix and path parameters', () => {
  const r = extract([
    `from fastapi import APIRouter`,
    `router = APIRouter(prefix="/items")`,
    `@router.get("/{item_id}")`,
    `async def read_item(item_id: int):`,
    `    return {}`,
  ].join('\n'), 'python', 'api/items.py');
  assert.deepEqual(r.routes.map((x) => `${x.method} ${x.path}`), ['GET /{item_id}']);
  assert.equal(r.routes[0].handler, 'read_item');
  assert.deepEqual(r.routers, { router: '/items' });
});

test('Go: grouped imports and http.HandleFunc endpoints', () => {
  const r = extract(`package main\nimport (\n  "net/http"\n  "example.com/app/store"\n)\nfunc main() { http.HandleFunc("/health", h) }\n`, 'go', 'cmd/main.go');
  assert.deepEqual(r.imports.map((i) => i.spec), ['net/http', 'example.com/app/store']);
  assert.deepEqual(r.routes.map((x) => `${x.method} ${x.path}`), ['ANY /health']);
});

test('web requests: fetch with template strings and axios with a method', () => {
  const r = extract([
    'export const load = (id) => fetch(`/api/orders/${id}`);',
    `export const pay = (id) => axios.post('/api/orders/' + id + '/pay');`,
  ].join('\n'), 'typescript', 'web/src/api.ts');
  const calls = r.calls.map((c) => `${c.method || '*'} ${c.path}`);
  assert.ok(calls.includes('* /api/orders/${x}'), calls.join(', '));
  assert.ok(calls.includes('POST /api/orders/'), calls.join(', '));
});

test('flattenTemplates replaces every ${…} with a placeholder, nested or not', () => {
  assert.equal(flattenTemplates('fetch(`${API}/users/${id}`)'), 'fetch(`${x}/users/${x}`)');
});

test('doc comments: JSDoc is cleaned, license headers are ignored', () => {
  assert.equal(cleanDoc('/**\n * Lists orders.\n * @param x\n */'), 'Lists orders.');
  assert.equal(cleanDoc('# Copyright 2020 Example Corp'), null);
});

test('Express: middleware passed before a require()d router is kept for its routes', async () => {
  const { resolveRoutes } = await lib('routes.mjs');
  const server = { path: 'src/server.js', lang: 'javascript', ...extract(`app.use('/admin', requireAuth, require('./routes/admin'));`, 'javascript', 'src/server.js') };
  const admin = { path: 'src/routes/admin.js', lang: 'javascript', ...extract(`router.post('/users/delete', handler);`, 'javascript', 'src/routes/admin.js') };
  server.imports.forEach((i) => { i.files = [admin.path]; });
  const [r] = resolveRoutes([server, admin]);
  assert.equal(r.path, '/admin/users/delete');
  assert.deepEqual(r.mountMw, ['requireAuth']);
});

test('Go 1.22: method and host in ServeMux patterns', () => {
  assert.deepEqual(routes([
    `mux.HandleFunc("POST /items/{id}", h)`,
    `mux.HandleFunc("GET example.com/health", h)`,
    `mux.HandleFunc("/legacy", h)`,
  ].join('\n'), 'go', 'main.go'), ['POST /items/{id}', 'GET /health', 'ANY /legacy']);
});

test('Express: a router under any name, and module.exports isn\'t taken for its handler', () => {
  const r = extract([`const r = require('express').Router();`, `r.get('/items', (req, res) => res.json([]));`, `module.exports = r;`].join('\n'), 'javascript', 'api/items.js');
  assert.deepEqual(r.routes.map((x) => `${x.method} ${x.path}`), ['GET /items']);
  const v2 = extract(`const api = new Hono();\napi.post('/orders', (c) => c.json({}));\nexport default api;\n`, 'typescript', 'api/orders.ts');
  assert.deepEqual(v2.routes.map((x) => `${x.method} ${x.path}`), ['POST /orders']);
  assert.notEqual(r.routes[0].handler, 'r');
});

test('NestJS controllers, Spring bare and array mappings, Gin route groups', () => {
  assert.deepEqual(routes(`@Controller('cats')\nexport class CatsController {\n  @Get()\n  findAll() {}\n  @Post(':id/adopt')\n  adopt() {}\n}\n@Controller({ path: 'dogs' })\nexport class Dogs {\n  @Delete(':id')\n  remove() {}\n}\n`, 'typescript', 'src/cats.controller.ts'), ['GET /cats', 'POST /cats/:id/adopt', 'DELETE /dogs/:id']);
  assert.deepEqual(routes(`@RestController\n@RequestMapping("/api/foo")\npublic class Foo {\n  @GetMapping\n  public String list() { return ""; }\n  @PostMapping({"/a", "/b"})\n  public String two() { return ""; }\n  @RequestMapping(path = "/c", method = RequestMethod.PUT)\n  public String c() { return ""; }\n}`, 'java', 'Foo.java'), ['GET /api/foo', 'POST /api/foo/a', 'POST /api/foo/b', 'PUT /api/foo/c']);
  assert.deepEqual(routes(`r := gin.Default()\nv1 := r.Group("/api/v1")\nusers := v1.Group("/users")\nusers.GET("/:id", h)\nv1.POST("/orders", h)\nr.GET("/health", h)\n`, 'go', 'main.go'), ['GET /api/v1/users/:id', 'POST /api/v1/orders', 'GET /health']);
});

test('Laravel route files: groups, prefixes, resources and the /api prefix', () => {
  const r = routes(`<?php\nRoute::get('/orders', [OrderController::class, 'index']);\nRoute::prefix('admin')->middleware('auth')->group(function () {\n  Route::post('/users/{id}/ban', [UserController::class, 'ban']);\n});\nRoute::apiResource('photos', PhotoController::class);\n`, 'php', 'routes/api.php');
  assert.deepEqual(r, ['GET /api/orders', 'POST /api/admin/users/{id}/ban', 'GET /api/photos', 'POST /api/photos', 'GET /api/photos/{id}', 'PUT /api/photos/{id}', 'PATCH /api/photos/{id}', 'DELETE /api/photos/{id}']);
});

test('Rails routes.rb: namespaces, nested and limited resources', () => {
  const r = routes(`Rails.application.routes.draw do\n  root "home#index"\n  namespace :api do\n    resources :posts, only: [:index, :show] do\n      resources :comments, only: :create\n    end\n    get "health", to: "status#show"\n  end\nend\n`, 'ruby', 'config/routes.rb');
  assert.deepEqual(r, ['GET /', 'GET /api/posts', 'GET /api/posts/:id', 'POST /api/posts/:post_id/comments', 'GET /api/health']);
});

test('ASP.NET: attribute routing with [controller], and minimal API groups', () => {
  assert.deepEqual(routes(`[ApiController]\n[Route("api/[controller]")]\npublic class OrdersController : ControllerBase {\n  [HttpGet]\n  public IActionResult List() => Ok();\n  [HttpPost("{id}/refund")]\n  public IActionResult Refund(int id) => Ok();\n}\n`, 'csharp', 'Controllers/OrdersController.cs'), ['GET /api/orders', 'POST /api/orders/{id}/refund']);
  assert.deepEqual(routes(`var api = app.MapGroup("/api");\nvar v1 = api.MapGroup("/v1");\nv1.MapGet("/items/{id}", (int id) => id);\napp.MapPost("/login", Login);\n`, 'csharp', 'Program.cs'), ['GET /api/v1/items/{id}', 'POST /login']);
});

test('chi: routes nested in r.Route take its prefix', () => {
  assert.deepEqual(routes(`r := chi.NewRouter()\nr.Route("/users", func(r chi.Router) {\n  r.Get("/", list)\n  r.Route("/{id}", func(r chi.Router) {\n    r.Delete("/", del)\n  })\n})\nr.Get("/health", h)\n`, 'go', 'main.go'), ['GET /users', 'DELETE /users/{id}', 'GET /health']);
});

test('Fastify object routes', () => {
  assert.deepEqual(routes(`const fastify = require('fastify')();\nfastify.route({\n  method: ['GET', 'HEAD'],\n  url: '/orders/:id',\n  handler: async (req) => ({}),\n});\nfastify.route({ method: 'POST', url: '/orders', handler: create });\n`, 'javascript', 'server.js'), ['GET /orders/:id', 'HEAD /orders/:id', 'POST /orders']);
});
