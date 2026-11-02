# Changelog

## Unreleased

- **Next.js endpoints, more exact.** Only a file named `route.ts` (or .js/.tsx/.jsx) under `app/` is an endpoint, so files like `_route.ts` no longer show up as one, and handlers re-exported as `export { handler as GET, handler as POST }` (the usual NextAuth setup) show their real methods instead of "ANY".

## 1.0.2 (2026-11-02)

- **Fairer agent benchmark.** `tools/bench-agent.mjs` gives the map hint with the question (as `CLAUDE.local.md` does) instead of in the system prompt, which made every run rewrite the prompt cache, and reports cache-write tokens. First numbers: right file 7 → 8 of 8, 44% fewer tokens, 61% fewer tool calls, 19% lower cost.
- **Fewer made-up screens.** A TanStack route that only appears in a comment (for example a doc example) is no longer shown as a screen.
- **Function cards say where they live.** On boards, each function card is wider and shows its file and line (for example `service.js · L2`).
- **Tracing a whole file is easier to read.** It starts at the functions where the file's work begins (the ones nothing else in the file calls, those that reach other files, requests or tables first), at most six, and names the rest so you can trace them one at a time (`file#name`).
- **Save → The whole board as an image (PNG).** Every card at full size and full detail, whatever the zoom. The SVG export now keeps the map's font and theme when opened on its own.

## 1.0.1 (2026-11-02)

