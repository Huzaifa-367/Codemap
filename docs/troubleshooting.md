# Troubleshooting

### The Ask bar says it needs the Claude Code CLI
The map is open without a way to ask questions. Either:
- install the [Claude Code CLI](https://code.claude.com/docs/en/overview), sign in, then ask Claude to update the codemap or run `node codemap/serve.mjs`;
- or open the map in the Claude app: ask Claude to "publish my codemap to the Claude app". Answers there come from the map only.

### The CLI is installed but isn't found
`serve.mjs` looks for `claude` on your PATH and in `~/.local/bin`. If it lives somewhere else:

```bash
node codemap/serve.mjs --claude /path/to/claude
```

### Codex: the Ask bar says it needs Codex
The map's server looks for `codex` on your PATH and, on Windows, for the CLI that comes with the Codex desktop app. Install the [Codex CLI](https://developers.openai.com/codex/cli), or point the server at yours:

```bash
node codemap/serve.mjs --codex /path/to/codex
```

If it says Codex isn't signed in, open the Codex app (or run `codex login`) and sign in with ChatGPT. More in [Codemap in Codex](codex.md).

### Codex: the map didn't open, or Ask stopped working after Codex opened it
Codex runs commands in a sandbox, and the map's server needs to keep running and reach the network. Allow the server to run outside the sandbox when Codex asks, or run `node codemap/serve.mjs` yourself from the project folder.

### `node` isn't recognized
Install [Node.js](https://nodejs.org) 18 or newer, then start a new session so Claude Code or Codex picks it up.

### Claude or Codex keeps asking to run `node` scripts
In Claude Code, Codemap pre-approves its own scripts while it's running, but it may still ask in some setups. Choose the option to always allow them for this project. Codex asks according to your approval settings; allowing Codemap's `node` scripts for the project stops the prompts.

### The skill doesn't show up
Plugins load when a session starts, so start a new one after installing. Check that it's installed and enabled:

```bash
claude plugin list
```

Plain requests like "make me a codemap" work without the slash command. If you do want it, it's `/codemap:codemap`.

In Codex, check **Plugins** in the app, or run `codex plugin list`, and start a new chat after installing. To call it by name, type `$codemap`.

### The map looks out of date
Ask Claude or Codex to "update the codemap". If a tab was already open, it reloads itself once the update finishes.

### The map is blank, or stuck on "Laying out"
Maps made before version 0.1.3 load their layout engine from the internet, so check your connection or any content blocker, or ask Claude to "update the codemap". Newer maps have everything built in and work offline.

### The Ask bar has no Change switch
**Change** appears only on a [blueprint](getting-started.md#plan-something-you-havent-built-yet), opened through its server (`node codemap/serve.mjs`) with the Claude Code CLI or Codex available. A map of real code doesn't have it: ask Claude Code or Codex to change the code, then update the codemap.

### A change to a blueprint failed, or I don't like it
If the updated plan doesn't pass Codemap's checks after a second try, nothing is saved and the map stays as it was; try asking more specifically. If a change went through but isn't what you wanted, press **Undo** in its summary, or ask for another change. The previous versions are kept in `codemap/.cache/history/`.

### A connection is missing
Codemap finds most web requests and imports by reading the code, but not all of them, for example requests to an address that only exists in settings. Ask Claude to add the missing connection to the codemap; it records it in `architecture.json` and it stays on every update.

### A file is in the wrong part, or under "Unassigned"
Ask Claude to move it, or edit the `paths` patterns in `codemap/architecture.json` and ask for an update.

### "codemap/ already exists here and isn't a map"
Your project has its own folder called `codemap`, which Codemap won't write into. Rename your folder, or ask Claude to build the map somewhere else; the scan and build scripts accept `--out <folder>`.

### `git status` shows files under `codemap/`
They were committed before Codemap started ignoring the folder. Untrack them, keeping the files on disk:

```bash
git rm -r --cached codemap
```

### Port 4378 is in use
Nothing to do. The server moves to the next free port, and the URL it prints, or that Claude gives you, is the right one.

### Stopping the background server

```bash
node codemap/serve.mjs --stop
```

It also stops by itself two hours after the last tab closes.

### Still stuck?
[Open an issue](https://github.com/Huzaifa-367/codemap/issues/new/choose) with what you asked, what happened, whether you used Claude Code or Codex, and the output it showed. Please leave out anything private from your code.
