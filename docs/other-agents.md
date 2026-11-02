# Codemap in other coding agents

Codemap is one skill (`skills/codemap/`) plus plain Node scripts, so any agent that loads Agent Skills can run it.
Claude Code and Codex install it as a plugin (see [Getting started](getting-started.md) and [Codex](codex.md)).
For the others, clone this repository once and link the skill folder where that agent looks for skills.
Nothing here downloads or runs anything on its own; a link is the whole install.

```bash
git clone https://github.com/<you>/codemap ~/codemap
```

| Agent | Where skills live | Command |
|---|---|---|
| Cursor | discovered from `.cursor-plugin/plugin.json` when the repo is opened, or Settings → Plugins | open the clone in Cursor once, or add it from the Plugins search |
| VS Code + GitHub Copilot (1.108+) | `.copilot-plugin/plugin.json`, or `~/.copilot/skills` | `ln -s ~/codemap/skills/codemap ~/.copilot/skills/codemap` |
| Gemini CLI, OpenCode, Pi | `~/.agents/skills` | `ln -s ~/codemap/skills/codemap ~/.agents/skills/codemap` |
| Cline | `~/.cline/skills` | `ln -s ~/codemap/skills/codemap ~/.cline/skills/codemap` |
| Kiro | `~/.kiro/skills` | `ln -s ~/codemap/skills/codemap ~/.kiro/skills/codemap` |
| Trae | `~/.trae/skills` | `ln -s ~/codemap/skills/codemap ~/.trae/skills/codemap` |
| Anything else with a shell | — | ask it to read `~/codemap/skills/codemap/SKILL.md` and follow it |

On Windows use `mklink /J <target> %USERPROFILE%\codemap\skills\codemap` in place of `ln -s`.
Update with `git -C ~/codemap pull`; the link keeps pointing at the new version.

What works everywhere: the map, Health, screens, flows, `trace`, `impact`, and `node codemap/query.mjs context | fn | map | erd`,
which is how any agent saves tokens on later tasks. The map's **Ask** bar answers through the Claude Code CLI or Codex
when one of them is installed; without either, the map still works and Ask explains what it needs.
In agents where `${CLAUDE_SKILL_DIR}` isn't filled in, it means the folder holding SKILL.md (the skill says so).
