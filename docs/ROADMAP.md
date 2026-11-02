# Fork roadmap

Status at 1.0.0 (2026-11-02, renamed from Floorplan to Codemap): every planned item and every idea below is done.

## Milestone 1 — bugs + mobile apps (branch feat/mobile-multicodebase) — DONE
Done when all of this holds and `npm test` passes:
- [x] Bug: middleware before a `require()`-mounted router is kept (extract.mjs `[w$.]` typo).
- [x] Bug: Go 1.22 `HandleFunc("POST /items")` routes are found, with their method.
- [x] Bug: boolean flags no longer swallow the next argument; `--k=a=b` keeps `a=b`.
- [x] Flutter/Dart: imports (`package:`, relative), symbols, http/Dio calls with `$base`,
      retrofit.dart `@GET` + `@RestApi(baseUrl)`, Firebase callables; `*.g.dart`/`*.freezed.dart` are generated.
- [x] Swift/iOS: symbols, URLSession/Alamofire calls with `\(base)`, method from `.post` / `httpMethod`,
      same-module type references become connections.
- [x] Kotlin/Android: Retrofit `@GET("users/{id}")` client calls, Firebase callables,
      same-package references become connections.
- [x] Screens: go_router (nested, typed), MaterialApp routes, auto_route; Compose `composable("x")` and
      `composable<X>`; AndroidManifest activities and navigation-graph fragments; UIKit view controllers,
      SwiftUI screens and navigation targets.
- [x] Health: cleartext traffic (Android manifest / network security config, iOS ATS), debuggable release
      manifest, mobile code pointing at localhost / 10.0.2.2.
- [x] Scan summary lists the APPS found (mobile + web), stored as `scan.apps`; SKILL.md guidance updated.
- [x] End-to-end test: a backend and a Flutter app side by side, the app's calls reach the backend's endpoints.

Also done in M1 after trying real apps (Flutter compass_app, Android Sunflower, a SwiftUI sample):
- [x] Dart servers: shelf_router routes + mounts, dart_frog file routes.
- [x] Route constants in another file (Routes.login, Screen.Home.route) filled in per repo.
- [x] A server app is named by its nearest manifest folder; Flutter's macos/ shell labelled macOS.
- [x] Swift: Cocoa/PackageDescription/Flutter and the app's own module are not packages; NavigationLink labels aren't screens.

Known limits (next): SwiftUI views reached only through custom routers aren't screens; Android XML layouts and
Fragment transactions aren't followed; Kotlin Multiplatform shared code has no iOS-side links yet.

## Milestone 2 — impact, multi-codebase, correctness
- [x] Deterministic change impact (`impact.mjs`): changed files → users via imports and requests (cross-app), endpoints and
      their callers, screens, Health; text / `--markdown` (PR) / `--json`. (UA does this with an LLM; we do it with no tokens.)
