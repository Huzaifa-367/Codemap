#!/usr/bin/env node
// End-to-end benchmark: the same questions answered by Claude Code twice, once exploring the code the usual way and
// once told to start from the map (codemap/query.mjs), measuring tokens, cost, tool calls, time and whether the
// answer names the right file. Tasks come from the built map itself (endpoints and screens with a known file), so any
// project with a codemap can be measured. It runs on your own Claude account and costs what those runs cost.
//
// usage: node tools/bench-agent.mjs <root with a built codemap/> [--tasks 8] [--model <model>] [--claude <path>] [--json]
//   Runs are read-only (Read, Grep, Glob and a few listing commands). Results go to codemap/.cache/bench-agent.json.

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i < 0 ? d : argv[i + 1]; };
const VALUED = new Set(['--tasks', '--model', '--claude']);
const root = path.resolve(argv.find((a, i) => !a.startsWith('--') && !VALUED.has(argv[i - 1])) || '.');
const N = Number(opt('tasks', 8)), model = opt('model', ''), claude = opt('claude', 'claude');
const G = JSON.parse(fs.readFileSync(path.join(root, 'codemap', 'graph.json'), 'utf8'));

// tasks: named endpoints and screens, each with the file that answers it
const tasks = [];
for (const r of G.routes || []) tasks.push({ q: r.name && !r.auto ? `Which file handles "${r.name}" (${r.m} ${r.p})?` : `Which file handles ${r.m} ${r.p}?`, want: r.f });
for (const s of G.screens || []) tasks.push({ q: `Which file is the "${s.name}" screen (${s.url})?`, want: s.file });
if (tasks.length < N) for (const f of G.files.filter((x) => x.d && !x.auto)) { if (tasks.length >= N) break; tasks.push({ q: `Which file ${f.d.replace(/\.$/, '').toLowerCase()}?`, want: f.p }); }
const picked = tasks.slice(0, N);

const READ_ONLY = ['Read', 'Grep', 'Glob', 'Bash(ls:*)', 'Bash(rg:*)', 'Bash(grep:*)', 'Bash(find:*)', 'Bash(cat:*)', 'Bash(head:*)'];
const ASK = (q) => `${q} Answer with the file path(s) relative to the project root, one per line, then one sentence. Don't edit anything.`;
const MAP_HINT = 'This project has a code map. Start with `node codemap/query.mjs context "<a few words from the question>"` (or `find`, `fn`), then read only the line ranges it lists before answering.';

function runOnce(prompt, withMap) {
  return new Promise((resolve) => {
    const args = ['-p', '--output-format', 'stream-json', '--verbose', '--tools', 'Read,Grep,Glob,Bash',
      ...(withMap ? ['--append-system-prompt', MAP_HINT] : ['--disallowedTools', 'Read(codemap/**)', 'Bash(node codemap/query.mjs:*)']),
      '--allowedTools', ...READ_ONLY, ...(withMap ? ['Bash(node codemap/query.mjs:*)'] : [])];
    if (model) args.push('--model', model);
    const t0 = Date.now();
    // (a .mjs/.js stand-in runs with this Node)
    const [cmd, pre] = /\.(m?js)$/.test(claude) ? [process.execPath, [claude]] : [claude, []];
    const child = spawn(cmd, [...pre, ...args], { cwd: root, stdio: ['pipe', 'pipe', 'pipe'], env: process.env });
    let buf = '', tools = 0, result = null;
    child.stdout.on('data', (d) => {
      buf += d;
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
        let ev; try { ev = JSON.parse(line); } catch { continue; }
        if (ev.type === 'assistant') tools += (ev.message?.content || []).filter((c) => c.type === 'tool_use').length;
        if (ev.type === 'result') result = ev;
      }
    });
    child.on('error', () => resolve({ error: `couldn't start ${claude}` }));
    child.on('close', () => {
      if (!result) return resolve({ error: 'no result' });
      const u = result.usage || {};
      const answer = typeof result.result === 'string' ? result.result : JSON.stringify(result.structured_output || '');
      resolve({ tools, tokens: (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.output_tokens || 0), cost: result.total_cost_usd || 0, ms: result.duration_ms || Date.now() - t0, answer });
    });
    child.stdin.end(prompt);
  });
}

const rows = [];
for (const t of picked) {
  const base = await runOnce(ASK(t.q), false);
  const map = await runOnce(ASK(t.q), true);
  const ok = (r) => !r.error && r.answer.includes(t.want);
  rows.push({ task: t.q, want: t.want, without: { ...base, correct: ok(base), answer: undefined }, with: { ...map, correct: ok(map), answer: undefined } });
  if (!argv.includes('--json')) console.log(`${ok(base) ? '✓' : '✗'}/${ok(map) ? '✓' : '✗'}  ${base.tokens ?? '?'} → ${map.tokens ?? '?'} tokens, ${base.tools ?? '?'} → ${map.tools ?? '?'} tool calls  ${t.q}`);
}
const sum = (side, k) => rows.reduce((s, r) => s + (r[side][k] || 0), 0);
const summary = {
  codebase: G.project?.name, tasks: rows.length, model: model || 'default',
  correct: { without: rows.filter((r) => r.without.correct).length, with: rows.filter((r) => r.with.correct).length },
  tokens: { without: sum('without', 'tokens'), with: sum('with', 'tokens') },
  toolCalls: { without: sum('without', 'tools'), with: sum('with', 'tools') },
  costUsd: { without: +sum('without', 'cost').toFixed(4), with: +sum('with', 'cost').toFixed(4) },
  seconds: { without: Math.round(sum('without', 'ms') / 1000), with: Math.round(sum('with', 'ms') / 1000) },
};
fs.mkdirSync(path.join(root, 'codemap', '.cache'), { recursive: true });
fs.writeFileSync(path.join(root, 'codemap', '.cache', 'bench-agent.json'), JSON.stringify({ at: new Date().toISOString(), summary, rows }, null, 1));
if (argv.includes('--json')) console.log(JSON.stringify({ summary, rows }, null, 1));
else {
  const pct = (a, b) => (a ? `${Math.round((1 - b / a) * 100)}% fewer` : '-');
  console.log(`\n${summary.codebase}: ${summary.tasks} questions, without → with the map`);
  console.log(`  right file named: ${summary.correct.without} → ${summary.correct.with}`);
  console.log(`  tokens: ${summary.tokens.without} → ${summary.tokens.with} (${pct(summary.tokens.without, summary.tokens.with)})`);
  console.log(`  tool calls: ${summary.toolCalls.without} → ${summary.toolCalls.with} (${pct(summary.toolCalls.without, summary.toolCalls.with)})`);
  console.log(`  cost: $${summary.costUsd.without} → $${summary.costUsd.with} · time: ${summary.seconds.without}s → ${summary.seconds.with}s`);
}
