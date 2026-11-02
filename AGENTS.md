# AGENTS.md — working on this fork of Codemap

Read this first in every session. Upstream: https://github.com/Huzaifa-367/codemap (MIT).
Goal of the fork: fix the gaps found in the code review, and map **multiple codebases including mobile apps**
(Flutter, Android/Kotlin, iOS/Swift, React Native/Expo) alongside web apps and backends.

## Rules (from CONTRIBUTING.md, still binding)
- No dependencies, no install scripts. Plain Node 18+. `npm test` (= `node --test`) must stay green.
- Plain language in anything the map shows. Never store or print secret values.
- Detection is regex-based and approximate; precision beats recall for Health (false alarms cost more).
- Every detection fix gets a small sample in `tests/` that fails without the fix.
- User-visible changes get a line under `## Unreleased` in CHANGELOG.md. Don't bump the version
  (release.test.mjs ties version, README badge and CHECKSUMS.txt together).
- `supply-chain.test.mjs` pins what the plugin may do (programs spawned, network, allowed-tools): don't widen it.

## Where things live
- `skills/codemap/scripts/lib/extract.mjs` — per-language imports, symbols, routes, HTTP calls.
- `lib/resolve.mjs` — import → file. `lib/routes.mjs` — mounts, prefixes, call→route matching.
- `lib/screens.mjs` — screens (scan side `findScreens`, build side `buildScreens`).
- `lib/health.mjs` — per-file findings (`findIssues`) and issues (`buildHealth`).
- `lib/apps.mjs` — (fork) detects the apps in a codebase: mobile, web, backends.
- `scripts/scan.mjs` — glue: discover → extract → resolve → implicit refs → routes → scan.json + summary.

## Competitors
See docs/COMPETITIVE.md (Understand-Anything, Archify): what we adopt, what we refuse (hooks that act without asking,
network update checks), and where we must stay ahead (cross-repo request matching, screens, Health, zero deps).

## Agents using the map
See docs/AGENT-EFFICIENCY.md: research, principles (just-in-time context, CLI over MCP, budgets), and query.mjs
context / fn / map.

## Backups
Every milestone: commit, then `git bundle create codemap-fork.bundle --all` (plus a zip and a patch vs main)
delivered to the user. Nothing lives only in the working copy.

## Progress
See docs/ROADMAP.md (milestones, done criteria, status). Update it at every milestone.
