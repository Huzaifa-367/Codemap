// Mobile apps beside a backend: a Flutter app, a native Android app and a native iOS app in one folder
// with the server they call. Their imports, requests, screens and Health findings, and the apps the scan names.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { lib, makeProject, run, readJson, readGraph, cleanup } from './helpers.mjs';
import path from 'node:path';

const { extract } = await lib('extract.mjs');
const { findIssues } = await lib('health.mjs');
const { findScreens } = await lib('screens.mjs');

const files = {
  // ---- the server ----
  'api/package.json': JSON.stringify({ name: 'shop-api', dependencies: { express: '4' } }),
  'api/server.js': `const express = require('express');\nconst app = express();\napp.use('/api', require('./routes/orders'));\napp.listen(3000);\n`,
  'api/routes/orders.js': [
    `const router = require('express').Router();`,
    `router.get('/orders', (req, res) => res.json([]));`,
    `router.post('/orders', (req, res) => res.json({}));`,
    `router.get('/orders/:id', (req, res) => res.json({}));`,
    `module.exports = router;`,
  ].join('\n'),

  // ---- a Flutter app (with its Android and iOS shells) ----
  'shop_flutter/pubspec.yaml': `name: shop_app\ndependencies:\n  flutter:\n    sdk: flutter\n  go_router: ^14.0.0\n  dio: ^5.0.0\n`,
  'shop_flutter/lib/main.dart': [
    `import 'package:flutter/material.dart';`,
    `import 'package:go_router/go_router.dart';`,
    `import 'screens/home_screen.dart';`,
    `import 'package:shop_app/screens/order_screen.dart';`,
    `final router = GoRouter(routes: [`,
    `  GoRoute(`,
    `    path: '/',`,
    `    builder: (context, state) => const HomeScreen(),`,
    `    routes: [`,
    `      GoRoute(path: 'orders/:id', pageBuilder: (context, state) => MaterialPage(child: OrderScreen(id: state.pathParameters['id']!))),`,
    `    ],`,
    `  ),`,
    `]);`,
    `void main() => runApp(MaterialApp.router(routerConfig: router));`,
  ].join('\n'),
  'shop_flutter/lib/screens/home_screen.dart': `import 'package:flutter/material.dart';\nclass HomeScreen extends StatelessWidget {\n  const HomeScreen({super.key});\n}\n`,
  'shop_flutter/lib/screens/order_screen.dart': `import 'package:flutter/material.dart';\nimport 'package:shop_app/api/client.dart';\nclass OrderScreen extends StatelessWidget {\n  const OrderScreen({super.key, required this.id});\n  final String id;\n}\n`,
  'shop_flutter/lib/api/client.dart': [
    `import 'package:dio/dio.dart';`,
    `part 'client.g.dart';`,
    `class ShopClient {`,
    `  final _dio = Dio();`,
    `  final baseUrl = const String.fromEnvironment('API');`,
    `  Future<List> orders() async => (await _dio.get('$baseUrl/api/orders')).data;`,
    `  Future<void> order(String id) => _dio.get('$baseUrl/api/orders/$id');`,
    `}`,
  ].join('\n'),
  'shop_flutter/lib/api/client.g.dart': `// GENERATED CODE - DO NOT MODIFY BY HAND\npart of 'client.dart';\n`,
  'shop_flutter/android/app/build.gradle': `apply plugin: 'com.android.application'\n`,
  'shop_flutter/android/app/src/main/AndroidManifest.xml': `<manifest><application android:usesCleartextTraffic="true"><activity android:name=".MainActivity"><meta-data android:name="io.flutter.embedding.android.NormalTheme"/></activity></application></manifest>`,
  'shop_flutter/ios/Runner.xcodeproj/project.pbxproj': `// !$*UTF8*$!\n`,
  'shop_flutter/ios/Runner/Info.plist': `<plist><dict><key>NSAppTransportSecurity</key><dict><key>NSAllowsArbitraryLoads</key><true/></dict></dict></plist>`,

  // ---- a native Android app ----
  'shop_android/app/build.gradle.kts': `plugins { id("com.android.application") }\n`,
  'shop_android/app/src/main/AndroidManifest.xml': [
    `<manifest><application>`,
    `  <activity android:name=".ui.LoginActivity"><intent-filter><action android:name="android.intent.action.MAIN"/><category android:name="android.intent.category.LAUNCHER"/></intent-filter></activity>`,
    `  <activity android:name="com.shop.ui.MainActivity"/>`,
    `</application></manifest>`,
  ].join('\n'),
  'shop_android/app/src/debug/AndroidManifest.xml': `<manifest><application android:usesCleartextTraffic="true"/></manifest>`,
  'shop_android/app/src/main/java/com/shop/ui/LoginActivity.kt': `package com.shop.ui\nclass LoginActivity : ComponentActivity()\n`,
  'shop_android/app/src/main/java/com/shop/ui/MainActivity.kt': [
    `package com.shop.ui`,
    `import androidx.navigation.compose.composable`,
    `class MainActivity : ComponentActivity() {`,
    `  fun content() {`,
    `    NavHost(nav, startDestination = "orders") {`,
    `      composable("orders") { OrdersScreen(repo) }`,
    `      composable("orders/{id}") { entry -> OrderDetailsScreen(entry.arguments?.getString("id")) }`,
    `      composable<Settings> { SettingsScreen() }`,
    `    }`,
    `  }`,
    `}`,
  ].join('\n'),
  'shop_android/app/src/main/java/com/shop/ui/Screens.kt': [
    `package com.shop.ui`,
    `@Composable`,
    `fun OrdersScreen(repo: OrderRepository) { Text("Orders") }`,
    `@Composable`,
    `fun OrderDetailsScreen(id: String?) { Text(id ?: "") }`,
    `@Composable`,
    `fun SettingsScreen() { Text("Settings") }`,
  ].join('\n'),
  'shop_android/app/src/main/java/com/shop/ui/OrderRepository.kt': `package com.shop.ui\nimport com.shop.api.ShopApi\nclass OrderRepository(private val api: ShopApi)\n`,
  'shop_android/app/src/main/java/com/shop/api/ShopApi.kt': [
    `package com.shop.api`,
    `interface ShopApi {`,
    `  @GET("api/orders/{id}")`,
    `  suspend fun order(@Path("id") id: String): Order`,
    `  @POST("api/orders")`,
    `  suspend fun place(@Body o: Order): Order`,
    `}`,
  ].join('\n'),

  // ---- a native iOS app ----
  'shop_ios/Shop.xcodeproj/project.pbxproj': `// !$*UTF8*$!\n`,
  'shop_ios/Shop/ShopApp.swift': `import SwiftUI\n@main\nstruct ShopApp: App {\n  var body: some Scene { WindowGroup { ContentView() } }\n}\n`,
  'shop_ios/Shop/ContentView.swift': `import SwiftUI\nstruct ContentView: View {\n  var body: some View {\n    TabView {\n      OrdersView().tabItem { Label("Orders", systemImage: "list") }\n      ProfileScreen().tabItem { Label("Me", systemImage: "person") }\n    }\n  }\n}\n`,
  'shop_ios/Shop/OrdersView.swift': `import SwiftUI\nstruct OrdersView: View {\n  let client = APIClient()\n  var body: some View {\n    NavigationStack { List(orders) { o in NavigationLink(destination: OrderDetailView(order: o)) { Text(o.name) } } }\n  }\n}\n`,
  'shop_ios/Shop/OrderDetailView.swift': `import SwiftUI\nstruct OrderDetailView: View {\n  let order: Order\n  var body: some View { Text(order.name) }\n}\n`,
  'shop_ios/Shop/ProfileScreen.swift': `import SwiftUI\nstruct ProfileScreen: View {\n  var body: some View { Text("Me") }\n}\n`,
  'shop_ios/Shop/LegacyViewController.swift': `import UIKit\nfinal class LegacyViewController: UIViewController {}\n`,
  'shop_ios/Shop/APIClient.swift': [
    `import Foundation`,
    `final class APIClient {`,
    `  let baseURL = "https://shop.example.com"`,
    `  func order(id: String) async throws -> Order {`,
    `    let url = URL(string: "\\(baseURL)/api/orders/\\(id)")!`,
    `    let (data, _) = try await URLSession.shared.data(from: url)`,
    `    return try JSONDecoder().decode(Order.self, from: data)`,
    `  }`,
    `  func place(_ o: Order) async throws {`,
    `    var request = URLRequest(url: URL(string: "\\(baseURL)/api/orders")!)`,
    `    request.httpMethod = "POST"`,
    `  }`,
    `}`,
    `struct Order: Codable { let name: String }`,
  ].join('\n'),
};