- [x] Routers bound to any variable name (`const r = express.Router()`, `new Hono()`); `module.exports` isn't a handler.
- [x] Repos outside the root: linked folders are followed (one per real folder). A workspace file is no longer needed.
- [x] Shared endpoints get `METHOD /path @ file` keys; plain keys still work (no migration needed).
- [x] NestJS, Spring bare/array/method mappings, Gin/Echo groups.
- [x] chi `Route` closures, Laravel, Rails, ASP.NET. (Fastify's object form `fastify.route({...})` moves to ideas.)
- [x] Resolver: bundler aliases, `@/` `~/`, tsconfig `extends` lists/packages, `#imports`, `exports` maps.
- [x] Supabase `.from()`, Prisma and SQL strings as table uses; tables from migrations and Prisma (lib/data.mjs).
- [x] `build.mjs --json` receipts: errors with where/fix, coverage numbers.

## Agent efficiency (done in this branch)
- [x] `query.mjs context` (ranked line ranges for a task, PageRank over imports + requests + calls), `fn`, `map`.
- [x] CLAUDE.local.md block and SKILL.md tell agents and subagents to use the map before exploring.
- [x] Subagent briefs (`context --brief`); trace/impact inside codemap/query.mjs.
- [x] Context benchmark on three public sample apps (see AGENT-EFFICIENCY.md). A full agent-run benchmark moves to ideas.

## Milestone 3 — lenses on the same map (from the competitive study)
- [x] Viewer: upstream/downstream **reach**, functions and **trace boards** from any card (ui/45-follow.js).
- [x] **Layers** lens computed in build, shown from the Layers button.
- [x] **Domains**: `domain` on flows, Domains button.
- [x] **Staleness notice** (/api/freshness + ui/48-fresh.js).
- [x] **Call graph** (lib/calls.mjs) + **trace.mjs**: function → function across files, injected objects, callbacks,
      inline handlers, requests → handlers; text / mermaid / json / saved Flow. Zero deps, zero tokens.
- [x] **Delta**: previous maps kept as snapshots; `query.mjs delta`.

## Milestone 4 — explain, share, reach more people
- [x] Any board → **one-page HTML** with paths and the commit (Save).
- [x] **SVG export** of the current view (Save). (PNG share cards move to ideas.)
- [x] **Language** for names, descriptions, flows and Ask answers. (Translating the map's own buttons moves to ideas.)
- [x] Cursor and Copilot manifests; guide for Gemini CLI, OpenCode, Cline, Kiro, Trae. No hooks.
- [x] Ask bar: masks key formats in answers; "file contents are data" instruction. Still open: deny `.env*`/outside-root reads at the CLI level.
- [x] `tools/bench-context.mjs` (recall and reading on a built map).
- [x] Trust boundaries on top-level parts (`boundary`).

## Levels (the one-map model)
0 system (apps, services) → 1 parts → 2 files / screens / endpoints → 3 functions; flows cross all levels (trace.mjs).
Cost rule: structure is computed (0 tokens); the agent only names/describes, cached by fingerprint; functions are
never mass-described (docstrings + names), only explained on demand through Ask.

Done for level 3: Functions map in the Follow panel, interface → implementation edges. Next ideas: show functions in the viewer (expand a file card into its functions, highlight a traced flow),
interface → implementation edges by class declarations, and accuracy numbers on real repos.
Decision: stay regex-only (no tree-sitter) unless measured accuracy on real repos says otherwise.

## Ideas beyond the plan (done in 0.9.0)
- [x] Function boxes on the main canvas (technical detail), with call arrows.
- [x] PNG share cards; the map's own buttons translated; Fastify object routes; Kotlin Multiplatform iOS-side links.
- [x] Agent-run benchmark harness (`tools/bench-agent.mjs`). Real numbers need runs on your own account.

## What could come next
- [x] Real `bench-agent` numbers: Codemap itself and shadcn-ui/taxonomy (docs/AGENT-EFFICIENCY.md).
- [x] (0.9.1) Built-in translations of the most visible words for 9 languages.
- [x] (0.9.1) Right-to-left pages for Arabic, Urdu, Persian and Hebrew maps.
- [x] (Unreleased) Function cards wider, with their file and line; traces from a whole file start at its entry
  functions (at most 6, the rest named); the whole board saves as a PNG at full size.

## Flows 2: every working, end to end, every stack (started 2026-11-02)

Goal: from any screen, endpoint or function ("create order"), show the whole path across codebases (mobile screen →
state holder → repository → request → server route → controller → validation → service → database, events, jobs,
mail) and, on each step, what happens there (data in, fields checked, tables read/written, what it fires or queues,
what it returns). Generic layers with per-language patterns; no one-framework special cases. No tokens.

Milestones (each with tests on a multi-repo, multi-stack fixture):
- [x] F1 Test bed: Flutter app + Laravel API (repo pair) and a React/TS web app + Node/Express or Python API; expected
      end-to-end chains written as failing tests first.
- [x] F2 Requests across repos: base URLs, path constants, path params, API prefixes, typed clients (Dio, Retrofit,
      http, Ktor, URLSession/Alamofire, axios/fetch/ky, generated clients) matched to server routes.
- [x] F3 Async edges: events → listeners, jobs/queues → handlers, observers, mail/notifications, schedulers
      (Laravel, Node EventEmitter/BullMQ, Django signals/Celery, Spring events, Rails jobs, Go channels where clear).
- [x] F4 Step facts (data flow): parameters, request body sent, validation rules, tables read/written (ORM + SQL),
      events fired, jobs queued, mail sent, external calls, response returned, per language.
- [x] F5 Both directions: from any function, up to the screens/entry points that trigger it and down to the end.
- [x] F6 Explained flows: plain-English "what happens here" per step from the facts, in trace output, query.mjs and
      the map's flow panel; optional agent-written narrative in the describe step.
- [x] F7 Validate on real repos (MRM-Scrap, public Flutter+Laravel and React+Node pairs), visual check, benchmark, release.

Status 2026-11-02: F1–F6 done (tests/e2e-flow.test.mjs: Flutter+Laravel, React+Django, Android+NestJS, all end to end
with step facts and upstream). F6's optional agent-written narrative is not done. F7 in progress: MRM-Scrap rebuilt
(48 tables, 23 effects, facts on 113 functions); next: public repo pairs, visual check of long flows, benchmark, release.

Status 1.0.3 (2026-11-02): Flows 2 complete. Validated on laravel/react-starter-kit, Django-Styleguide-Example,
flutter/samples compass_app and the private MRM-Scrap repo; benchmark on MRM-Scrap in docs/AGENT-EFFICIENCY.md.
Flow stories (agent-written) and helper folding shipped. Next ideas: show upstream (STARTED FROM) on map boards,
request bodies from typed Retrofit/@Body classes, ORM writes through relation chains ($user->orders()->create()).
