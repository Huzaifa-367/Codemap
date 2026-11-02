// Laravel + Inertia: an endpoint leads to its controller method, and Inertia pages are screens, so flows can be traced
// from a page, through its request, into the controller and the service it calls.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { lib, makeProject, run, readGraph, cleanup } from './helpers.mjs';

const { extract } = await lib('extract.mjs');

const files = {
  'composer.json': JSON.stringify({ require: { 'laravel/framework': '^12.0', 'inertiajs/inertia-laravel': '^2.0' }, autoload: { 'psr-4': { 'App\\': 'app/' } } }),
  'package.json': JSON.stringify({ dependencies: { '@inertiajs/react': '^2.0', react: '^19.0' } }),
  'routes/web.php': [
    `<?php`,
    `use App\\Http\\Controllers\\SettingsController;`,
    `use App\\Http\\Controllers\\PingController;`,
    `use Illuminate\\Support\\Facades\\Route;`,
    `Route::middleware('auth')->group(function () {`,
    `    Route::get('settings', [SettingsController::class, 'edit'])->name('settings.edit');`,
    `    Route::put('settings', [SettingsController::class, 'update'])->name('settings.update');`,
    `    Route::post('ping', PingController::class)->name('ping');`,
    `});`,
  ].join('\n'),
  'app/Http/Controllers/SettingsController.php': [
    `<?php`,
    `namespace App\\Http\\Controllers;`,
    `use App\\Services\\SettingsService;`,
    `use Inertia\\Inertia;`,
    `class SettingsController extends Controller`,
    `{`,
    `    public function __construct(private SettingsService $settings) {}`,
    `    public function edit()`,
    `    {`,
    `        return Inertia::render('settings/edit', ['values' => $this->settings->all()]);`,
    `    }`,
    `    public function update(Request $request)`,
    `    {`,
    `        $this->settings->save($request->all());`,
    `        return back();`,
    `    }`,
    `}`,
  ].join('\n'),
  'app/Http/Controllers/PingController.php': `<?php\nnamespace App\\Http\\Controllers;\nclass PingController\n{\n    public function __invoke()\n    {\n        return response()->json(['ok' => true]);\n    }\n}\n`,
  'app/Services/SettingsService.php': [
    `<?php`,
    `namespace App\\Services;`,
    `use Illuminate\\Support\\Facades\\DB;`,
    `class SettingsService`,
    `{`,
    `    public function all() { return DB::table('settings')->get(); }`,
    `    public function save(array $values) { DB::table('settings')->upsert($values, ['key']); }`,
    `}`,
  ].join('\n'),
  'resources/js/pages/settings/edit.tsx': [
    `import { useForm } from '@inertiajs/react';`,
    `export default function EditSettings({ values }) {`,
    `  const form = useForm(values);`,
    `  const submit = () => form.put('/settings');`,
    `  return <form onSubmit={submit}><button>Save</button></form>;`,
    `}`,
  ].join('\n'),
};
const arch = { project: { name: 'yard', summary: 'x' }, nodes: [
  { id: 'web', label: 'App pages', kind: 'ui', summary: 'w', paths: ['resources/js/**'] },
  { id: 'srv', label: 'Server', kind: 'service', summary: 's', paths: ['app/**', 'routes/**'] },
] };

let root;
before(() => { root = makeProject(files, { arch }); run('scan.mjs', root); run('build.mjs', root, '--no-claude-md'); });
after(() => cleanup(root));

test('Laravel routes remember their controller and method (array, invokable)', () => {
  const r = extract(files['routes/web.php'], 'php', 'routes/web.php').routes;
  assert.deepEqual(r.map((x) => `${x.method} ${x.path} ${x.hc}@${x.handler}`), ['GET /settings SettingsController@edit', 'PUT /settings SettingsController@update', 'POST /ping PingController@__invoke']);
});

test('tracing a Laravel endpoint goes into the controller method and on to the service', () => {
  const out = run('trace.mjs', root, 'PUT /settings');
  assert.match(out, /update\(\)\s+app\/Http\/Controllers\/SettingsController\.php:12/);
  assert.match(out, /save\(\)\s+app\/Services\/SettingsService\.php/);
  assert.match(run('trace.mjs', root, 'POST /ping'), /__invoke\(\)\s+app\/Http\/Controllers\/PingController\.php/);
});

test('an Inertia page is a screen at the URL of the route that renders it, and gets a step-by-step flow', () => {
  const g = readGraph(root);
  const s = (g.screens || []).find((x) => x.file === 'resources/js/pages/settings/edit.tsx');
  assert.ok(s, JSON.stringify(g.screens));
  assert.equal(s.url, '/settings');
  const flow = g.flows.find((f) => f.traced && /^Step by step/.test(f.title));
  assert.ok(flow, g.flows.map((f) => f.title).join(', '));
  assert.ok(flow.steps.some((x) => x.ref.startsWith('s:app/Services/SettingsService.php')), JSON.stringify(flow.steps));
});

test('PHP use statements link files through composer autoload (PSR-4), grouped and aliased too', () => {
  const imps = extract(`<?php\nnamespace App\\Http;\nuse App\\Services\\SettingsService;\nuse App\\Models\\{User, Post as Article};\nuse function strlen;\nclass X { use HasFactory; }\n`, 'php', 'app/Http/X.php').imports;
  assert.deepEqual(imps.map((i) => i.spec), ['App\\Services\\SettingsService', 'App\\Models\\User', 'App\\Models\\Post']);
  const g = readGraph(root);
  const imports = g.links.filter((l) => l.k === 'import').map((l) => `${l.a} -> ${l.b}`);
  assert.ok(imports.includes('f:app/Http/Controllers/SettingsController.php -> f:app/Services/SettingsService.php'), imports.join('\n'));
  assert.ok(imports.includes('f:routes/web.php -> f:app/Http/Controllers/SettingsController.php'), imports.join('\n'));
});

