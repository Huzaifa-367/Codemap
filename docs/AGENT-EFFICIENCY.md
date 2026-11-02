# Codemap for coding agents: fewer tokens, faster work

Researched 2026-11-02. How the map is meant to be used by Claude Code, Codex and their subagents.

## The problem, measured by others
- Coding agents spend most of their budget **finding** code, not changing it. On SWE-bench Verified with Claude Sonnet 4.5,
  read operations (cat, grep, head) were **76.1%** of tokens (SWE-Pruner, arXiv 2601.16746). GPT-5.4 trajectories spent
  **56.2%** of tool turns and **46.5%** of tokens reading and searching (Microsoft FastContext, 2026).
- A 30B OpenHands agent averaged **631K tokens / 23 rounds** per resolved issue, dominated by grep, glob and view_file
  (CodeGrep, arXiv 2608.05886). A study of 8 frontier models averaged **4.17M tokens** per SWE-bench task.
- Fixes that work: a dedicated explorer that returns **file paths + line ranges** (FastContext: −26% tokens and +3 points
  on SWE-bench Multilingual, −50% on SWE-QA); budgeted exploration (−84–95% tokens for localization, arXiv 2608.29675);
  Aider's **repo map** (tree-sitter + PageRank, ~1K-token default budget) giving whole-repo awareness cheaply.

## Principles we follow
1. **Just-in-time, progressive disclosure** (Anthropic, "Effective context engineering"): a tiny always-loaded pointer
   (CLAUDE.local.md block, ~250 tokens), then cheap lookups returning identifiers (paths, line ranges), then the agent reads
   only those ranges. Skills already load in three tiers (name/description → SKILL.md → scripts).
2. **CLI over MCP for this job.** MCP clients load every tool definition up front; Anthropic measured one task drop from
   150,000 to 2,000 tokens (−98.7%) by exposing tools as code instead. Our lookups are plain `node codemap/query.mjs …`
   commands: zero schema cost until used, work in any agent with a shell, and keep our "no MCP servers" promise.
3. **Return the minimum effective dose**: compact text by default, `--json` when a program needs it, paths written once,
   and a reading budget (`--budget`).
4. **Structure is computed, not generated**: ranking, call graph, requests and impact cost 0 tokens. The agent spends tokens
   only on names/descriptions, once, cached by fingerprint.
5. **Honest staleness**: `context` marks files edited since the map was built, so agents re-check line numbers.

## What agents get
| Need | Command | Instead of |
|---|---|---|
| Start a task | `query.mjs context "<task>"` → ranked files + exact line ranges + callers, endpoints, screens, tests, Health | rounds of glob / grep / cat |
| Change a function safely | `query.mjs fn <name>` → location, callers, callees, endpoint it answers | grepping for callers |
| Orient a fresh session or subagent | `query.mjs map [--budget 1500]` → parts, central files, key functions (PageRank) | reading READMEs and folders |
| How does X work end to end | `trace.mjs "<screen / endpoint / fn>"` | reading every layer |
| What does my change break | `impact.mjs [--base main]` | guessing, or re-running everything |

How `context` ranks: words of the task (stemmed) are matched against file names, descriptions, paths, function names,
endpoint names and module summaries; those seeds spread through a personalized PageRank over imports, web requests and
function calls; files the task never names are kept only when one of their functions calls or is called by a matched one
(so a ubiquitous `Result` helper doesn't crowd out real code). Each file contributes its matched functions' line ranges,
or the whole file when it is small.

## Measured on a real app (Flutter's Compass sample: app + Dart server, 157 + 17 code files)
`context "create a booking for a destination"` → 10 files, line ranges totalling **~6K tokens** of code to read, versus
**~94K tokens** for the parts those files belong to (**~16× less**), plus a ~1.5K-token listing. It names the API client's
`postBooking`, both booking repositories, the use case, the view model's `_createBooking`, and the server's `POST /booking`.

## Benchmark (tools/bench-context.mjs, no LLM)
For every endpoint and screen of a built map, ask `context` in the words of its name and check the result.

| Codebase | Tasks | Right file returned | A calling file too | Reading asked for | vs the parts involved |
|---|---|---|---|---|---|
| Flutter Compass (app + Dart server) | 17 | 100% | 100% | ~4.3K tokens | 21× less |
| Compass + SwiftUI sample + Android Sunflower together | 21 | 86% | 100% | ~4.5K tokens | 27× less |

Run it on any project: `node tools/bench-context.mjs <root>` (after a build).

For real agent runs, `node tools/bench-agent.mjs <root> --tasks 8` asks Claude Code each question twice, exploring the
usual way and starting from the map, and reports tokens, tool calls, cost, time and whether it named the right file.
It uses your own Claude account.

### First real run (2026-11-02, Claude Sonnet, Codemap's own repo, 8 "which file…" questions)

| | without the map | with the map |
|---|---|---|
| right file named | 7 / 8 | **8 / 8** |
| tokens (incl. cache) | 3,125,080 | **1,739,961** (44% fewer) |
| tool calls | 23 | **9** (61% fewer) |
| cost | $2.09 | **$1.69** (19% less) |
| time | 94 s | **79 s** |

Small sample, one codebase; questions come from the map's own descriptions, so they favour finding a file by what it
does. Most with-map runs needed one call (`query.mjs context`). Lesson from the first try: passing the hint with
`--append-system-prompt` changed the cached system prompt, so every with-map run paid to write the cache again and
cost went *up* ($2.67 → $3.10) despite 42% fewer tokens. The hint now goes with the question, the way
`CLAUDE.local.md` reaches a real session, and the bench records cache-write tokens.

## Codex note
Codex reads `AGENTS.md`; an `AGENTS.override.md` in the same folder **replaces** it rather than adding to it, so Codemap
never writes either (it would hide the team's instructions). In Codex the skill's own description and SKILL.md carry the
"use the map before exploring" guidance instead.

## Next
- `query.mjs context --for-subagent`: a ready brief (task + ranges + constraints) to paste into a subagent.
- Measure end-to-end on public repos too (first run on Codemap itself is above).
- Port trace/impact into the self-contained `codemap/` helpers so later sessions can call them without the skill path.
