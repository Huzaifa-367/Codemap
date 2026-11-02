#!/usr/bin/env node
// Fill in who owns this copy of Codemap: replaces Huzaifa-367 and YOUR_NAME in the plugin manifests, the README,
// the docs and the LICENSE, so install commands and links point at your repository.
// usage: node tools/set-owner.mjs <github-user> "<Your Name>"
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const [user, name] = process.argv.slice(2);
if (!user || !name) {
  console.error('usage: node tools/set-owner.mjs <github-user> "<Your Name>"');
  process.exit(1);
}
const root = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
);
const files = execFileSync("git", ["-C", root, "ls-files"], {
  encoding: "utf8",
})
  .split("\n")
  .filter(Boolean);
let n = 0;
for (const f of files) {
  if (f === "tools/set-owner.mjs") continue;
  const p = path.join(root, f);
  let s;
  try {
    s = fs.readFileSync(p, "utf8");
  } catch {
    continue;
  }
  if (!/Huzaifa-367|YOUR_NAME/.test(s)) continue;
  fs.writeFileSync(
    p,
    s.replaceAll("Huzaifa-367", user).replaceAll("YOUR_NAME", name),
  );
  n++;
}
console.log(
  `Updated ${n} files. Next: node tools/checksums.mjs, then commit and push.`,
);