test('Laravel Wayfinder: a page calling a generated route helper reaches the endpoint, its controller and the service', () => {
  const wf = {
    ...files,
    'tsconfig.json': JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@/*': ['resources/js/*'] } } }),
    'resources/js/routes/settings/index.ts': [
      `import { queryParams, type RouteDefinition } from './../../wayfinder'`,
      `/**`,
      ` * @see \\App\\Http\\Controllers\\SettingsController::update`,
      ` * @route '/settings'`,
      ` */`,
      `export const update = (options?: RouteQueryOptions): RouteDefinition<'put'> => ({`,
      `    url: update.url(options),`,
      `    method: 'put',`,
      `})`,
      ``,
      `update.definition = {`,
      `    methods: ["put"],`,
      `    url: '/settings',`,
      `} satisfies RouteDefinition<["put"]>`,
      ``,
      `update.url = (options?: RouteQueryOptions) => {`,
      `    return update.definition.url + queryParams(options)`,
      `}`,
      `export default { update }`,
    ].join('\n'),
    'resources/js/pages/settings/edit.tsx': [
      `import { router } from '@inertiajs/react';`,
      `import { update } from '@/routes/settings';`,
      `export default function EditSettings({ values }) {`,
      `  const submit = () => router.visit(update());`,
      `  return <form onSubmit={submit}><button>Save</button></form>;`,
      `}`,
    ].join('\n'),
  };
  const r = makeProject(wf, { arch });
  try {
    run('scan.mjs', r); run('build.mjs', r, '--no-claude-md');
    const g = readGraph(r);
    const http = g.links.filter((l) => l.k === 'http').map((l) => `${l.a} -> ${l.b}`);
    assert.ok(http.includes('f:resources/js/routes/settings/index.ts -> f:routes/web.php'), http.join('\n'));
    const out = run('trace.mjs', r, '/settings');
    assert.match(out, /PUT \/settings/);
    assert.match(out, /save\(\)\s+app\/Services\/SettingsService\.php/);
  } finally { cleanup(r); }
});

test('tracing an Inertia page starts with the route that renders it: controller, then the service that loads its data', () => {
  const tree = JSON.parse(run('trace.mjs', root, '/settings', '--json')).flows[0].tree;
  const first = tree.children[0];
  assert.equal(`${first.type} ${first.name} ${first.via}`, 'endpoint GET /settings gets its data from');
  assert.equal(first.children[0].name, 'edit');
  assert.equal(tree.children.filter((c) => c.type === 'endpoint' && c.name === 'GET /settings').length, 1); // each request once
  assert.ok(first.children[0].children.some((c) => c.name === 'all' && c.file === 'app/Services/SettingsService.php'), JSON.stringify(first.children[0]));
});

test('Wayfinder imports reach routes by name or controller even when the generated files are not in the repo', () => {
  const g = {
    ...files,
    '.gitignore': '/resources/js/routes\n/resources/js/actions\n/resources/js/wayfinder\n',
    'routes/web.php': [
      `<?php`,
      `use App\\Http\\Controllers\\SettingsController;`,
      `use App\\Http\\Controllers\\PingController;`,
      `Route::middleware('auth')->prefix('admin')->name('admin.')->group(function () {`,
      `    Route::get('settings', [SettingsController::class, 'edit'])->name('settings.edit');`,
      `    Route::put('settings', [SettingsController::class, 'update'])->name('settings.update');`,
      `});`,
      `Route::post('ping', PingController::class)->name('ping-now');`,
    ].join('\n'),
    'tsconfig.json': JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@/*': ['resources/js/*'] } } }),
    'resources/js/pages/settings/edit.tsx': [
      `import { router } from '@inertiajs/react';`,
      `import { update } from '@/routes/admin/settings';`,
      `import PingController from '@/actions/App/Http/Controllers/PingController';`,
      `import { pingNow } from '@/routes';`,
      `export default function EditSettings({ values }) {`,
      `  const submit = () => router.visit(update());`,
      `  const ping = () => router.post(PingController.url());`,
      `  const again = () => router.post(pingNow.url());`,
      `  return <form onSubmit={submit}><button onClick={ping}>Save</button></form>;`,
      `}`,
    ].join('\n'),
  };
  const r = makeProject(g, { arch });
  try {
    run('scan.mjs', r); run('build.mjs', r, '--no-claude-md');
    const graph = readGraph(r);
    const reqs = graph.links.filter((l) => l.k === 'http' && l.a === 'f:resources/js/pages/settings/edit.tsx').flatMap((l) => l.labels).sort();
    assert.deepEqual(reqs, ['POST /ping', 'PUT /admin/settings']);
    assert.equal(graph.screens.find((s) => s.file.endsWith('settings/edit.tsx'))?.url, '/admin/settings');
    const out = run('trace.mjs', r, '/admin/settings');
    assert.match(out, /PUT \/admin\/settings/);
    assert.match(out, /save\(\)\s+app\/Services\/SettingsService\.php/);
    assert.match(out, /__invoke\(\)\s+app\/Http\/Controllers\/PingController\.php/);
  } finally { cleanup(r); }
});
