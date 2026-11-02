// The apps in a codebase: mobile apps (Flutter, Android, iOS, React Native, Expo, Kotlin Multiplatform),
// websites (Next.js, Nuxt, SvelteKit, Vite …) and servers (folders that define endpoints). Printed in the
// scan summary and kept as scan.apps, so the map can give each app its own part even when one folder holds
// several codebases side by side.
//
// detectApps({ root, files, routes }) -> [{ kind, platform, dir, name, evidence, host? }]
//   kind: 'mobile' | 'web' | 'server'
//   platform: flutter | android | ios | react-native | expo | kmp | next | nuxt | sveltekit | remix | astro |
//             angular | vite | web | server
//   host: for native folders that belong to a cross-platform app (Flutter's android/ and ios/), its dir

import fs from 'node:fs';
import path from 'node:path';
import { readJsonLoose } from './common.mjs';

const P = path.posix;
const read = (root, p, max = 200_000) => { try { const t = fs.readFileSync(path.join(root, p), 'utf8'); return t.length > max ? t.slice(0, max) : t; } catch { return ''; } };
const TESTY = /(^|\/)(tests?|__tests__|fixtures?|examples?|samples?|node_modules|build|dist|\.dart_tool|Pods)\//i;

export function detectApps({ root, files, routes = [] }) {
  const apps = [];
  const paths = files.map((f) => f.path).filter((p) => !TESTY.test(p));
  const add = (a) => { if (!apps.some((x) => x.dir === a.dir && x.platform === a.platform)) apps.push(a); };
  const dirOf = (p) => P.dirname(p) === '.' ? '.' : P.dirname(p);

  // Flutter: pubspec.yaml that depends on the Flutter SDK
  const flutterDirs = [];
  for (const p of paths.filter((x) => P.basename(x) === 'pubspec.yaml')) {
    const t = read(root, p);
    if (!/^\s*flutter\s*:/m.test(t) && !/sdk:\s*flutter/.test(t)) continue;
    const dir = dirOf(p);
    flutterDirs.push(dir);
    add({ kind: 'mobile', platform: 'flutter', dir, name: /^name:\s*([\w-]+)/m.exec(t)?.[1] || P.basename(dir), evidence: p });
  }
  // React Native / Expo, and websites, from package.json dependencies
  const rnDirs = [];
  for (const p of paths.filter((x) => P.basename(x) === 'package.json')) {
    const pj = readJsonLoose(path.join(root, p));
    if (!pj) continue;
    const deps = { ...pj.dependencies, ...pj.devDependencies };
    const dir = dirOf(p);
    const name = pj.name || P.basename(dir === '.' ? root : dir);
    if (deps.expo) { rnDirs.push(dir); add({ kind: 'mobile', platform: 'expo', dir, name, evidence: p }); continue; }
    if (deps['react-native']) { rnDirs.push(dir); add({ kind: 'mobile', platform: 'react-native', dir, name, evidence: p }); continue; }
    const web = deps.next ? 'next' : deps.nuxt ? 'nuxt' : deps['@sveltejs/kit'] ? 'sveltekit' : deps['@remix-run/react'] || deps['react-router'] && deps['@react-router/dev'] ? 'remix'
      : deps.astro ? 'astro' : deps['@angular/core'] ? 'angular' : deps.vite && (deps.react || deps.vue || deps.svelte || deps['solid-js'] || deps.preact) ? 'vite' : null;
    if (web) add({ kind: 'web', platform: web, dir, name, evidence: p });
  }
  const hostOf = (p) => [...flutterDirs, ...rnDirs].filter((d) => d === '.' || p.startsWith(d + '/')).sort((a, b) => b.length - a.length)[0];

  // Android: an application module's manifest (src/main/AndroidManifest.xml next to a build.gradle)
  for (const p of paths.filter((x) => /(^|\/)src\/main\/AndroidManifest\.xml$/.test(x))) {
    const dir = p.replace(/\/?src\/main\/AndroidManifest\.xml$/, '') || '.';
    const gradle = read(root, P.join(dir, 'build.gradle.kts')) || read(root, P.join(dir, 'build.gradle'));
    const isApp = /com\.android\.application|android\.application\b/.test(gradle) || /<activity\b/.test(read(root, p));
    if (!isApp) continue;
    const host = hostOf(p);
    add({ kind: 'mobile', platform: 'android', dir, name: P.basename(dir === 'app' || /\/app$/.test(dir) ? P.dirname(dir) === '.' ? root : P.dirname(dir) : dir), evidence: p, ...(host ? { host } : {}) });
  }
  // iOS: an Xcode project, or a Swift package that targets iOS
  const xcode = new Set(paths.map((x) => /^(.*?)([^/]+)\.xcodeproj\//.exec(x)).filter(Boolean).map((m) => `${m[1]}${m[2]}`));
  for (const proj of xcode) {
    const dir = P.dirname(proj) === '.' ? '.' : P.dirname(proj);
    if (/(^|\/)Pods$/.test(dir)) continue;
    const host = hostOf(proj + '.xcodeproj/');
    // (a Flutter app's macos/ folder is its desktop shell)
    add({ kind: 'mobile', platform: /(^|\/)macos$/.test(dir) ? 'macos' : 'ios', dir, name: P.basename(proj), evidence: proj + '.xcodeproj', ...(host ? { host } : {}) });
  }
  for (const p of paths.filter((x) => P.basename(x) === 'Package.swift')) {
    if (!/\.iOS\(/.test(read(root, p))) continue;
    const dir = dirOf(p);
    if (!apps.some((a) => a.platform === 'ios' && (a.dir === dir || dir.startsWith(a.dir + '/')))) add({ kind: 'mobile', platform: 'ios', dir, name: P.basename(dir), evidence: p });
  }
  // Kotlin Multiplatform: shared code for Android and iOS
  for (const p of paths.filter((x) => /(^|\/)build\.gradle\.kts$/.test(x))) {
    if (/kotlin\(\s*["']multiplatform["']\s*\)|org\.jetbrains\.kotlin\.multiplatform|libs\.plugins\.kotlinMultiplatform/.test(read(root, p))) add({ kind: 'mobile', platform: 'kmp', dir: dirOf(p), name: P.basename(dirOf(p)), evidence: p });
  }
  // Servers: top folders (per repo) that define endpoints, outside the apps above
  // (a server is the nearest folder above its endpoints that holds a project manifest: package.json, pubspec.yaml, go.mod …)
  const MANIFEST = /^(package\.json|pubspec\.yaml|pyproject\.toml|requirements\.txt|setup\.py|go\.mod|Cargo\.toml|pom\.xml|build\.gradle(\.kts)?|composer\.json|Gemfile|deno\.json|firebase\.json)$/;
  const manifestDirs = new Set(paths.filter((x) => MANIFEST.test(P.basename(x))).map(dirOf));
  const serverDir = (file) => {
    for (let d = dirOf(file); ; d = dirOf(d)) { if (manifestDirs.has(d)) return d; if (d === '.') break; }
    const segs = file.split('/');
    return segs.length > 1 && !/^(src|app|lib|cmd|internal|pkg|routes|routers|controllers|handlers)$/.test(segs[0]) ? segs[0] : '.';
  };
  const byDir = new Map();
  for (const r of routes) { const dir = serverDir(r.file); byDir.set(dir, (byDir.get(dir) || 0) + 1); }
  // (endpoints inside a website that serves its own, like Next.js API routes, belong to that website)
  const SERVES = new Set(['next', 'nuxt', 'sveltekit', 'remix', 'astro', 'expo']);
  for (const [dir, n] of byDir) {
    if (apps.some((a) => (a.kind === 'mobile' || SERVES.has(a.platform)) && (a.dir === '.' || dir === a.dir || dir.startsWith(a.dir + '/')))) continue;
    add({ kind: 'server', platform: 'server', dir, name: P.basename(dir === '.' ? root : dir), evidence: `${n} endpoint${n === 1 ? '' : 's'}` });
  }
  const order = { mobile: 0, web: 1, server: 2 };
  return apps.sort((a, b) => order[a.kind] - order[b.kind] || a.dir.localeCompare(b.dir));
}

const LABEL = { flutter: 'Flutter app (Android + iOS)', android: 'Android app', ios: 'iOS app', macos: 'macOS app', 'react-native': 'React Native app', expo: 'Expo app (React Native)', kmp: 'Kotlin Multiplatform shared code',
  next: 'Next.js website', nuxt: 'Nuxt website', sveltekit: 'SvelteKit website', remix: 'Remix / React Router website', astro: 'Astro website', angular: 'Angular website', vite: 'Vite website', server: 'Server' };
export const appLabel = (a) => LABEL[a.platform] || a.platform;
