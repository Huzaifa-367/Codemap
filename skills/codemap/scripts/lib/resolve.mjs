// Resolve import specifiers to files in the codebase, or to named external packages.
import fs from 'node:fs';
import path from 'node:path';
import { readJsonLoose } from './common.mjs';

const P = path.posix;

const NODE_BUILTINS = new Set(['assert', 'async_hooks', 'buffer', 'child_process', 'cluster', 'console', 'constants', 'crypto', 'dgram', 'dns', 'domain', 'events', 'fs', 'http', 'http2', 'https', 'inspector', 'module', 'net', 'os', 'path', 'perf_hooks', 'process', 'punycode', 'querystring', 'readline', 'repl', 'stream', 'string_decoder', 'timers', 'tls', 'tty', 'url', 'util', 'v8', 'vm', 'wasi', 'worker_threads', 'zlib', 'test']);
const PY_STDLIB = new Set('__future__ abc argparse array ast asyncio atexit base64 bisect builtins bz2 calendar cgi cmath codecs collections colorsys concurrent configparser contextlib contextvars copy csv ctypes curses dataclasses datetime decimal difflib dis email encodings enum errno faulthandler fcntl filecmp fileinput fnmatch fractions ftplib functools gc getopt getpass gettext glob graphlib gzip hashlib heapq hmac html http imaplib importlib inspect io ipaddress itertools json keyword linecache locale logging lzma mailbox math mimetypes mmap multiprocessing netrc numbers operator optparse os pathlib pdb pickle pkgutil platform plistlib poplib posixpath pprint profile pstats pty queue quopri random re readline reprlib resource rlcompleter runpy sched secrets select selectors shelve shlex shutil signal site smtplib socket socketserver sqlite3 ssl stat statistics string stringprep struct subprocess sys sysconfig syslog tarfile tempfile termios textwrap threading time timeit tkinter token tokenize tomllib trace traceback tracemalloc tty turtle types typing typing_extensions unicodedata unittest urllib uuid venv warnings wave weakref webbrowser winreg wsgiref xml xmlrpc zipfile zipimport zlib zoneinfo'.split(' '));
const RUST_STD = new Set(['std', 'core', 'alloc', 'crate', 'self', 'super']);

const JS_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts', '.vue', '.svelte', '.d.ts', '.json'];

