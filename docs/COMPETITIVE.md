# Codemap vs Understand-Anything vs Archify

Researched 2026-11-02 from the source (`Egonex-AI/Understand-Anything` @ 2026-10-26, `tt-a1i/archify` 3.2.0 @ 2026-10-31).
Goal: decide what this fork adopts so it becomes the best tool for *understanding, checking and changing an app you own*,
across web, backend and mobile codebases.

## What each one really is

| | Codemap (this fork) | Understand-Anything (UA) | Archify |
|---|---|---|---|
| Core idea | Deterministic scan + agent naming → zoomable map of *your app*, with Health and Recent work | Multi-agent LLM pipeline → knowledge graph of every file/function/class | Agent writes typed JSON IR → validated, beautiful standalone diagram or one-page explainer |
| Parsing | Regex extractors, 20+ languages, zero deps | tree-sitter (13 grammars incl. Dart/Swift/Kotlin WASM) + LLM per file | None of its own: the agent reads the repo; evidence is pinned file+line+commit |
| Granularity | parts → modules → files → endpoints → exports | files, functions, classes, + domains/flows/steps | whatever the author draws (8–12 components recommended) |
| Cross-repo HTTP (frontend/mobile → backend) | **Yes, deterministic** (call literal ↔ route matching, prefixes, mounts) | No (endpoints only from OpenAPI/route files, no call matching) | Only if the agent draws it |
| Mobile apps | **Yes**: Flutter, Android, iOS, RN/Expo — requests, screens, Health | Structure + call graph for Dart/Swift/Kotlin; no screens, no requests | Not specific |
| Screens ("start from a page") | **Yes**, web + mobile routers | No | No |
| Security / Health | **Yes**: secrets, open endpoints, Supabase RLS, Firebase rules, Stripe webhooks, CORS, mobile cleartext | No | No (deployment-ownership profile checks *authored* boundaries only) |
| Business view | Flows + tour written by the agent | **Domain view**: domains → flows → steps, generated | Workflow / lifecycle / sequence diagrams |
| Change impact | Recent work (what the AI changed, why) | **/understand-diff**: affected nodes and risk via the LLM | **Architecture Delta**: before/after compare of authored JSON |
| Diagram types | one map (+ flows, boards) | graph, layers, domain graph, knowledge graph | **10**: architecture, workflow, sequence, dataflow, lifecycle, ERD, class, tree, timeline, waterfall + explainer pages |
| Ask questions | Ask bar → Claude Code / Codex CLI read-only, answer board | /understand-chat, /understand-explain, semantic search (optional embeddings) | "Answer as one page" explainer with cited, commit-pinned sources |
| Incremental updates | Fingerprints (`sig`) → only changed exports/routes re-described | Fingerprint + change classifier (SKIP/PARTIAL/ARCH/FULL), post-commit auto-update hook | Re-finalize one JSON; last-good preview |
| Output quality gates | build.mjs errors/warnings, tests | Graph reviewer agent + normalizer | **Schema + layout + route + label-clearance validators with machine-readable repair receipts**, atomic "last good" delivery |
| Sharing | One HTML, Export without Ask, artifact publish | Dashboard (React app), PNG/SVG/JSON export | One HTML, **PNG/WebP/JPG/SVG/WebM**, 1200×630 **share cards** for a route/reach |
| Audience | Non-technical owners first, dev toggle | **Persona-adaptive** (junior / PM / power user) | Communicators (docs, talks, reviews) |
| Languages of the UI | English | **7 locales** (`--language`) | **4 locales** |
| Platforms | Claude Code, Codex | **14+** (Cursor, Copilot, Gemini CLI, OpenCode, Cline, Kiro…) | Cursor, Claude Code, Codex, OpenCode + `llms.txt` install |
| Install footprint | 0 deps, no hooks, no network (except opt-in waitlist), checksummed | pnpm workspace, tree-sitter natives, React dashboard, **hooks that tell the agent to update without asking** | 0 runtime deps for the CLI; optional update check (network GET) |
| Cost | Scan free; descriptions cost tokens once, refresh cheap | **Heavy**: LLM per file batch (they warn about token use) | Cheap per diagram, but nothing is reusable as a model of the code |

