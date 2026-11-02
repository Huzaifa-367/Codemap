#!/usr/bin/env node
// codemap impact: what a change touches and what may break, worked out from the map with no tokens.
// Changed files (uncommitted work, or everything since --base <git ref>) → the cards they are on → everything
// that uses them, through imports and through web requests (so a changed endpoint reaches the mobile app or
// website that calls it, in another repo) → the screens behind which they sit, and the Health issues in them.
//
// usage: node impact.mjs [root] [--base <ref>] [--files a,b,…] [--depth 3] [--json | --markdown]
//   --base    compare against a branch or commit (e.g. main) instead of the uncommitted changes
//   --files   take these paths (relative to the root) as the change instead of asking git
//   --json    one JSON object for agents; --markdown a summary for a pull request comment
// Read-only: it reads codemap/graph.json and runs `git diff` / `git ls-files` in each repo.

import fs from 'node:fs';
import path from 'node:path';
import { git, parseArgs, mapDir } from './lib/common.mjs';
import { impactReport } from './lib/flows.mjs';

const args = parseArgs(process.argv.slice(2));
const root = path.resolve(args._[0] || '.');
const dir = mapDir(root, { migrate: false });
const graphFile = path.join(dir, 'graph.json');
if (!fs.existsSync(graphFile)) { console.error('✗ No codemap/graph.json here. Make the map first (scan.mjs, then build.mjs).'); process.exit(1); }
const G = JSON.parse(fs.readFileSync(graphFile, 'utf8'));
// what changed: the files named, or what git says changed in each repo of the map
const changed = new Set();
if (typeof args.files === 'string') for (const p of args.files.split(',').map((s) => s.trim()).filter(Boolean)) changed.add(p.replace(/\\/g, '/').replace(/^\.\//, ''));
else {
  const repos = G.meta?.repos?.length ? G.meta.repos : [{ path: '.' }];
  for (const r of repos) {
    const abs = path.join(root, r.path);
    const prefix = r.path === '.' ? '' : r.path + '/';
    const lists = typeof args.base === 'string'
      ? [git(abs, ['diff', '--name-only', `${args.base}...HEAD`, '--', '.'])]
      : [git(abs, ['diff', '--name-only', 'HEAD', '--', '.']), git(abs, ['ls-files', '--others', '--exclude-standard', '--', '.'])];
    for (const out of lists) for (const p of (out || '').split('\n').filter(Boolean)) changed.add(prefix + p);
  }
}
console.log(impactReport(G, changed, args).out);
