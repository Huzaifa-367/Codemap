// Keeps a short block in the project's CLAUDE.local.md pointing future Claude Code sessions at the map, so
// "where is X / how does Y work" starts from the map instead of a fresh search of the code.
// CLAUDE.local.md is Claude Code's personal, uncommitted project memory (loaded at launch like CLAUDE.md,
// including from parent folders); the map itself isn't committed, so its pointer isn't either. The file
// is added to the repo's local ignore list (.git/info/exclude), which leaves tracked files untouched.
// The block sits between markers and is rewritten in place; the rest of the file is never touched.
// It's added only when the user asks for it (build.mjs --claude-md); a block that's already there is
// kept current. Put <!-- codemap:off --> in CLAUDE.local.md to opt out.
import fs from 'node:fs';
import path from 'node:path';
import { git } from './common.mjs';

const START = '<!-- codemap:start -->';
const END = '<!-- codemap:end -->';
const NAME = 'CLAUDE.local.md';

function block(rel) {
  return `${START}
## Codemap: map of this codebase (use it before searching)

\`${rel}/\` maps this codebase: every app, module, file, endpoint and function, with plain-English names, what calls what (across apps, including requests to the server), screens, and recent work. Reading code to find your way costs most of a session's tokens; the map answers in a few hundred. Run from the folder this file is in:

1. **Starting a task:** \`node ${rel}/query.mjs context "<task in a few words>"\` lists the files and exact line ranges to read (with callers, endpoints and tests). Read those ranges, not whole files or folders.
2. **A function:** \`node ${rel}/query.mjs fn <name>\` gives where it is, what calls it and what it calls. Use it instead of grepping for callers.
3. **How a flow works / what a change touches:** \`node ${rel}/query.mjs trace "<screen | GET /path | file#fn>"\` follows it function by function across apps; \`node ${rel}/query.mjs impact\` lists what your uncommitted changes reach (\`--base main\` for a branch).
4. **The big picture:** \`node ${rel}/query.mjs map\` (about 1,500 tokens) or \`overview\`; \`find "<words>"\`, \`show <file | "GET /path">\`, \`path <from> <to>\`.

The map can lag behind edits (\`context\` flags files changed since it was built), so confirm in the code before changing anything. After big changes, ask to "update the codemap" (only changed files are re-read).
${END}`;
}

const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null);
/** The text with the block removed (normalized to \n), or null when there's no block. */
const stripBlock = (text) => {
  const a = text.indexOf(START), b = text.indexOf(END);
  if (a < 0 || b < a) return null;
  return [text.slice(0, a).trimEnd(), text.slice(b + END.length).trimStart()].filter(Boolean).join('\n\n').replace(/\r\n/g, '\n');
};

/** Adds CLAUDE.local.md to the enclosing repo's .git/info/exclude unless git already ignores it. */
function excludeLocally(root) {
  if (git(root, ['rev-parse', '--is-inside-work-tree']) !== 'true') return 'not in a git repo';
  if (git(root, ['ls-files', '--', NAME])) return `${NAME} is committed in this repo; the Codemap section will show up in it`;
  if (git(root, ['check-ignore', '-q', NAME]) !== null) return 'already ignored';
  const prefix = git(root, ['rev-parse', '--show-prefix']) || '';
  const excl = git(root, ['rev-parse', '--git-path', 'info/exclude']);
  if (!excl) return 'could not find .git/info/exclude';
  const file = path.resolve(root, excl);
  const line = '/' + prefix + NAME;
  const cur = read(file) || '';
  if (!cur.split(/\r?\n/).includes(line)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, cur.replace(/\s*$/, cur.trim() ? '\n' : '') + `# personal Claude Code notes (added by Codemap)\n${line}\n`);
  }
  return 'ignored locally via .git/info/exclude';
}

/** Refreshes the block, or adds it when `add` (the user asked for it); moves it out of a committed CLAUDE.md written by older versions. */
export function writeClaudeMd(root, outDir, { add = false } = {}) {
  const rel = path.relative(root, outDir).replace(/\\/g, '/');
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return 'skipped (map is outside the codebase)';
  const had = ['CLAUDE.local.md', 'CLAUDE.md', path.join('.claude', 'CLAUDE.md')].some((f) => stripBlock(read(path.join(root, f)) ?? '') != null);
  if (!add && !had) return 'not added (offer it to the user; add it with --claude-md)';
  const notes = [];

  // older versions wrote the block into CLAUDE.md, which is usually committed: take it back out
  for (const f of [path.join(root, 'CLAUDE.md'), path.join(root, '.claude', 'CLAUDE.md')]) {
    const t = read(f);
    const rest = t == null ? null : stripBlock(t);
    if (rest == null) continue;
    const eol = t.includes('\r\n') ? '\r\n' : '\n';
    const tracked = !!git(path.dirname(f), ['ls-files', '--', path.basename(f)]);
    if (!rest.trim() && !tracked) fs.unlinkSync(f);
    else fs.writeFileSync(f, rest.replace(/\n/g, eol) + (rest.trim() ? eol : ''));
    notes.push(`moved the Codemap section out of ${path.relative(root, f).replace(/\\/g, '/')}${!rest.trim() && tracked ? ' (now empty; delete it if you like)' : ''}`);
  }

  const file = path.join(root, NAME);
  let old = read(file);
  if (old?.includes('<!-- codemap:off -->')) return 'skipped (opted out)';
  const eol = old?.includes('\r\n') ? '\r\n' : '\n';
  const text = block(rel).replace(/\n/g, eol);
  let next;
  if (old == null) next = text + eol;
  else {
    // a note written before the rename (floorplan markers) is replaced, not left beside the new one
    old = old.replace(/<!-- floorplan:start -->[\s\S]*?<!-- floorplan:end -->\s*/g, '');
    const a = old.indexOf(START), b = old.indexOf(END);
    next = a >= 0 && b > a ? old.slice(0, a) + text + old.slice(b + END.length) : old.replace(/\s*$/, '') + eol + eol + text + eol;
  }
  if (next !== old) { fs.writeFileSync(file, next); notes.unshift(`${old == null ? 'created' : 'updated'} ${NAME}`); }
  else notes.unshift(`${NAME} unchanged`);
  notes.push(excludeLocally(root));
  return notes.join('; ');
}
