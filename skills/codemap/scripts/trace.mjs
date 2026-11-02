#!/usr/bin/env node
// codemap trace: follow a flow from where it starts down to the data, function by function, across apps.
// Starts at a screen, an endpoint, a file or a function; follows calls between functions, the web requests a
// function makes to the endpoint that answers them (another repo, a mobile app's server…), that endpoint's
// handler and what it calls in turn, down to the outside services and databases. No tokens: it reads the map.
//
// usage: node trace.mjs [root] "<start>" [--depth 8] [--app <part>] [--json | --mermaid | --save "<title>"]
//   <start>   a screen ("/orders/:id"), an endpoint ("GET /api/orders/:id"), a file ("web/src/Cart.tsx"),
//             a function ("web/src/api.ts#placeOrder"), or words to search for ("checkout")
//   --mermaid a sequence diagram of the flow; --json the tree; --save adds it to the map's Flows
//             (codemap/custom-flows.json; the next build shows it)

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs, mapDir } from './lib/common.mjs';
import { traceReport } from './lib/flows.mjs';

const args = parseArgs(process.argv.slice(2));
const root = path.resolve(args._[0] || '.');
const start = String(args._[1] || '').trim();
const dir = mapDir(root, { migrate: false });
const graphFile = path.join(dir, 'graph.json');
if (!fs.existsSync(graphFile)) { console.error('✗ No codemap/graph.json here. Make the map first (scan.mjs, then build.mjs).'); process.exit(1); }
if (!start) { console.error('usage: node trace.mjs <root> "<screen | METHOD /path | file | file#function | words>"'); process.exit(1); }
const G = JSON.parse(fs.readFileSync(graphFile, 'utf8'));
const r = traceReport(G, start, args);
if (r.error) { console.error(`✗ ${r.error}`); process.exit(1); }
if (r.save) {
  const file = path.join(dir, 'custom-flows.json');
  let data = { flows: [] };
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  data.flows = [...(data.flows || []).filter((f) => f.id !== r.save.id), r.save];
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}
console.log(r.out);
