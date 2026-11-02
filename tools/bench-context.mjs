#!/usr/bin/env node
// How well `query.mjs context` serves an agent on a real, built map, with no LLM: for every endpoint (and its
// callers) and every screen, ask for context in the words of its plain-English name, then check whether the files
// that matter come back, and how much reading it asks for compared with exploring.
//
// usage: node tools/bench-context.mjs <codebase root with a built codemap/> [--budget 6000] [--json]
//   recall@read  the endpoint's own file is among the files to read (and, for callers, a calling file too)
//   tokens       estimated reading the context asks for vs the parts it touches vs the whole codebase

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.resolve(process.argv[2] || '.');
const budget = process.argv.includes('--budget') ? process.argv[process.argv.indexOf('--budget') + 1] : '6000';
const G = JSON.parse(fs.readFileSync(path.join(root, 'codemap', 'graph.json'), 'utf8'));
const q = (task) => JSON.parse(execFileSync(process.execPath, [path.join(root, 'codemap', 'query.mjs'), 'context', task, '--json', '--budget', budget], { encoding: 'utf8' }));
const callersOf = (i) => (G.links || []).filter((l) => (l.calls || []).some(([x]) => x === i)).map((l) => l.a.slice(2));
const whole = G.files.reduce((s, f) => s + (f.loc || 0) * 11, 0);

const cases = [];
(G.routes || []).forEach((r, i) => { if (r.name && !r.auto) cases.push({ task: r.name, want: r.f, also: callersOf(i) }); else cases.push({ task: `${r.m.toLowerCase()} ${r.p.split('/').filter((s) => s && !/[:{<*]/.test(s)).join(' ')}`, want: r.f, also: callersOf(i) }); });
for (const s of G.screens || []) cases.push({ task: /screen|page/i.test(s.name) ? s.name : `${s.name} screen`, want: s.file, also: [] });

let hit = 0, hitAlso = 0, withAlso = 0, read = 0, explore = 0, n = 0;
const rows = [];
for (const c of cases.slice(0, 200)) {
  if (!c.task.replace(/\W/g, '')) continue;
  let r; try { r = q(c.task); } catch { continue; }
  n++;
  const files = new Set((r.read || []).map((x) => x.file));
  const ok = files.has(c.want);
  const okAlso = c.also.length ? c.also.some((p) => files.has(p)) : null;
  hit += ok ? 1 : 0;
  if (okAlso !== null) { withAlso++; hitAlso += okAlso ? 1 : 0; }
  read += r.readTokens || 0; explore += r.exploreTokens || 0;
  rows.push({ task: c.task, found: ok, caller: okAlso, readTokens: r.readTokens || 0 });
}
const out = {
  codebase: path.basename(root), cases: n,
  recall: n ? +(hit / n).toFixed(3) : 0,
  callerRecall: withAlso ? +(hitAlso / withAlso).toFixed(3) : null,
  avgReadTokens: n ? Math.round(read / n) : 0,
  avgExploreTokens: n ? Math.round(explore / n) : 0,
  wholeCodebaseTokens: whole,
  reduction: read ? +(explore / read).toFixed(1) : null,
};
if (process.argv.includes('--json')) console.log(JSON.stringify({ ...out, rows }, null, 1));
else {
  console.log(`${out.codebase}: ${n} tasks from endpoint and screen names`);
  console.log(`  the right file came back: ${(out.recall * 100).toFixed(0)}%${out.callerRecall != null ? ` · a calling file too: ${(out.callerRecall * 100).toFixed(0)}%` : ''}`);
  console.log(`  reading asked for: ~${out.avgReadTokens} tokens per task · the parts involved: ~${out.avgExploreTokens} (${out.reduction}× more) · whole codebase: ~${out.wholeCodebaseTokens}`);
  const miss = rows.filter((x) => !x.found).slice(0, 8);
  if (miss.length) console.log(`  misses, e.g.: ${miss.map((x) => `"${x.task}"`).join(', ')}`);
}
