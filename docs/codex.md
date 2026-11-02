# Codemap in Codex

Codemap works in [Codex](https://developers.openai.com/codex) the same way it works in Claude Code: the same skill, scripts and map, on your own ChatGPT sign-in. There are no API keys to set up.

## What you need

- Codex: the desktop app or the CLI, signed in with your ChatGPT account.
- [Node.js](https://nodejs.org) 18 or newer.

## Install

**In the Codex app** (no terminal needed):

1. Open **Plugins** and choose **Add a marketplace**.
2. For **Source**, enter `Huzaifa-367/codemap`. Leave **Git ref** empty, and click **Add marketplace**.
3. Find **Codemap** in the list and click **+** to install it.
4. Start a new chat.

**From a terminal**, with the [Codex CLI](https://developers.openai.com/codex/cli):

```bash
codex plugin marketplace add Huzaifa-367/codemap
codex plugin add codemap@codemap
```

The app and the CLI share their plugins, so installing in one makes Codemap available in both.

## Make your first map

Open your project in Codex and ask in plain words:

> Draw a codemap of this codebase

To call the skill by name, type `$codemap`. Everything after that is the same as in Claude Code ([Getting started](getting-started.md#make-your-first-map)): Codex scans the code, describes every part, file and web request, builds the map and opens it. Later, "update the codemap" re-reads only what changed.

When Codex opens the map, it asks to run the map's server outside its sandbox. The server has to keep running after the command ends, and the Ask bar needs to reach Codex. If you'd rather not allow it, run the server yourself from the project folder:

```bash
node codemap/serve.mjs
```

## Asking questions on the map

The map's Ask bar runs your own Codex on your computer: `codex exec` in Codex's **read-only** sandbox, in your project folder, with your ChatGPT sign-in. It reads the map and your source to answer, and can't change any files. These runs aren't saved to your Codex history; a follow-up question brings the last few questions and answers along instead.

The server uses whichever agent built the map, and falls back to the other one if that one isn't installed. To choose:

```bash
node codemap/serve.mjs --engine codex
```

It finds `codex` on your PATH, and on Windows the CLI that comes with the Codex desktop app. If yours is somewhere else, pass `--codex /path/to/codex`. `--model <name>` picks the model; otherwise your Codex settings decide.

## What's different from Claude Code

- **No notes file.** In Claude Code, Codemap can keep a short note in `CLAUDE.local.md` (personal and never committed, and only if you say yes) that points future sessions at the map. Codex has no personal, uncommitted equivalent (`AGENTS.md` is shared with your team), so in Codex Codemap leaves your project's notes alone.
- **No Claude app.** Publishing the map to the Claude app is a Claude feature. In Codex the map opens in your browser, served from your computer.
- **"Fix with Codex".** The Health panel's ready-made fix prompts are for pasting into Codex. On a [blueprint](getting-started.md#plan-something-you-havent-built-yet), the same goes for **Build this with Codex**, and the Ask bar's **Change** switch runs Codex in its read-only sandbox too: Codex replies with the updated plan, and the map's server saves it.

## Update or remove it

In the app, open **Plugins**, find the Codemap marketplace and choose **Upgrade** to get the latest version, or **Remove marketplace** to take it out. From a terminal:

```bash
codex plugin marketplace upgrade codemap
codex plugin add codemap@codemap
```

```bash
codex plugin remove codemap@codemap
codex plugin marketplace remove codemap
```

Your maps stay in each project's `codemap/` folder until you delete them.

## Trying a working copy

Point Codex at your local clone instead of GitHub:

```bash
codex plugin marketplace add /path/to/codemap
codex plugin add codemap@codemap
```

Codex copies a local plugin into its cache when you add it (unlike Claude Code, which runs a local plugin straight from the folder). After you change the plugin, run `codex plugin add codemap@codemap` again and start a new session.
