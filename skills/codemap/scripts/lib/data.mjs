// The data model: tables (SQL migrations, Prisma schema) with their columns, keys and references, and which code
// uses which table (Supabase .from('orders'), Prisma prisma.order.findMany, raw SQL strings). Feeds the map's ERD
// (query.mjs erd), traces that end at a table, and impact.
//
// findTables(src, file) -> [{ name, line, columns: [[name, type, key]], refs: [[column, table]] }]
// findTableUses(src, file) -> [{ table, line, how }]   how: read | write | use

const clean = (n) => String(n).replace(/["`\[\]]/g, '').split('.').pop().toLowerCase();

export function findTables(src, file) {
  const out = [];
  if (/\.sql$/i.test(file.path)) {
    const s = src.replace(/--[^\n]*/g, (m) => ' '.repeat(m.length)).replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
    for (const m of s.matchAll(/\bcreate\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?([\w."`\[\]]+)\s*\(/gi)) {
      let d = 0, j = m.index + m[0].length - 1;
      for (; j < s.length; j++) { if (s[j] === '(') d++; else if (s[j] === ')' && --d === 0) break; }
      const body = s.slice(m.index + m[0].length, j);
      const cols = [], refs = [];
      // split on top-level commas
      const parts = []; let depth = 0, cur = '';
      for (const ch of body) { if (ch === '(') depth++; if (ch === ')') depth--; if (ch === ',' && !depth) { parts.push(cur); cur = ''; } else cur += ch; }
      parts.push(cur);
      for (const raw of parts) {
        const p = raw.trim().replace(/\s+/g, ' ');
        if (!p) continue;
        let r;
        if ((r = /^(?:constraint\s+\S+\s+)?primary key\s*\(([^)]*)\)/i.exec(p))) { for (const c of r[1].split(',')) { const col = cols.find((x) => x[0] === clean(c)); if (col) col[2] = 'pk'; } continue; }
        if ((r = /^(?:constraint\s+\S+\s+)?foreign key\s*\(([^)]*)\)\s*references\s+([\w."`]+)/i.exec(p))) { for (const c of r[1].split(',')) refs.push([clean(c), clean(r[2])]); continue; }
        if (/^(constraint|unique|check|index|key|exclude)\b/i.test(p)) continue;
        const c = /^([\w"`]+)\s+([\w]+(?:\s*\([^)]*\))?(?:\s*\[\])?)/.exec(p);
        if (!c) continue;
        const key = /\bprimary key\b/i.test(p) ? 'pk' : /\breferences\b/i.test(p) ? 'fk' : /\bunique\b/i.test(p) ? 'uk' : '';
        cols.push([clean(c[1]), c[2].toLowerCase(), key]);
        const ref = /\breferences\s+([\w."`]+)/i.exec(p);
        if (ref) refs.push([clean(c[1]), clean(ref[1])]);
      }
      out.push({ name: clean(m[1]), line: src.slice(0, m.index).split('\n').length, columns: cols.slice(0, 80), refs });
    }
  }
  if (/\.prisma$/i.test(file.path)) {
    for (const m of src.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
      const map = /@@map\(\s*"([^"]+)"\s*\)/.exec(m[2])?.[1];
      const cols = [], refs = [];
      for (const l of m[2].split('\n')) {
        const f = /^\s*(\w+)\s+(\w+)(\[\])?(\?)?\s*(.*)$/.exec(l);
        if (!f || f[1].startsWith('@@')) continue;
        const rel = /@relation\([^)]*fields:\s*\[([^\]]*)\]/.exec(f[5]);
        if (rel) { for (const c of rel[1].split(',')) refs.push([c.trim().toLowerCase(), f[2].toLowerCase()]); continue; }
        if (/^[A-Z]/.test(f[2]) && !/^(String|Int|BigInt|Float|Decimal|Boolean|DateTime|Json|Bytes)$/.test(f[2])) continue; // the other side of a relation
        cols.push([f[1].toLowerCase(), f[2].toLowerCase() + (f[3] || ''), /@id\b/.test(f[5]) ? 'pk' : /@unique\b/.test(f[5]) ? 'uk' : '']);
      }
      out.push({ name: (map || m[1]).toLowerCase(), model: m[1], line: src.slice(0, m.index).split('\n').length, columns: cols, refs });
    }
  }
  return out;
}

const SQL_USE = /\b(select\b[\s\S]{0,200}?\bfrom|insert\s+into|update|delete\s+from|join)\s+["`]?(\w+)["`]?/gi;
const WRITE = /^(insert|update|delete)/i;
export function findTableUses(src, file) {
  if (file.category !== 'code' || /\.sql$/i.test(file.path)) return [];
  const out = [];
  const lineAt = (i) => src.slice(0, i).split('\n').length;
  const add = (table, i, how) => out.push({ table: clean(table), line: lineAt(i), how });
  // Supabase (JS, Dart, Swift, Kotlin): supabase.from('orders').select() / .insert() …
  for (const m of src.matchAll(/\.from\(\s*["'`](\w+)["'`]\s*\)\s*\.?\s*(select|insert|upsert|update|delete)?/g)) add(m[1], m.index, m[2] && m[2] !== 'select' ? 'write' : 'read');
  // Prisma: prisma.order.findMany(), db.orderItem.create()
  for (const m of src.matchAll(/\b(?:prisma|db|tx)\.(\w+)\.(findMany|findFirst|findUnique|count|aggregate|groupBy|create|createMany|update|updateMany|upsert|delete|deleteMany)\b/g)) add(m[1], m.index, /^(find|count|agg|group)/.test(m[2]) ? 'read' : 'write');
  // SQL in strings
  for (const s of src.matchAll(/(["'`])((?:select|insert|update|delete|with)\b(?:\\.|(?!\1)[^\\])*)\1/gi)) {
    for (const m of s[2].matchAll(SQL_USE)) if (!/^(select|set|where|values|the|a)$/i.test(m[2])) add(m[2], s.index, WRITE.test(m[1]) ? 'write' : 'read');
  }
  const seen = new Set();
  return out.filter((u) => { const k = `${u.table}|${u.how}`; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 60);
}