- **Function-level flows you can see straight away.** Every map now comes with flows traced function by function (no tokens): from the main screens and the endpoints other code calls most, through each function, the request and the server's handler, down to the data. Open **Flows → Step by step: …** and the flow appears as a board of function cards with an arrow for every call and request it followed; the side panel walks through it in order.
- **Trace the flow** (from any file or endpoint's **Follow it**) draws the same function-level board, with only the calls the trace followed, so it reads left to right instead of as a web.

## 1.0.0 (2026-11-02)

**Floorplan is now Codemap.**

- **New name.** The plugin, the skill and the map are now **Codemap**: say "make a codemap" or "update the codemap". The map lives in `codemap/` in each project.
- **Nothing to redo.** A map made before the rename (`floorplan/`) moves to `codemap/` on the next scan, build or update, and the old note in `CLAUDE.local.md` is replaced by the new one.
- Settings and environment variables are now `CODEMAP_…` (for example `CODEMAP_CLAUDE`, `CODEMAP_NO_PROMPTS`), and the map's script API is `window.Codemap`.
- No cloud waitlist address ships with Codemap: nothing leaves your computer unless you set `CODEMAP_WAITLIST_URL` yourself.
- Credit: Codemap started as a fork of [Floorplan](https://github.com/haydenschmitty/floorplan) by Hayden Smith (MIT). Earlier entries below keep the original name.

## 0.9.1 (2026-11-02)

- **The map's buttons come translated** for Spanish, French, German, Portuguese, Chinese, Japanese, Hindi, Urdu and Arabic (the 116 most visible words), with no agent run; the agent's `ui-strings.json` still adds the rest or overrides any word.
- Arabic and Urdu (and Persian, Hebrew) maps read right to left; code, paths and the map itself stay left to right.
- The list of the map's words leaves out code fragments, fonts and product names.
- In a file's view, the "Inside …" bracket no longer overlaps "Used by" when a card with no outside links sits on the left.
- README: the comparison with Archify and Understand Anything reflects what Floorplan does now.
- Checked on 4,800 files: scan 3.6 s, build 0.5 s, `context` 0.2 s.

## 0.9.0 (2026-11-02)

- **Every function on the map.** With "Show technical detail" on, a file opens into all of its functions as cards, with arrows for the calls between them, the calls coming in from other files and the calls and requests going out. **Follow it → Functions on the map** goes straight there.
- **The map's own buttons in your language.** With `"language"` set, the build lists the map's words once (`floorplan/.cache/ui-strings.en.json`); the translation in `floorplan/ui-strings.json` is swapped in everywhere, including labels that change later.
- **Share cards:** Save → *This board as a picture* draws a 1200×630 PNG of a flow or answer.
- **Imports through aliases:** Vite, webpack, Vue, Svelte and Astro aliases, the common `@/` and `~/` conventions, tsconfig `extends` lists and shared tsconfig packages, `package.json` `#imports`, and workspace packages' `exports` maps (built paths mapped back to source). Two real projects (a Vite app and a Next.js app) now resolve every import.
- **Two services with the same endpoint** (both have `GET /health`) keep their own descriptions: the key becomes `GET /health @ billing/server.js` only when it's shared, and existing descriptions keep working. An empty placeholder entry never hides a written description.
- **Fastify's object form** (`fastify.route({ method, url })`) and **Kotlin Multiplatform** (the iOS app is linked to the shared Kotlin classes it uses).
- **Trace boards** show each card once, with every role it plays.
- **For maintainers:** `tools/bench-agent.mjs` runs the same questions through Claude Code with and without the map (tokens, tool calls, cost, time, right file); `tools/visual-check.cjs` walks the new panels in a real browser (needs Playwright, not part of Floorplan).

## 0.8.0 (2026-11-02)

- **The data model on the map.** Tables come from SQL migrations and Prisma schemas, with their columns, keys and references; the code that reads or writes each table is found (Supabase `.from()`, Prisma, SQL in strings). Traced flows now end at the table they touch ("writes table orders"), and `query.mjs erd` draws the database as a diagram.
- **Functions map:** any file's functions as boxes, with the functions elsewhere that call them and that they call, from **Follow it**.
- **Calls through interfaces** reach every implementation (a `PaymentGateway.charge()` call reaches Stripe's and PayPal's), and interface and abstract methods count as functions.
- **Lenses:** **Layers** (screens, endpoints, business logic, data, shared helpers…), **Domains** (flows grouped by business area), and **Save**: the board on screen as a one-page HTML to send, or the view as an SVG image. Each top-level part knows who runs it (client, server, data store, third party).
- **What changed since the last map:** every update keeps the previous map; `query.mjs delta` lists new and removed parts, connections between parts, endpoints, screens and tables.
- **The map says when it's behind the code** (commits since it was made, uncommitted changes), with the words to update it.
- **More frameworks:** Laravel route files (groups, resources, the `/api` prefix), Rails `routes.rb` (namespaces, nested and limited resources), ASP.NET attribute routing and minimal API groups, chi's nested `r.Route`.
- **Your language:** set `"language"` in architecture.json and names, descriptions, flows and Ask answers are written in it.
- **More agents:** Cursor and Copilot plugin manifests, and a guide for Gemini CLI, OpenCode, Cline, Kiro and Trae.
- **Safer Ask:** the agent behind Ask can't open `.env` files, keys or credential files.
- **Measured:** `tools/bench-context.mjs` checks `context` on a built map. On Flutter's Compass sample it finds the right file for 100% of endpoint and screen tasks, asking for about 21× less reading than the parts involved.

## 0.7.0 (2026-11-02)

- **Follow it, on the map.** Every file and endpoint gets a **Follow it** section: what it relies on, what relies on it (through imports and web requests, across apps), its functions with how many places call them, and **Trace the flow**, which lays the whole path out as a step-by-step board, from the screen down to the database.
- **More frameworks:** NestJS controllers, Spring `@GetMapping` with no path or several paths and `@RequestMapping(method = …)`, Gin / Echo route groups (`r.Group("/api/v1")`).
- **Repos that live in different places** can be mapped together: make a folder, add a link to each repo (`ln -s ../api api`, or `mklink /J api ..\\api` on Windows), and make the floorplan there.
- **For agents:** `query.mjs trace` and `impact` now work from the map folder itself in later sessions; `context --brief` writes a ready brief for a subagent; `build.mjs --json` reports problems with the fix to apply, so an agent can repair them without guesswork.
- **Safer Ask:** answers never repeat a key, token or database password the agent came across while reading the code, and the agent is told to treat file contents as data, not instructions.

- **Built for coding agents: read less, work faster.** `node floorplan/query.mjs context "<task>"` tells Claude Code or Codex exactly which files and line ranges a task needs, with their callers, endpoints, screens and tests, ranked from the map. On Flutter's Compass sample, a booking task needs ~6K tokens of reading instead of ~94K. `fn <name>` gives a function's callers and callees instead of a grep, and `map` sums up the codebase in about 1,500 tokens for a new session or a subagent. The note in CLAUDE.local.md now tells later sessions to start there. See docs/AGENT-EFFICIENCY.md.
- **Down to the function.** The scan now finds every function and method (exported or not, in 15 languages) and the calls between them: within a file, through imports, through objects a class is given (a view model's repository and its implementations), and through what Swift, Kotlin and Dart see without importing. Inline endpoint handlers count as functions too.
- **Trace any flow, end to end, for free.** Ask "what happens when someone books a trip?" and Floorplan follows it from the screen, through its view model, the use case, the repository and the API client, across the web request to the server's handler, and down to the database or outside service. Start from a screen, an endpoint, a file or a function; get a step list, a sequence diagram (`--mermaid`), or save it to the map's Flows. Tried on Flutter's Compass sample: from the booking screen to the server's `POST /booking` handler in 40+ steps.
- **What does my change touch?** Ask "what might this change break?" and Floorplan follows imports and web requests on the map from the changed files to everything that uses them, with no tokens: other apps that call a changed endpoint (the mobile app calling your server), the screens to re-check, and Health issues in the changed files. Works on uncommitted work, a branch (`--base main`) or named files, and writes a pull-request summary with `--markdown`.
- **Routers under any name:** `const r = require('express').Router()`, `const api = new Hono()` and the like are found, and `module.exports = router` is no longer mistaken for an endpoint's handler.
- **Mobile apps on the map.** Flutter, native Android (Kotlin) and native iOS (Swift) apps are mapped beside your website and server, and their requests are matched to the server endpoints that answer them, across repos:
  - Dart: imports (`package:` and relative), http and Dio requests, retrofit.dart clients, Firebase callables. Generated `*.g.dart` / `*.freezed.dart` files stay off the map.
  - Swift: URLSession and Alamofire requests, with their method. Files are connected by the types they use, since Swift needs no imports within an app.
  - Kotlin: Retrofit clients, Ktor and OkHttp requests, Firebase callables, and connections between files of one package.
- **Dart servers:** shelf_router endpoints (with their `mount` prefixes) and dart_frog file routes, so a Flutter app and its Dart backend connect.
- **Screens in mobile apps:** go_router (nested and typed routes), auto_route, Flutter route tables, Jetpack Compose navigation, Android activities and navigation graphs, SwiftUI navigation and tabs, and UIKit view controllers. Routes named by constants kept in another file (`GoRoute(path: Routes.login)`, `composable(Screen.Home.route)`) are filled in.
- **The scan lists the apps it finds** (mobile apps, websites, servers), so each gets its own part of the map, including a Flutter app's Android, iOS and macOS shells. A server is named by its own project folder.
- **Health for mobile apps:** unencrypted connections allowed for every server (Android cleartext traffic, iOS App Transport Security off), a debuggable Android build, and mobile code pointing at `localhost` or the emulator's `10.0.2.2`. Debug-only settings are left alone.
- **Fixed:** middleware passed before a `require()`d router (`app.use('/admin', requireAuth, require('./admin'))`) was dropped, so its endpoints were reported as open to anyone.
- **Fixed:** Go 1.22 patterns such as `HandleFunc("POST /items/{id}", h)` were not found as endpoints.
- **Fixed:** a flag such as `--include-worktrees` took the folder after it as its value, so the wrong folder was scanned.

## 0.6.1 (2026-11-01)

- **Fewer false alarms in Health** (thanks to the user who reported these):
  - **A password hash isn't the password:** bcrypt, argon2 and similar hashes are no longer reported as passwords, and neither is anything under a name like `ADMIN_PASSWORD_HASH`, including browser variables such as `VITE_ADMIN_PASSWORD_HASH`. The secret that makes a hash (`HASH_SECRET`) is still flagged, and so is a real key format under any name.
  - **An encrypted backup isn't an exposed one:** encrypted values in a `.env` file are left alone (dotenvx, sops, Ansible Vault, AWS KMS, HashiCorp Vault, age, PGP, OpenSSL and Fernet), and so are passphrase-protected private keys. A value left unencrypted next to them is still flagged.
- **Mark an issue "Not a problem":** a new button on each Health issue, with an optional reason. The issue moves to the bottom of the list and out of the count, and stays there when the map is rebuilt. It shows again if the same check finds something new in that file or the issue changes severity, and **Show again** undoes it. Your choices are saved in `floorplan/health-dismissed.json`. Exported copies keep the issue set apart but leave your reason out.
- **Report a false alarm if you like:** a box in the same dialog opens a GitHub issue for you to read, edit and send yourself, with a preview of exactly what it says. It never includes your code or any values, and nothing is sent unless you send it.

## 0.6.0 (2026-10-31)

- **Health catches the classic mistakes in AI-built apps.** Five new checks, each in plain words with a fix to paste:
  - **Secret keys sent to the browser:** an OpenAI, Stripe or Supabase service-role key (and others) in a `NEXT_PUBLIC_`, `VITE_`, `REACT_APP_` or similar variable, which every visitor can read. Keys that are public by design, like Supabase's anon key or Stripe's publishable key, are left alone.
  - **Supabase tables anyone can read and change:** tables whose row-level security is never switched on (or is switched off), worked out by replaying the migrations in order, so a table locked later or dropped doesn't count. Policies that let anyone add, change or delete rows are flagged too, as worth a look.
  - **Firebase rules that let anyone in:** Firestore, Storage and Realtime Database rules open to anyone, including "test mode" rules, with the date they stop working (or stopped).
  - **Stripe webhooks anyone could fake:** code that acts on events like `checkout.session.completed` without checking Stripe's signature, so anyone could send a fake "payment succeeded".
  - **Servers that let any website call them (CORS):** a small note on its own, and worth fixing when login cookies are allowed along with it.
- **No more false alarm on Supabase's `config.toml`:** values like `"env(S3_SECRET_KEY)"` read a setting from the environment, so they're no longer reported as a key written into the code.

## 0.5.0 (2026-10-31)

- **Fits phones and tablets:** the top bar wraps instead of running off the screen, the details open as a sheet at the bottom of a phone (tap a box to see them), the long description under the title folds to a line with More / Less, and every control is at least 44 px to tap. Nothing changes with a mouse at 1000 px and wider. Requested in #18 and built by @menachem-kurkus in #19.
- **Touch gestures on the map:** dragging or pinching on a phone or tablet made the map jump to unexpected places. A drag now follows only the finger that started it and ends when the browser takes over the touch (before, the drag stayed switched on and followed any later movement); a second finger starts a pinch instead of restarting the drag, and a third finger is ignored; two fingers zoom around the point between them and moving both pans; the first tap after a drag is no longer swallowed; and the browser no longer zooms or bounces the page under the map, or re-fits the map when a phone's address bar slides in and out. A mouse, a trackpad and the wheel work exactly as before. Built by @menachem-kurkus in #24.
- **No hover tooltip after a tap:** a tap also sends the browser's hover event, so a card's tooltip popped up over the details sheet. Tooltips now show only for a mouse, and a tooltip stays inside a narrow window.

## 0.4.4 (2026-10-31)

- **The note for future sessions is now your choice:** in Claude Code, Floorplan no longer adds its section to `CLAUDE.local.md` on its own. After your first map, Claude asks whether future sessions in the project should use it, and adds the note only if you say yes. A note you already have is kept up to date; delete it to remove it.
- **Pre-approved commands named one by one:** the skill now lists each of its eight scripts by name, instead of approving anything in its scripts folder.

## 0.4.3 (2026-10-31)

- **Links for the Claude plugin directory:** the Claude Code manifest now points to the documentation, the privacy and security page, and GitHub issues for support, so a directory listing shows the right links. Nothing else changed.

## 0.4.2 (2026-10-30)

- **Is it safe to install?** A new page lists everything Floorplan does on your computer: no hooks, MCP servers, dependencies or downloads, its one outbound request, and every program it runs. A test enforces it on every change, and each release now includes `CHECKSUMS.txt`, so you can confirm your installed copy matches it (`node tools/checksums.mjs --check <folder>`).
- **Checked by GitHub's code scanner:** CodeQL now scans every change. Its first scan found six spots to tighten, all fixed: complete escaping in three places, the "Made with Floorplan" link built without reusing page text as HTML, and plain error messages on the map when Undo or Export fails, with the details in the map server's output.

## 0.4.1 (2026-10-30)

- **Exported copies say where they came from:** a small "Made with Floorplan" link at the bottom of an exported map leads to the project, so whoever receives one can make their own.

## 0.4.0 (2026-10-30)

- **Export a copy to share:** the map's new **Export** button saves one HTML file anyone can open in a browser, with nothing to install. It has the whole map without the Ask bar, your folder path or git remotes. Flows and notes go in by default; recent work and the health check (or a blueprint's design review) only if you tick them. Ask Claude or Codex to "export the floorplan", or run `node floorplan/serve.mjs --export`.

## 0.3.2 (2026-10-30)

- **The map's server answers only to this computer's own addresses:** it refuses requests under any other host name, so a website that points its domain at 127.0.0.1 (DNS rebinding) can't load the map, read its token and ask questions about your code.

## 0.3.1 (2026-10-30)

- **Asking on a map works again on Windows with the current Claude Code install:** the map's server found only the shell shim of an npm install and failed with `spawn ...\claude ENOENT`; it now finds the real `claude.exe` inside the package. Reported and fixed by @menachem-kurkus in #20 and #21.
- **Fewer false Health alarms on FastAPI:** a check added where a router is included, like `app.include_router(admin.router, dependencies=[Depends(require_admin)])`, now protects every endpoint of that router, as `app.use('/admin', requireStaff, adminRouter)` already did on Express. A database session added there still doesn't count as a sign-in check. Fixed by @stevensiht in #15.
- **FastAPI routers found by the name they're imported under:** a router imported under another name (`from app.routes import campaigns as campaign_routes`) gets its prefix and its checks, and a package that shares a router's name (`from app.platform import pricing` beside a `platform` router) is no longer mistaken for it. Fixed by @stevensiht in #15.
- **No more false alarm for analytics and map tokens:** Health no longer calls Cloudflare Web Analytics' beacon token or a Mapbox public token (`pk.…`) a leaked secret. Both are public by design: the page has to send them for analytics or maps to work. Reported by @CplSyx in #23.
- **Big files no longer vanish from the map:** files up to 2 MB are now read in full (up from 512 KB). A file over the limit still appears with its line count, the scan lists it, Health includes it among the very large files, and its card says its connections and secrets weren't checked. Reported by @Rasherb69 in #16.

## 0.3.0 (2026-10-29)

- **Blueprints: plan it before you build it.** Floorplan still maps the code you have; now it can also start from no code at all. Share a PRD, a spec or a description of something you want to build, and Floorplan draws the map of what it would take: every part, file, endpoint and screen, how they connect, and the outside services they rely on. It's marked as planned (dashed cards and a **Blueprint** label), Health becomes a design review of the plan (endpoints anyone could use, decisions the PRD leaves open, loose ends), and each part has **Build this with Claude** (or Codex), a ready request to build it as planned. Switch the Ask bar to **Change** to shape the plan from the map ("also plan out refunds"): the map redraws with the new and changed pieces highlighted, and **Undo** puts it back. Design review items can be settled the same way with **Resolve on the map**: an open question just needs your answer. Once the code exists, the map can switch to the real code.
- **Bracketed folder names** like Next.js' `[id]` and `[...slug]` can be written as they are in `architecture.json` path patterns; they match that folder exactly.

## 0.2.2 (2026-10-28)

- **Light mode:** a new **Theme** button in the top bar cycles **Auto → Light → Dark**. Auto follows your device's light or dark setting and changes with it. Your choice is remembered on this device, and the map shows the right colours from the first moment, with no flash. The button is a 44 px target, works from the keyboard with a visible focus ring, and the change is instant (nothing animates, so Reduce Motion is respected). Dark looks exactly as before. Requested in #9 and built by @menachem-kurkus in #10.

## 0.2.1 (2026-10-28)

- **Firebase Cloud Functions:** callable (`onCall`) and `onRequest` functions now show up as endpoints, named the way your functions entry file exports them, and the website's `httpsCallable` calls and requests reach them, including through a helper of your own that wraps `httpsCallable`. So a React + Firebase app's website and server are connected on the map, Screens shows the server code behind each page, and Ask can follow the links. Callables are shown as `CALL /name`. Reported by @omardlr-aviv in #8.
- **Health on Firebase:** callable and `onRequest` functions with no sign-in check (`request.auth`, `context.auth`, App Check or a verified ID token) are flagged like any other endpoint anyone can call.
- **Background functions:** scheduled functions and Firestore, Storage, Pub/Sub and Auth triggers are listed for the AI, which places them in the map's background-job parts.

## 0.2.0 (2026-10-28)

- **Works in Codex:** Floorplan is now a Codex plugin too, with the same skill, map and Health check, on your ChatGPT sign-in and with no API keys. Install it from the Codex app with no terminal: **Plugins → Add a marketplace →** `haydenschmitty/floorplan`, then install Floorplan. See [Floorplan in Codex](docs/codex.md).
- **Ask through Codex:** in a map made with Codex, the Ask bar runs your own Codex on your computer, in its read-only sandbox, and these runs stay out of your Codex history. Follow-up questions keep the conversation. The map's server uses whichever agent made the map, and falls back to the other one if only that one is installed (`--engine claude|codex` picks one).
- **Says who it's working with:** the Ask bar, the Health panel's "Fix with Claude" or "Fix with Codex" prompts, and request-a-flow all name the agent that made the map. In Codex, Floorplan leaves your project's notes alone (there's no Codex equivalent of the personal `CLAUDE.local.md`).
- **Docs** cover both apps throughout, with a new [Floorplan in Codex](docs/codex.md) guide.

## 0.1.5 (2026-10-28)

- **Fewer false Health alarms on FastAPI:** a dependency shortcut whose own name says it checks the caller, like `AdminAccess = Annotated[dict, Depends(check)]`, now counts as a login check even when its function has a plain name.
- **More accurate Health on FastAPI:** more database session helpers (`get_sql_session`, `SessionLocal`, engine, connection and unit-of-work helpers) are recognised, so an endpoint that only has one of them is flagged instead of passing as protected. Both by @PaulMagos in #6.
- **Map server hardening:** the map's local server no longer serves files from a neighbouring folder whose name starts with "floorplan" (like `floorplan-old/`), and a malformed web address now gets an error instead of stopping the server. Both were found by the new tests.
- **Tests:** a test suite now covers how code is read, Health, a whole map of a sample two-repo app, the privacy promises (offline map, no secret values written anywhere) and the map server's security checks. It runs on every push and pull request on Linux and Windows, and weekly on macOS. Run it with `npm test`.

## 0.1.4 (2026-10-28)

- **Safari fix:** cards now show up in Safari (and every browser on iPhone/iPad). Before, only the connection lines were drawn and card text appeared in the top-left corner. Reported by @fpv001 in #1, fixed by @PaulMagos in #3.
- **Fewer false Health alarms on FastAPI:** endpoints protected through a shared dependency shortcut, like `user: AdminUser` where `AdminUser = Annotated[..., Depends(...)]`, are no longer reported as open to anyone. That includes shortcuts defined in another file, and shortcuts built on other shortcuts. A database session dependency (`SessionDep`, `get_db`) no longer counts as a login check, so endpoints that only have one are flagged as they should be. Reported by @PaulMagos in #4.

## 0.1.3 (2026-10-28)

- **Works offline, no outside requests:** the map's layout engine (elkjs) and fonts are now bundled into it instead of loaded from jsDelivr and Google Fonts. Maps get this on their next update.
- The waitlist service's code is no longer part of the plugin download. It stays readable in the repo's history, linked from [Privacy and security](docs/privacy-and-security.md#floorplan-cloud-waitlist).

## 0.1.2 (2026-10-27)

- **Floorplan Cloud waitlist:** once a map has been open for two minutes, a corner card asks, once, whether you'd like an email when Floorplan Cloud (shared, synced team maps) launches. Nothing is sent unless you click **Notify me**, and then only your email and "just me" or "with my team". **Use my Claude email** fills in your Claude account's address, and you see it before anything is sent. **Don't ask again**, or `FLOORPLAN_NO_PROMPTS=1`, turns it off. See [Privacy and security](docs/privacy-and-security.md#floorplan-cloud-waitlist).
- The waitlist service's code is in `services/waitlist/`: rate-limited per IP address and overall, write-only, and capped.

## 0.1.1 (2026-10-27)

- **More connections found:** requests made through small helpers imported from an API client, like `post("/orders", …)` in a Python job, are now matched to the endpoints they reach.
- **Fewer false Health alarms:**
  - Express routers protected where they're mounted (`app.use('/admin', requireStaff, adminRouter)`), including routers nested inside them, are no longer reported as open to anyone.
  - Newsletter, contact and waitlist sign-ups are treated as public on purpose.
- **Flows:** the page heading fades out while a flow plays, so the flow bar no longer overlaps it.
- **Screens:** a screen's board is labelled "Screen" instead of "Answer".
- **README:** screenshots, from a demo app mapped end to end.

## 0.1.0 (2026-10-27)

First release.

- **The map:** an interactive node graph of a codebase, from the whole app down to single files and endpoints. Every part has a plain-English name and description. It works across several repos side by side.
- **Connections:** imports, and web requests matched to the server endpoints they reach, including URLs built in variables, nested template strings and small request helpers. Flask blueprint and Express router prefixes are resolved, nested mounts included.
- **Screens:** detects an app's pages (Next.js, React Router, Vue, SvelteKit, Remix, Nuxt, Astro, Expo, Angular, TanStack) and shows everything behind each one.
- **Health check:** passwords and keys in code, endpoints anyone can use without signing in, unused files and very large files, each with a ready-made fix prompt. Secret values are never stored.
- **Ask:** questions answered as a mini-map with a walkthrough, through the Claude Code CLI or the Claude app.
- **Flows:** guided walkthroughs, plus "Request a new flow".
- **Start here** tour, plain-language glossary and a "Show technical detail" switch.
- **Recent work:** the cards Claude just changed are highlighted, each with a note tying the change to what was asked.
- **Updates:** refreshes re-read only what changed, and an open map reloads itself.
- **Git:** nothing Floorplan creates is committed. The map folder ignores itself, and Claude's notes go in `CLAUDE.local.md`.