export function createResolver(root, files) {
  const fileSet = new Set(files.map((f) => f.path));
  const byPath = new Map(files.map((f) => [f.path, f]));
  const dirsWith = (name) => files.filter((f) => P.basename(f.path) === name).map((f) => P.dirname(f.path));

  // ---- JS: tsconfig/jsconfig paths + workspace packages ----
  let wsEarly = null;
  function workspacePkgsEarly() {
    if (wsEarly) return wsEarly;
    wsEarly = new Map();
    for (const dir of dirsWith('package.json')) { const pj = readJsonLoose(path.join(root, dir, 'package.json')); if (pj?.name) wsEarly.set(pj.name, { dir, pj }); }
    return wsEarly;
  }
  const tsconfigCache = new Map();
  const loadTsconfig = (file) => {
    if (tsconfigCache.has(file)) return tsconfigCache.get(file);
    let cfg = null;
    const json = readJsonLoose(path.join(root, file));
    if (json) {
      const dir = P.dirname(file);
      let opts = json.compilerOptions || {};
      let optsDir = dir;
      // extends: one config or a list (TS 5), relative files or packages in the repo (a workspace tsconfig package);
      // paths and baseUrl come from the nearest config that sets them, relative to that config
      if (!opts.paths && !opts.baseUrl) {
        const list = (Array.isArray(json.extends) ? json.extends : [json.extends]).filter((x) => typeof x === 'string');
        for (const ext of list.reverse()) {
          let extFile = null;
          if (ext.startsWith('.')) extFile = P.normalize(P.join(dir, /\.json$/.test(ext) ? ext : ext + '.json'));
          else { const pkg = ext.startsWith('@') ? ext.split('/').slice(0, 2).join('/') : ext.split('/')[0]; const ws = workspacePkgsEarly().get(pkg); if (ws) { const rest = ext.slice(pkg.length + 1); extFile = P.normalize(P.join(ws.dir, rest ? (/\.json$/.test(rest) ? rest : rest + '.json') : 'tsconfig.json')); } }
          const base = extFile && fileSet.has(extFile) ? loadTsconfig(extFile) : null;
          if (base && (base.raw.paths || base.raw.baseUrl)) { opts = { ...opts, paths: base.raw.paths, baseUrl: base.raw.baseUrl }; optsDir = base.optsDir; break; }
        }
      }
      const baseDir = opts.baseUrl ? P.normalize(P.join(optsDir, opts.baseUrl)) : optsDir;
      cfg = { raw: opts, optsDir, baseDir, hasBaseUrl: !!opts.baseUrl, paths: Object.entries(opts.paths || {}) };
    }
    tsconfigCache.set(file, cfg);
    return cfg;
  };
  const nearestCache = new Map();
  const nearestTsconfig = (dir) => {
    if (nearestCache.has(dir)) return nearestCache.get(dir);
    let found = null;
    for (const name of ['tsconfig.json', 'jsconfig.json']) {
      const f = dir === '.' ? name : `${dir}/${name}`;
      if (fileSet.has(f)) { found = loadTsconfig(f); if (found) break; }
    }
    if (!found && dir !== '.' && dir !== '') found = nearestTsconfig(P.dirname(dir));
    nearestCache.set(dir, found);
    return found;
  };
  const workspacePkgs = workspacePkgsEarly();
  // package.json "imports" (#aliases), per package folder
  const pkgImports = new Map();
  for (const [, w] of workspacePkgs) if (w.pj.imports) pkgImports.set(w.dir, w.pj.imports);
  for (const dir of dirsWith('package.json')) if (!pkgImports.has(dir)) { const pj = readJsonLoose(path.join(root, dir, 'package.json')); if (pj?.imports) pkgImports.set(dir, pj.imports); }
  const nearestDirIn = (map, from) => { for (let d = P.dirname(from); ; d = P.dirname(d)) { const k = d === '' ? '.' : d; if (map.has(k)) return k; if (k === '.') return null; } };
  // a condition object ({ import, require, node, default, types }) or a string: the path to use
  const pickTarget = (t) => typeof t === 'string' ? t : Array.isArray(t) ? pickTarget(t[0]) : t && typeof t === 'object' ? pickTarget(t.source ?? t.import ?? t.module ?? t.node ?? t.default ?? t.require ?? Object.values(t).find((v) => typeof v === 'string' && !/\.d\.ts$/.test(v))) : null;
  /** A subpath map ({ "./client": …, "./utils/*": … } or { "#db": …, "#utils/*": … }) applied to a key. */
  const mapSubpath = (map, key) => {
    if (!map || typeof map !== 'object') return null;
    if (key in map) return pickTarget(map[key]);
    for (const [pat, t] of Object.entries(map)) {
      const star = pat.indexOf('*');
      if (star < 0) continue;
      const a = pat.slice(0, star), b = pat.slice(star + 1);
      if (key.startsWith(a) && key.endsWith(b) && key.length >= a.length + b.length) { const v = pickTarget(t); if (v) return v.split('*').join(key.slice(a.length, key.length - b.length)); }
    }
    return null;
  };
  // bundler aliases: vite / vitest / webpack / vue / svelte / astro configs ('@' -> ./src), per config folder
  const aliases = new Map();
  for (const f of files) {
    if (!/(^|\/)(vite|vitest|webpack|vue|svelte|astro|rsbuild|rspack)\.config\.(c|m)?[jt]s$|(^|\/)craco\.config\.js$/.test(f.path)) continue;
    let src = '';
    try { src = fs.readFileSync(path.join(root, f.path), 'utf8'); } catch { continue; }
    const dir = P.dirname(f.path) === '.' ? '.' : P.dirname(f.path);
    const list = aliases.get(dir) || [];
    const val = (v) => /(["'`])(\.{0,2}\/?[\w@\-./]*)\1/.exec(v.replace(/__dirname\s*,|import\.meta\.url|process\.cwd\(\)\s*,/g, ''))?.[2];
    for (const m of src.matchAll(/(["'`])([@~#$\w\-/]+)\1\s*:\s*([^,\n}]+(?:\([^)]*\))?[^,\n}]*)/g)) {
      const block = src.slice(Math.max(0, m.index - 400), m.index);
      if (!/alias\s*:\s*\{[^}]*$/.test(block)) continue;
      const to = val(m[3]); if (to != null) list.push([m[2], to]);
    }
    for (const m of src.matchAll(/find\s*:\s*(["'`])([^"'`]+)\1\s*,\s*replacement\s*:\s*([^}]+)\}/g)) { const to = val(m[3]); if (to != null) list.push([m[2], to]); }
    if (list.length) aliases.set(dir, list);
  }
  const viaAlias = (from, spec) => {
    const dir = nearestDirIn(aliases, from);
    for (const [key, to] of dir ? aliases.get(dir) : []) {
      if (spec !== key && !spec.startsWith(key.endsWith('/') ? key : key + '/')) continue;
      const rest = spec.slice(key.length).replace(/^\//, '');
      const base = to.startsWith('/') ? P.join(dir, to.slice(1)) : P.join(dir, to);
      const hit = tryJsFile(rest ? P.join(base, rest) : base);
      if (hit) return hit;
    }
    // the common convention when no config says otherwise: '@/x' and '~/x' mean src/x of the nearest package
    const m = /^[@~]\/(.+)$/.exec(spec);
    if (m) for (let d = P.dirname(from); ; d = P.dirname(d)) {
      const k = d === '' ? '.' : d;
      const hit = tryJsFile(P.join(k, 'src', m[1])) || (fileSet.has(P.join(k, 'package.json')) ? tryJsFile(P.join(k, m[1])) : null);
      if (hit) return hit;
      if (k === '.' || fileSet.has(P.join(k, 'package.json'))) break;
    }
    return null;
  };

  const tryJsFile = (p) => {
    p = P.normalize(p);
    if (fileSet.has(p) && !p.endsWith('/')) return p;
    for (const ext of JS_EXTS) if (fileSet.has(p + ext)) return p + ext;
    const jsToTs = p.replace(/\.(m|c)?jsx?$/, '');
    if (jsToTs !== p) for (const ext of ['.ts', '.tsx', '.mts', '.cts']) if (fileSet.has(jsToTs + ext)) return jsToTs + ext;
    for (const ext of JS_EXTS) if (fileSet.has(`${p}/index${ext}`)) return `${p}/index${ext}`;
    return null;
  };

  const resolveJs = (from, spec) => {
    if (spec.startsWith('.')) {
      const hit = tryJsFile(P.join(P.dirname(from), spec));
      return hit ? { file: hit } : { unresolved: true };
    }
    const cfg = nearestTsconfig(P.dirname(from));
    if (cfg) {
      for (const [pattern, targets] of cfg.paths) {
        const star = pattern.indexOf('*');
        const matched = star === -1 ? (spec === pattern ? '' : null)
          : (spec.startsWith(pattern.slice(0, star)) && spec.endsWith(pattern.slice(star + 1)) ? spec.slice(star, spec.length - (pattern.length - star - 1)) : null);
        if (matched === null) continue;
        for (const t of targets) {
          const hit = tryJsFile(P.join(cfg.baseDir, t.split('*').join(matched)));
          if (hit) return { file: hit };
        }
      }
      if (cfg.hasBaseUrl) { const hit = tryJsFile(P.join(cfg.baseDir, spec)); if (hit) return { file: hit }; }
    }
    // package.json "imports": #utils/x
    if (spec.startsWith('#')) {
      const dir = nearestDirIn(pkgImports, from);
      const t = dir ? mapSubpath(pkgImports.get(dir), spec) : null;
      const hit = t && (tryJsFile(P.join(dir, t)) || tryJsFile(P.join(dir, t.replace(/^\.\/(dist|lib|build)\//, './src/'))));
      return hit ? { file: hit } : { unresolved: true };
    }
    { const hit = viaAlias(from, spec); if (hit) return { file: hit }; }
    if (spec.startsWith('node:')) return { builtin: true };
    const parts = spec.split('/');
    const pkgName = spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
    const sub = parts.slice(spec.startsWith('@') ? 2 : 1).join('/');
    const ws = workspacePkgs.get(pkgName);
    if (ws) {
      // the package's "exports" map first (./client, ./utils/*), with built paths mapped back to source
      if (sub && ws.pj.exports && typeof ws.pj.exports === 'object') {
        const t = mapSubpath(ws.pj.exports, './' + sub);
        const hit = t && (tryJsFile(P.join(ws.dir, t)) || tryJsFile(P.join(ws.dir, t.replace(/^\.\/(dist|lib|build)\//, './src/').replace(/\.(c|m)?js$/, ''))));
        if (hit) return { file: hit };
      }
      if (sub) { const hit = tryJsFile(P.join(ws.dir, sub)) || tryJsFile(P.join(ws.dir, 'src', sub)); if (hit) return { file: hit }; }
      const exp = ws.pj.exports;
      const entries = [ws.pj.source, typeof exp === 'string' ? exp : exp?.['.']?.import || exp?.['.']?.default || (typeof exp?.['.'] === 'string' ? exp['.'] : null), ws.pj.module, ws.pj.main, 'src/index', 'index'];
      for (const e of entries) { if (typeof e !== 'string') continue; const hit = tryJsFile(P.join(ws.dir, e)); if (hit) return { file: hit }; }
    }
    if (NODE_BUILTINS.has(pkgName)) return { builtin: true };
    if (/^[@a-z0-9]/i.test(pkgName)) return { external: pkgName, eco: 'npm' };
    return { unresolved: true };
  };

  // ---- Python ----
  const pyRootsCache = new Map();
  const pyRootsFor = (from, repoPath) => {
    const dir = P.dirname(from);
    const key = dir + '|' + repoPath;
    if (pyRootsCache.has(key)) return pyRootsCache.get(key);
    const roots = [];
    const repoRoot = repoPath === '.' ? '' : repoPath;
    let d = dir;
    while (true) {
      roots.push(d === '.' ? '' : d);
      if (d === repoRoot || d === '.' || d === '') break;
      d = P.dirname(d);
    }
    roots.push(repoRoot ? repoRoot + '/src' : 'src');
    pyRootsCache.set(key, roots);
    return roots;
  };
  const tryPyModule = (base) => {
    const b = base.replace(/^\/+/, '');
    if (fileSet.has(b + '.py')) return b + '.py';
    if (fileSet.has(b + '/__init__.py')) return b + '/__init__.py';
    if (fileSet.has(b + '.pyi')) return b + '.pyi';
    return null;
  };
  const resolvePy = (from, imp, repoPath) => {
    const spec = imp.spec;
    const targets = [];
    if (spec.startsWith('.')) {
      const dots = spec.match(/^\.+/)[0].length;
      let base = P.dirname(from);
      for (let i = 1; i < dots; i++) base = P.dirname(base);
      const rest = spec.slice(dots).replace(/\./g, '/');
      const modBase = rest ? P.join(base, rest) : base;
      const mod = rest ? tryPyModule(modBase) : null;
      const subs = (imp.names || []).map((n) => tryPyModule(P.join(modBase, n))).filter(Boolean);
      if (subs.length) return { files: subs, names: imp.names, module: mod };
      if (mod) return { file: mod };
      if (!rest) { const init = tryPyModule(base); if (init) return { file: init }; }
      return { unresolved: true };
    }
    const top = spec.split('.')[0];
    const modPath = spec.replace(/\./g, '/');
    for (const r of pyRootsFor(from, repoPath)) {
      const base = r ? `${r}/${modPath}` : modPath;
      if (imp.from && imp.names?.length) {
        const subs = imp.names.map((n) => tryPyModule(`${base}/${n}`)).filter(Boolean);
        if (subs.length) return { files: subs, names: imp.names, module: tryPyModule(base) };
      }
      const hit = tryPyModule(base);
      if (hit) return { file: hit };
      // `import a.b.c` where only a/b exists
      const parts = modPath.split('/');
      for (let k = parts.length - 1; k >= 1; k--) {
        const h = tryPyModule((r ? r + '/' : '') + parts.slice(0, k).join('/'));
        if (h && targets.length === 0) { targets.push(h); break; }
      }
      if (targets.length) return { file: targets[0] };
    }
    if (PY_STDLIB.has(top)) return { builtin: true };
    return { external: top, eco: 'pypi' };
  };

  // ---- Go ----
  const goMods = dirsWith('go.mod').map((dir) => {
    const txt = fs.readFileSync(path.join(root, dir, 'go.mod'), 'utf8');
    return { dir, module: /^module\s+(\S+)/m.exec(txt)?.[1] };
  }).filter((m) => m.module).sort((a, b) => b.module.length - a.module.length);
  const goDirFiles = new Map();
  for (const f of files) if (f.path.endsWith('.go') && !f.path.endsWith('_test.go')) {
    const d = P.dirname(f.path);
    if (!goDirFiles.has(d)) goDirFiles.set(d, []);
    goDirFiles.get(d).push(f.path);
  }
  const resolveGo = (from, spec) => {
    for (const m of goMods) {
      if (spec === m.module || spec.startsWith(m.module + '/')) {
        const dir = P.normalize(P.join(m.dir, spec.slice(m.module.length)));
        const list = goDirFiles.get(dir === '' ? '.' : dir);
        if (list?.length) {
          const pref = list.find((p) => P.basename(p, '.go') === P.basename(dir)) || list.sort()[0];
          return { file: pref };
        }
        return { unresolved: true };
      }
    }
    if (!spec.split('/')[0].includes('.')) return { builtin: true };
    return { external: spec.split('/').slice(0, 3).join('/'), eco: 'go' };
  };

  // ---- Rust ----
  const crateRoots = dirsWith('Cargo.toml').map((d) => (d === '.' ? 'src' : `${d}/src`)).sort((a, b) => b.length - a.length);
  const resolveRust = (from, imp) => {
    const dir = P.dirname(from);
    const stem = P.basename(from, '.rs');
    if (imp.kind === 'mod') {
      const base = ['mod', 'lib', 'main'].includes(stem) ? dir : `${dir}/${stem}`;
      for (const c of [`${base}/${imp.spec}.rs`, `${base}/${imp.spec}/mod.rs`]) if (fileSet.has(c)) return { file: c };
      return { unresolved: true };
    }
    const segs = imp.spec.split('::');
    if (segs[0] === 'crate') {
      const cr = crateRoots.find((r) => from.startsWith(r + '/'));
      if (!cr) return { unresolved: true };
      const rest = segs.slice(1);
      for (let k = rest.length; k >= 1; k--) {
        const b = `${cr}/${rest.slice(0, k).join('/')}`;
        for (const c of [b + '.rs', b + '/mod.rs']) if (fileSet.has(c)) return { file: c };
      }
      return { unresolved: true };
    }
    if (RUST_STD.has(segs[0])) return { builtin: true };
    return { external: segs[0], eco: 'cargo' };
  };

  // ---- JVM ----
  const jvmIndex = new Map();
  for (const f of files) if (f.pkg) jvmIndex.set(`${f.pkg}.${P.basename(f.path).replace(/\.\w+$/, '')}`, f.path);
  const resolveJvm = (from, spec) => {
    if (jvmIndex.has(spec)) return { file: jvmIndex.get(spec) };
    if (/^(java|javax|kotlin|scala|jdk|sun)\./.test(spec)) return { builtin: true };
    const parts = spec.split('.');
    for (let k = parts.length - 1; k >= 2; k--) if (jvmIndex.has(parts.slice(0, k).join('.'))) return { file: jvmIndex.get(parts.slice(0, k).join('.')) };
    return { external: parts.slice(0, Math.min(3, parts.length - 1)).join('.'), eco: 'maven' };
  };

  // ---- Dart: package:<name>/x.dart lives in the lib/ folder next to the pubspec.yaml that names <name> ----
  const dartPkgs = new Map();
  for (const dir of dirsWith('pubspec.yaml')) {
    let txt = '';
    try { txt = fs.readFileSync(path.join(root, dir, 'pubspec.yaml'), 'utf8'); } catch {}
    const name = /^name:\s*([\w-]+)/m.exec(txt)?.[1];
    if (name && !dartPkgs.has(name)) dartPkgs.set(name, dir === '.' ? '' : dir);
  }
  const resolveDart = (from, spec) => {
    if (spec.startsWith('dart:')) return { builtin: true };
    const pkg = /^package:([\w-]+)\/(.+)$/.exec(spec);
    if (pkg) {
      if (dartPkgs.has(pkg[1])) {
        const dir = dartPkgs.get(pkg[1]);
        const hit = P.normalize(P.join(dir, 'lib', pkg[2]));
        return fileSet.has(hit) ? { file: hit } : { unresolved: true };
      }
      return /^(flutter|flutter_test|flutter_localizations|flutter_web_plugins|flutter_driver|integration_test)$/.test(pkg[1]) ? { builtin: true } : { external: pkg[1], eco: 'pub' };
    }
    const hit = P.normalize(P.join(P.dirname(from), spec));
    return fileSet.has(hit) ? { file: hit } : { unresolved: true };
  };

  // ---- Swift: imports name modules; Apple's own are built in ----
  const APPLE = /^(Cocoa|PackageDescription|ObjectiveC|CoreFoundation|Flutter|FlutterMacOS|Foundation|SwiftUI|UIKit|AppKit|Combine|CoreData|CoreLocation|MapKit|AVFoundation|AVKit|Photos|PhotosUI|StoreKit|WebKit|SafariServices|UserNotifications|CloudKit|HealthKit|AuthenticationServices|CryptoKit|Security|LocalAuthentication|Network|OSLog|os|Observation|SwiftData|Charts|WidgetKit|ActivityKit|AppIntents|CoreGraphics|CoreImage|CoreML|Vision|ARKit|RealityKit|SceneKit|SpriteKit|GameKit|Contacts|EventKit|MessageUI|QuartzCore|Darwin|Dispatch|XCTest|Testing|_Concurrency|Accelerate|Metal|MetalKit|CoreMotion|CoreBluetooth|CoreHaptics|BackgroundTasks|PassKit|QuickLook|PDFKit|LinkPresentation|UniformTypeIdentifiers|SystemConfiguration|CoreTelephony|Speech|NaturalLanguage)$/;
  // the app's own module (`@testable import Shop` in its tests) is the app, not a package
  const ownModules = new Set(files.flatMap((f) => [/([^/]+)\.xcodeproj\//.exec(f.path)?.[1], /(?:^|\/)Sources\/([^/]+)\//.exec(f.path)?.[1]]).filter(Boolean));
  const resolveSwift = (spec) => (APPLE.test(spec) || ownModules.has(spec) ? { builtin: true } : { external: spec, eco: 'swift' });

  // ---- generic relative (C, Ruby, PHP, CSS) ----
  const byBasename = new Map();
  for (const f of files) { const b = P.basename(f.path); byBasename.set(b, byBasename.has(b) ? null : f.path); }
  const resolveRelative = (from, spec, exts) => {
    const base = P.normalize(P.join(P.dirname(from), spec));
    for (const e of ['', ...exts]) if (fileSet.has(base + e)) return { file: base + e };
    const uniq = byBasename.get(P.basename(spec));
    if (uniq) return { file: uniq };
    return { unresolved: true };
  };

  return function resolve(file, imp) {
    const lang = file.lang;
    switch (lang) {
      case 'typescript': case 'javascript': case 'vue': case 'svelte': case 'astro': return resolveJs(file.path, imp.spec);
      case 'python': return resolvePy(file.path, imp, file.repo);
      case 'go': return resolveGo(file.path, imp.spec);
      case 'rust': return resolveRust(file.path, imp);
      case 'java': case 'kotlin': case 'scala': case 'groovy': return resolveJvm(file.path, imp.spec);
      case 'dart': return resolveDart(file.path, imp.spec);
      case 'swift': return resolveSwift(imp.spec);
      case 'ruby': return resolveRelative(file.path, imp.spec, ['.rb']);
      case 'php': return resolveRelative(file.path, imp.spec, ['.php']);
      case 'css': return resolveRelative(file.path, imp.spec, ['.css', '.scss', '.sass', '.less']).file ? resolveRelative(file.path, imp.spec, ['.css', '.scss']) : resolveRelative(file.path, P.join(P.dirname(imp.spec), '_' + P.basename(imp.spec)), ['.scss', '.sass']);
      default: return resolveRelative(file.path, imp.spec, []);
    }
  };
}