## What each does better than us (and what we adopt)

### From Understand-Anything
1. **Change impact before you commit** (`/understand-diff`). We have the data to do it *without an LLM*: reverse imports +
   HTTP links + screens + Health. → **Adopt, deterministic** (`impact.mjs`, Milestone 2.5). Also the base of a PR-comment mode.
2. **Function-level call graph** (tree-sitter). Our maps stop at exports. → Adopt as a *lite* call graph for JS/TS/Python/Dart/
   Kotlin/Swift with regex over symbol ranges (zero-dep). Revisit vendored WASM tree-sitter only if precision demands it
   (it would add ~5–10 MB and widen the supply-chain test).
3. **Layers** (API / Service / Data / UI / Middleware) as an automatic second lens. → Adopt as a viewer filter computed in build
   from paths + node kinds; no tokens.
4. **Domain view** (business domains → flows → steps). → Adopt by extending architecture.json `flows` with `domain`, generated
   by the agent during first run; viewer groups flows by domain.
5. **Staleness banner** in the map (graph commit vs HEAD). → Adopt (we already compute it in status.mjs).
6. **Persona / locale**. → Locale: adopt (`--language`, descriptions + UI strings). Persona: we already have audience
   (everyone/developers); add a third "product" view only if users ask.
7. **More platforms** (Cursor, Copilot, Gemini CLI, OpenCode). → Adopt cheaply: the scripts are plain Node; add plugin manifests
   + docs. No hooks.
8. **Large-repo benchmark** with reproducible numbers. → Adopt (`tools/benchmark.mjs`: scan/build time, RSS, sizes).
   *Don't adopt:* SessionStart/PostToolUse hooks that instruct the agent to act "without asking" — it conflicts with our
   "nothing runs on its own" promise.

### From Archify
1. **Upstream / downstream reach and exact route tracing** in the viewer ("everything downstream of the payment service").
   → Adopt in the map (we have the edges): click → highlight reach, with honest wording ("imports and requests, not runtime").
2. **Share cards and image export** (PNG/SVG, 1200×630 card of a traced route). → Adopt PNG/SVG of the current view.
3. **Explainer pages**: an Ask answer as a shareable one-page HTML with commit-pinned source citations. → Adopt: "Save answer
   as page" from the Ask board, citations as `file:line@commit`.
4. **Validators with machine-readable repair receipts** (rule code, subject, supported fixes, bounded retries). → Adopt the
   pattern for architecture.json/plan.json: `build.mjs --json` emitting `{code, path, fix}` so agents repair deterministically.
5. **Architecture Delta** (before/after). → Adopt as `codemap diff <ref>`: map at a git ref vs now (added/removed parts,
   endpoints, links), reusing impact.mjs data.
6. **Extra diagram types** generated from what we already parse: **ERD** (SQL migrations / Prisma / Supabase), **sequence**
   (from a flow's steps), **class** (from symbols). → Adopt ERD and sequence first; they come almost free from our data.
7. **Trust boundaries** (public internet / server / database / third party) on the map. → Adopt as optional `boundary` on nodes,
   pre-filled from kinds (ui = client, service = server, external = third party).
   *Don't adopt:* the network update checker (we promise no network); 10 bespoke renderers (we keep one map + derived views).

## Where we stay ahead (protect these)
- Deterministic cross-repo request matching (web **and mobile**) — neither competitor does it.
- Screens as an entry point, now including Flutter/Compose/SwiftUI/UIKit.
- Health checks with ready fix prompts, tuned for precision.
- Zero dependencies, no hooks, checksummed release, local-only server.
- Cheap refresh: only changed exports/routes cost tokens.

## The "best ever" bar (product thesis)
One local, dependency-free map that answers four questions for any mix of web, backend and mobile codebases:
**How does it fit together?** (map, screens, flows, layers, domains) · **What's risky?** (Health) ·
**What did the AI just change, and what does it break?** (Recent work + deterministic impact + delta) ·
**How do I explain it?** (Ask → one-page explainer, share cards, ERD/sequence views), in the user's language,
from whichever coding agent they use.