const arch = {
  project: { name: 'shop', summary: 'A shop with a server and three mobile apps.' },
  nodes: [
    { id: 'api', label: 'Server', kind: 'service', summary: 'The server.', paths: ['api/**'] },
    { id: 'flutter', label: 'Flutter app', kind: 'ui', summary: 'The Flutter app.', paths: ['shop_flutter/**'] },
    { id: 'android', label: 'Android app', kind: 'ui', summary: 'The Android app.', paths: ['shop_android/**'] },
    { id: 'ios', label: 'iPhone app', kind: 'ui', summary: 'The iPhone app.', paths: ['shop_ios/**'] },
  ],
};

let root, summary, scan, graph;
before(() => {
  root = makeProject(files, { repos: ['api', 'shop_flutter', 'shop_android', 'shop_ios'], arch });
  summary = run('scan.mjs', root);
  scan = readJson(path.join(root, 'codemap', '.cache', 'scan.json'));
  run('build.mjs', root, '--no-claude-md');
  graph = readGraph(root);
});
after(() => cleanup(root));

const httpFrom = (from) => scan.http.filter((h) => h.from === from).map((h) => `${h.method} ${h.path}`).sort();
const edge = (from, to) => scan.edges.some((e) => e.from === from && e.to === to);

test('the scan names every app: the Flutter app and its native shells, native Android and iOS apps, and the server', () => {
  const apps = scan.apps.map((a) => `${a.platform} ${a.dir}${a.host ? ` <${a.host}>` : ''}`);
  for (const a of ['flutter shop_flutter', 'android shop_android/app', 'ios shop_ios', 'android shop_flutter/android/app <shop_flutter>', 'ios shop_flutter/ios <shop_flutter>', 'server api']) assert.ok(apps.includes(a), `${a} in ${apps.join(', ')}`);
  assert.match(summary, /^APPS \(\d+\)/m);
  assert.match(summary, /Flutter app \(Android \+ iOS\)\s+shop_flutter\//);
});

test("each app's requests reach the server's endpoints, across repos", () => {
  assert.deepEqual(httpFrom('shop_flutter/lib/api/client.dart'), ['GET /api/orders', 'GET /api/orders/:id']);
  assert.deepEqual(httpFrom('shop_android/app/src/main/java/com/shop/api/ShopApi.kt'), ['GET /api/orders/:id', 'POST /api/orders']);
  assert.deepEqual(httpFrom('shop_ios/Shop/APIClient.swift'), ['GET /api/orders/:id', 'POST /api/orders']);
});

test('Dart package: imports resolve, and generated files stay off the map', () => {
  assert.ok(edge('shop_flutter/lib/screens/order_screen.dart', 'shop_flutter/lib/api/client.dart'));
  assert.ok(edge('shop_flutter/lib/main.dart', 'shop_flutter/lib/screens/home_screen.dart'));
  assert.equal(scan.files.find((f) => f.path === 'shop_flutter/lib/api/client.g.dart').category, 'generated');
  assert.ok(scan.externals.some((e) => e.id === 'pub:dio'));
});

test('Swift and Kotlin files are linked by the types they use from their own app or package', () => {
  assert.ok(edge('shop_ios/Shop/OrdersView.swift', 'shop_ios/Shop/OrderDetailView.swift'));
  assert.ok(edge('shop_ios/Shop/OrdersView.swift', 'shop_ios/Shop/APIClient.swift'));
  assert.ok(edge('shop_android/app/src/main/java/com/shop/ui/MainActivity.kt', 'shop_android/app/src/main/java/com/shop/ui/Screens.kt'));
  assert.ok(edge('shop_android/app/src/main/java/com/shop/ui/OrderRepository.kt', 'shop_android/app/src/main/java/com/shop/api/ShopApi.kt'));
});

test('screens: go_router, Compose navigation, Android activities and SwiftUI navigation', () => {
  const s = graph.screens.map((x) => `${x.app} ${x.url} ${x.file.split('/').pop()}`).sort();
  for (const want of [
    'flutter / home_screen.dart', 'flutter /orders/:id order_screen.dart',
    'android / LoginActivity.kt', 'android /orders Screens.kt', 'android /orders/:id Screens.kt', 'android /settings Screens.kt',
    'ios / ContentView.swift', 'ios /orders OrdersView.swift', 'ios /order-detail OrderDetailView.swift', 'ios /profile ProfileScreen.swift', 'ios /legacy LegacyViewController.swift',
  ]) assert.ok(s.includes(want), `${want} in\n${s.join('\n')}`);
  // the Flutter app's one native activity hosts the whole app: it isn't a screen of its own
  assert.ok(!s.some((x) => x.startsWith('flutter') && /MainActivity/.test(x)));
});

test('Health: unencrypted connections in release settings are flagged; debug-only ones are not', () => {
  const issue = graph.health.issues.find((i) => i.id === 'mobile-cleartext');
  assert.ok(issue, 'mobile-cleartext issue');
  assert.match(issue.title, /Android and iOS app allows unencrypted connections/);
  assert.deepEqual(issue.locations.map((l) => l.file).sort(), ['shop_flutter/android/app/src/main/AndroidManifest.xml', 'shop_flutter/ios/Runner/Info.plist']);
});

// ---------- unit checks ----------

test('Dart: retrofit.dart with a relative @RestApi base, Firebase callables, and http with Uri.parse', () => {
  const r = extract([
    `@RestApi(baseUrl: '/v1')`,
    `abstract class Api {`,
    `  @GET('orders/{id}')`,
    `  Future<Order> get(@Path() String id);`,
    `  @DELETE('/carts/{id}')`,
    `  Future<void> clear(@Path() String id);`,
    `}`,
    `Future<void> f() async {`,
    `  await http.post(Uri.parse('$base/checkout'));`,
    `  await FirebaseFunctions.instance.httpsCallable('approveItem').call();`,
    `}`,
  ].join('\n'), 'dart', 'lib/api.dart');
  assert.deepEqual(r.calls.map((c) => `${c.method} ${c.path}`).sort(), ['CALL /approveItem', 'DELETE /carts/{id}', 'GET /v1/orders/{id}', 'POST /checkout']);
});

test('Swift: Alamofire method arguments and interpolated paths', () => {
  const r = extract(`AF.request("\\(base)/carts/\\(cart.id)/items", method: .post)\n`, 'swift', 'App/Cart.swift');
  assert.deepEqual(r.calls.map((c) => `${c.method} ${c.path}`), ['POST /carts/{cart.id}/items']);
});

test('Kotlin: Spring mappings stay endpoints, Retrofit annotations are calls', () => {
  const spring = extract(`@RestController\n@RequestMapping("/api")\nclass C {\n  @GetMapping("/orders")\n  fun list() = listOf<String>()\n}`, 'kotlin', 'srv/C.kt');
  assert.deepEqual(spring.routes.map((x) => `${x.method} ${x.path}`), ['GET /api/orders']);
  assert.equal(spring.calls.length, 0);
});

test('Health: mobile settings in debug folders or debug plists are left alone, and a debuggable release manifest is flagged', () => {
  const find = (p, src) => findIssues(src, { path: p, category: 'config', lang: 'xml' }).map((x) => x.k);
  assert.deepEqual(find('app/src/debug/AndroidManifest.xml', '<application android:usesCleartextTraffic="true"/>'), []);
  assert.deepEqual(find('ios/Runner/Info-Debug.plist', '<key>NSAllowsArbitraryLoads</key><true/>'), []);
  assert.deepEqual(find('app/src/main/AndroidManifest.xml', '<application android:debuggable="true"/>'), ['mobile-debuggable']);
  // a domain-only exception (localhost) is deliberate
  assert.deepEqual(find('app/src/main/res/xml/network_security_config.xml', '<network-security-config><domain-config cleartextTrafficPermitted="true"><domain>10.0.2.2</domain></domain-config></network-security-config>'), []);
  assert.deepEqual(find('app/src/main/res/xml/network_security_config.xml', '<network-security-config><base-config cleartextTrafficPermitted="true"/></network-security-config>'), ['mobile-cleartext']);
});

test("Health: a mobile app hard-coded to the emulator's address of the computer, unless it switches on debug mode", () => {
  const k = (src, lang) => findIssues(src, { path: 'lib/config.dart', category: 'code', lang }).filter((x) => x.k === 'localhost').length;
  assert.equal(k(`const api = 'http://10.0.2.2:8000';`, 'dart'), 1);
  assert.equal(k(`final api = kDebugMode ? 'http://10.0.2.2:8000' : 'https://api.shop.com';`, 'dart'), 0);
});

test('screens: auto_route pages and MaterialApp route tables', () => {
  const auto = findScreens(`final routes = [AutoRoute(page: HomeRoute.page, path: '/'), AutoRoute(page: CartRoute.page, path: '/cart', children: [AutoRoute(page: CheckoutRoute.page, path: 'checkout')])];`, { path: 'lib/router.dart', category: 'code', lang: 'dart' });
  assert.deepEqual(auto.map((h) => `${h.url} ${h.comp}`), ['/ HomePage', '/cart CartPage', '/cart/checkout CheckoutPage']);
  const table = findScreens(`MaterialApp(routes: { '/': (context) => const HomeScreen(), '/cart': (_) => CartScreen() });`, { path: 'lib/main.dart', category: 'code', lang: 'dart' });
  assert.deepEqual(table.map((h) => `${h.url} ${h.comp}`), ['/ HomeScreen', '/cart CartScreen']);
});

test('Dart servers: shelf_router routes under their mount, and the Flutter app calling them; the server is named by its folder', () => {
  const r = makeProject({
    'shop/server/pubspec.yaml': `name: shop_server\ndependencies:\n  shelf_router: ^1.1.0\n`,
    'shop/server/bin/main.dart': `import 'package:shelf_router/shelf_router.dart';\nimport '../lib/booking.dart';\nfinal app = Router()\n  ..mount('/booking', BookingApi().router.call);\n`,
    'shop/server/lib/booking.dart': `import 'package:shelf_router/shelf_router.dart';\nclass BookingApi {\n  Router get router {\n    final router = Router();\n    router.get('/', (Request r) => Response.ok(''));\n    router.delete('/<id>', (Request r, String id) => Response.ok(''));\n    return router;\n  }\n}\n`,
    'shop/app/pubspec.yaml': `name: shop_app\ndependencies:\n  flutter:\n    sdk: flutter\n`,
    'shop/app/lib/api.dart': `class Api {\n  Future<void> list() => client.get(host, port, '/booking');\n  Future<void> cancel(int id) => client.delete(host, port, '/booking/$id');\n}\n`,
  }, { repos: ['shop'] });
  try {
    run('scan.mjs', r);
    const s = readJson(path.join(r, 'codemap', '.cache', 'scan.json'));
    assert.deepEqual(s.routes.map((x) => `${x.method} ${x.path}`).sort(), ['DELETE /booking/<id>', 'GET /booking']);
    assert.deepEqual(s.http.map((h) => `${h.from.split('/').pop()} ${h.method} ${h.path}`).sort(), ['api.dart DELETE /booking/<id>', 'api.dart GET /booking']);
    assert.ok(s.apps.some((a) => a.platform === 'server' && a.dir === 'shop/server'), JSON.stringify(s.apps));
  } finally { cleanup(r); }
});

test('screens: route names kept as constants in another file (Dart Routes.login, Kotlin Screen.Home.route)', () => {
  const r = makeProject({
    'app/pubspec.yaml': `name: app\ndependencies:\n  flutter:\n    sdk: flutter\n`,
    'app/lib/routes.dart': `abstract final class Routes {\n  static const login = '/login';\n  static const booking = '/$bookingRelative';\n  static const bookingRelative = 'booking';\n}\n`,
    'app/lib/router.dart': [
      `final router = GoRouter(routes: [`,
      `  GoRoute(path: Routes.login, builder: (c, s) => LoginScreen()),`,
      `  GoRoute(path: Routes.booking, builder: (c, s) { final vm = BookingViewModel(); return BookingScreen(viewModel: vm); },`,
      `    routes: [GoRoute(path: ':id', builder: (c, s) => BookingScreen())]),`,
      `]);`,
    ].join('\n'),
    'droid/app/src/main/java/com/x/Screen.kt': `package com.x\nsealed class Screen(val route: String) {\n  data object Home : Screen("home")\n  data object Plant : Screen("plant/{plantId}")\n}\n`,
    'droid/app/src/main/java/com/x/Nav.kt': `package com.x\nfun Nav() { NavHost(c, Screen.Home.route) {\n  composable(route = Screen.Home.route) { HomeScreen() }\n  composable(Screen.Plant.route) { PlantScreen() }\n} }\n`,
  }, { repos: ['app', 'droid'] });
  try {
    run('scan.mjs', r);
    const s = readJson(path.join(r, 'codemap', '.cache', 'scan.json'));
    const hints = s.files.flatMap((f) => (f.screens || []).filter((h) => h.comp).map((h) => `${h.url} ${h.comp}`)).sort();
    assert.deepEqual(hints, ['/booking BookingScreen', '/booking/:id BookingScreen', '/home HomeScreen', '/login LoginScreen', '/plant/:plantId PlantScreen']);
  } finally { cleanup(r); }
});

test('SwiftUI: a NavigationLink label is not a screen; its destination is', () => {
  const hints = findScreens(`struct L: View { var body: some View {\n  NavigationLink(value: c) { CountryCell(country: c) }\n  NavigationLink { CountryDetails(c: c) } label: { Text("x") }\n}}`, { path: 'A/L.swift', category: 'code', lang: 'swift' });
  assert.deepEqual(hints.map((h) => h.comp), ['CountryDetails']);
});

test("Swift: Apple's and Flutter's modules, and the app's own module, aren't outside packages", async () => {
  const { createResolver } = await lib('resolve.mjs');
  const files = [{ path: 'Shop.xcodeproj/project.pbxproj' }, { path: 'Shop/A.swift', lang: 'swift' }];
  const res = createResolver('/nowhere', files);
  for (const m of ['Cocoa', 'PackageDescription', 'Flutter', 'Shop']) assert.ok(res(files[1], { spec: m }).builtin, m);
  assert.deepEqual(res(files[1], { spec: 'Alamofire' }), { external: 'Alamofire', eco: 'swift' });
});

test('impact: a changed server route reaches the Flutter, Android and iOS code that calls it, and their screens', () => {
  const out = JSON.parse(run('impact.mjs', root, '--files', 'api/routes/orders.js', '--json'));
  assert.deepEqual(out.changed.map((c) => c.part), ['Server']);
  const e = out.endpoints.find((x) => x.method === 'GET' && x.path === '/api/orders/:id');
  assert.deepEqual(e.callers.map((c) => c.part).sort(), ['Android app', 'Flutter app', 'iPhone app']);
  const viaHttp = out.affected.filter((a) => a.via === 'http').map((a) => a.file).sort();
  assert.deepEqual(viaHttp, ['shop_android/app/src/main/java/com/shop/api/ShopApi.kt', 'shop_flutter/lib/api/client.dart', 'shop_ios/Shop/APIClient.swift']);
  // and on through imports to the screens that use those clients
  assert.ok(out.affected.some((a) => a.file === 'shop_flutter/lib/screens/order_screen.dart' && a.depth === 2));
  assert.ok(out.screens.some((s) => s.app === 'Flutter app' && s.url === '/orders/:id'));
  assert.ok(out.summary.callersInOtherApps >= 3);
  const md = run('impact.mjs', root, '--files', 'api/routes/orders.js', '--markdown');
  assert.match(md, /^## Codemap impact/m);
  assert.match(md, /`GET \/api\/orders\/:id`.*called from/);
});

test('Kotlin Multiplatform: the iOS app is linked to the shared Kotlin code it uses', () => {
  const r = makeProject({
    'kmp/shared/build.gradle.kts': `plugins { kotlin("multiplatform") }\n`,
    'kmp/shared/src/commonMain/kotlin/com/x/Greeting.kt': `package com.x\nclass Greeting {\n  fun greet(): String = "hi"\n}\n`,
    'kmp/iosApp/iosApp/ContentView.swift': `import SwiftUI\nimport Shared\nstruct ContentView: View {\n  var body: some View { Text(Greeting().greet()) }\n}\n`,
  }, { repos: ['kmp'] });
  try {
    run('scan.mjs', r);
    const s = readJson(path.join(r, 'codemap', '.cache', 'scan.json'));
    assert.ok(s.edges.some((e) => e.from === 'kmp/iosApp/iosApp/ContentView.swift' && e.to === 'kmp/shared/src/commonMain/kotlin/com/x/Greeting.kt'), JSON.stringify(s.edges));
    assert.ok(s.apps.some((a) => a.platform === 'kmp'));
  } finally { cleanup(r); }
});

test('a TanStack route named only in a comment is not a screen; a real one still is', () => {
  const f = { path: 'src/lib/screens.ts', category: 'code', lang: 'typescript' };
  assert.deepEqual(findScreens(`// TanStack Router file routes: createFileRoute('/products/$id')\nexport const x = 1;\n`, f), []);
  assert.deepEqual(findScreens(`/*\n * createFileRoute('/a')\n */\nexport const y = 2;\n`, f), []);
  const real = findScreens(`export const Route = createFileRoute('/products/$id')({ component: P });\n`, { ...f, path: 'src/routes/products.$id.tsx' });
  assert.deepEqual(real.map((s) => s.url), ['/products/:id']);
});

test('a Dart server\'s bin/ folder is source, not build output (outside git too)', () => {
  const r = makeProject({ 'server/pubspec.yaml': 'name: shop_server\n', 'server/bin/main.dart': `void main() {}\n`, 'web/bin/app.dll': 'x', 'web/Web.csproj': '<Project/>' }, { arch: { project: { name: 'x', summary: 'x' }, nodes: [{ id: 's', label: 'S', kind: 'service', summary: 's', paths: ['server/**', 'web/**'] }] } });
  try {
    run('scan.mjs', r);
    const paths = readJson(path.join(r, 'codemap', '.cache', 'scan.json')).files.map((f) => f.path);
    assert.ok(paths.includes('server/bin/main.dart'), paths.join(', '));
    assert.ok(!paths.includes('web/bin/app.dll'));
  } finally { cleanup(r); }
});
