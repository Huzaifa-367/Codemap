// The data model: tables (SQL migrations, Prisma schema) with their columns, keys and references, and which code
// uses which table (Supabase .from('orders'), Prisma prisma.order.findMany, raw SQL strings). Feeds the map's ERD
// (query.mjs erd), traces that end at a table, and impact.
//
// findTables(src, file) -> [{ name, line, columns: [[name, type, key]], refs: [[column, table]] }]
// findTableUses(src, file) -> [{ table, line, how }]   how: read | write | use

import { varTypes } from './calls.mjs';

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
  if (file.category === 'code') for (const t of codeTables(src, file)) out.push(t);
  return out;
}

/** snake_case plural, the default table name for a model in Laravel, Rails, Sequelize and Mongoose: OrderItem -> order_items. */
export const tableOf = (model) => {
  const s = model.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
  return /(s|x|z|ch|sh)$/.test(s) ? s + 'es' : /[^aeiou]y$/.test(s) ? s.slice(0, -1) + 'ies' : s + 's';
};
const snake = (m) => m.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
/** The text between the brace (or do/end) that opens at `open` and its match. */
function block(src, open) {
  if (src[open] !== '{') { const end = src.slice(open).search(/^\s*end\b/m); return src.slice(open, end < 0 ? open + 4000 : open + end); }
  let d = 0;
  for (let j = open; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && --d === 0) return src.slice(open + 1, j); }
  return src.slice(open + 1, open + 4000);
}
const NOT_COLUMN = /^(index|unique|primary|foreign|dropColumn|dropIndex|dropForeign|renameColumn|engine|charset|collation|comment|timestamps|softDeletes|rememberToken|morphs|nullableMorphs|references|on|onDelete|onUpdate|constrained|cascadeOnDelete)$/;
function codeTables(src, file) {
  const out = [];
  const lineAt = (i) => src.slice(0, i).split('\n').length;
  const table = (name, i, extra = {}) => out.push({ name: clean(name), line: lineAt(i), columns: [], refs: [], ...extra });
  // Laravel: Schema::create('orders', function (Blueprint $table) { $table->string('status'); $table->foreignId('user_id')->constrained(); })
  for (const m of src.matchAll(/Schema::create\(\s*['"](\w+)['"]\s*,\s*(?:static\s+)?(?:function\s*\([^)]*\)\s*|fn\s*\([^)]*\)\s*=>\s*)\{/g)) {
    const body = block(src, m.index + m[0].length - 1), columns = [], refs = [];
    if (/\$table->id\(\s*\)/.test(body)) columns.push(['id', 'id', 'pk']);
    for (const c of body.matchAll(/\$table->(\w+)\(\s*['"](\w+)['"]([^;]*);/g)) {
      if (NOT_COLUMN.test(c[1])) continue;
      const key = /->primary\(/.test(c[3]) ? 'pk' : /^foreign/i.test(c[1]) || /->(constrained|references)\(/.test(c[3]) ? 'fk' : /->unique\(/.test(c[3]) ? 'uk' : '';
      columns.push([c[2].toLowerCase(), c[1].toLowerCase(), key]);
      const to = /->constrained\(\s*['"](\w+)['"]/.exec(c[3])?.[1] || /->on\(\s*['"](\w+)['"]/.exec(c[3])?.[1] || (/->constrained\(/.test(c[3]) ? tableOf(c[2].replace(/_id$/, '').replace(/(^|_)(\w)/g, (x, a, b) => b.toUpperCase())) : null);
      if (to) refs.push([c[2].toLowerCase(), to]);
    }
    if (/\$table->timestamps\(/.test(body)) columns.push(['created_at', 'timestamp', ''], ['updated_at', 'timestamp', '']);
    table(m[1], m.index, { columns, refs });
  }
  // Rails: create_table :orders do |t| t.string :status; t.references :user end
  for (const m of src.matchAll(/create_table\s+[:"'](\w+)["']?[^\n]*\bdo\s*\|(\w+)\|/g)) {
    const body = block(src, m.index + m[0].length), columns = [['id', 'bigint', 'pk']], refs = [];
    for (const c of body.matchAll(new RegExp(`\\b${m[2]}\\.(\\w+)\\s+[:"'](\\w+)`, 'g'))) {
      if (/^(index|timestamps)$/.test(c[1])) continue;
      if (/^(references|belongs_to)$/.test(c[1])) { columns.push([c[2] + '_id', 'bigint', 'fk']); refs.push([c[2] + '_id', tableOf(c[2])]); } else columns.push([c[2], c[1], '']);
    }
    table(m[1], m.index, { columns, refs });
  }
  // Knex: knex.schema.createTable('orders', (t) => { t.string('status') })   Drizzle: pgTable('orders', { … })
  for (const m of src.matchAll(/\.createTable\(\s*['"`](\w+)['"`]|\b(?:pg|mysql|sqlite)Table\(\s*['"`](\w+)['"`]/g)) table(m[1] || m[2], m.index);
  // SQL in code strings (sqflite, raw migrations): CREATE TABLE orders (…)
  for (const m of src.matchAll(/\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?["`]?(\w+)["`]?\s*\(/gi)) if (!/\.sql$/i.test(file.path)) table(m[1], m.index);
  // model classes: the table a model reads and writes
  const model = (name, tableName, i) => out.push({ name: clean(tableName), model: name, modelOnly: true, line: lineAt(i), columns: [], refs: [] });
  for (const m of src.matchAll(/\bclass\s+([A-Z]\w*)\s+extends\s+(?:\\?[\w\\]*\\)?(Model|Authenticatable|Pivot|MorphPivot)\b[^{]*\{/g)) {
    // Eloquent (and Sequelize class models): protected $table = 'x' / static tableName
    const body = block(src, m.index + m[0].length - 1);
    model(m[1], /\$table\s*=\s*['"](\w+)['"]/.exec(body)?.[1] || /tableName\s*[:=]\s*['"](\w+)['"]/.exec(body)?.[1] || tableOf(m[1]), m.index);
  }
  for (const m of src.matchAll(/^class\s+([A-Z]\w*)\s*<\s*(?:ApplicationRecord|ActiveRecord::Base)\b/gm)) model(m[1], /self\.table_name\s*=\s*['"](\w+)['"]/.exec(src.slice(m.index, m.index + 3000))?.[1] || tableOf(m[1]), m.index);
  for (const m of src.matchAll(/^class\s+([A-Z]\w*)\(([^)]*\b(?:models\.Model|Base|db\.Model|DeclarativeBase|SQLModel)[^)]*)\):/gm)) {
    const body = src.slice(m.index, m.index + 4000).split(/\n(?=\S)/)[0];
    if (/SQLModel/.test(m[2]) && !/table\s*=\s*True/.test(m[2])) continue;
    model(m[1], /__tablename__\s*=\s*['"](\w+)['"]/.exec(body)?.[1] || /db_table\s*=\s*['"](\w+)['"]/.exec(body)?.[1] || snake(m[1]), m.index);
  }
  for (const m of src.matchAll(/@Entity\s*(?:\(\s*(?:(?:name\s*=\s*)?["'](\w+)["'])?[^)]*\))?[\s\S]{0,300}?\bclass\s+([A-Z]\w*)/g)) {
    const tbl = /@Table\s*\(\s*(?:name\s*=\s*)?["'](\w+)["']/.exec(src.slice(Math.max(0, m.index - 200), m.index + m[0].length))?.[1];
    model(m[2], tbl || m[1] || snake(m[2]), m.index);
  }
  for (const m of src.matchAll(/\b(?:mongoose\.)?model\(\s*['"]([A-Z]\w*)['"]\s*,/g)) model(m[1], tableOf(m[1]), m.index);
  for (const m of src.matchAll(/\bsequelize\.define\(\s*['"](\w+)['"]/g)) model(m[1][0].toUpperCase() + m[1].slice(1), tableOf(m[1]), m.index);
  for (const m of src.matchAll(/\bclass\s+([A-Z]\w*)\s+extends\s+Table\b/g)) model(m[1], snake(m[1]), m.index); // Drift
  for (const m of src.matchAll(/\bDbSet<\s*([A-Z]\w*)\s*>\s+([A-Z]\w*)/g)) model(m[1], m[2], m.index); // EF Core
  return out;
}

const SQL_USE = /\b(select\b[\s\S]{0,200}?\bfrom|insert\s+into|update|delete\s+from|join)\s+["`]?(\w+)["`]?/gi;
const WRITE = /^(insert|update|delete)/i;
const WRITES = 'create|createMany|createOrFirst|insert|insertGetId|insertOrIgnore|update|updateOrCreate|updateOrInsert|upsert|delete|destroy|forceDelete|firstOrCreate|save|saveAll|saveAndFlush|saveMany|bulk_create|bulkCreate|get_or_create|update_or_create|increment|decrement|remove|softDelete|Add|AddRange|Remove|RemoveRange|Update|insertOne|insertMany|updateOne|updateMany|deleteOne|deleteMany|findOneAndUpdate|findByIdAndUpdate|findByIdAndDelete|Create|Save|Delete|Updates';
const READS = 'find|findOrFail|findMany|findAll|findOne|findOneBy|findBy|findById|findAllById|findAndCountAll|first|firstOrFail|firstWhere|where|whereIn|whereHas|all|get|filter|exclude|query|count|exists|paginate|simplePaginate|pluck|with|latest|oldest|sum|avg|max|min|lazy|cursor|chunk|aggregate|select|Where|Find|First|FirstOrDefault|SingleOrDefault|ToList|ToListAsync|Include|Any|Count|Take';
const WRITE_RE = new RegExp(`^(${WRITES})$`);
const STATIC_USE = new RegExp(`\\b([A-Z]\\w*)(?:::|\\.objects\\.|\\.query\\.|\\.)(${WRITES}|${READS})[!?]?\\s*\\(`, 'g');
const INSTANCE_USE = /(?:\$this->|this\.|self\.|\$|\b)([a-z_]\w*)(?:->|\.)(save|update|delete|destroy|forceDelete|increment|decrement|push|touch|refresh|remove)\s*\(/g;
/**
 * Reads and writes through ORM models, resolved to tables at build time (only for classes known to be models):
 * Order::create() / Order.objects.filter() / Order.findAll() / Order.where() (Eloquent, Django, Sequelize, Mongoose,
 * ActiveRecord), $order->update() / order.save() on a typed variable, orderRepository.save() (Spring Data,
 * TypeORM repositories, named <Model>Repository), Repository<Order>, session.query(Order) / select(Order), db.Create(&order).
 */
function modelUses(src, file) {
  const out = [];
  const lineAt = (i) => src.slice(0, i).split('\n').length;
  const types = varTypes(src, file.lang);
  for (const m of src.matchAll(/\$?(\w+)\s*=\s*(?:await\s+)?([A-Z]\w*)(?:::|\.objects\.|\.)\w+[!?]?\s*\(/g)) if (!types.has(m[1])) types.set(m[1], m[2]);
  for (const m of src.matchAll(/\b(\w+)\s*:\s*Repository<\s*([A-Z]\w*)\s*>/g)) types.set(m[1], m[2] + 'Repository');
  const add = (model, i, how) => out.push({ model, line: lineAt(i), how });
  for (const m of src.matchAll(STATIC_USE)) add(m[1], m.index, WRITE_RE.test(m[2]) ? 'write' : 'read');
  for (const m of src.matchAll(INSTANCE_USE)) { const t = types.get(m[1]); if (t) add(t.replace(/Repository$/, ''), m.index, m[2] === 'refresh' ? 'read' : 'write'); }
  for (const m of src.matchAll(new RegExp(`\\b([a-z_]\\w*)\\.(${WRITES}|${READS})\\s*\\(`, 'g'))) { const t = types.get(m[1]); if (t && /Repository$/.test(t)) add(t.replace(/Repository$/, ''), m.index, WRITE_RE.test(m[2]) ? 'write' : 'read'); }
  for (const m of src.matchAll(/\b(?:query|select)\(\s*([A-Z]\w*)\s*[,)]/g)) add(m[1], m.index, 'read');
  for (const m of src.matchAll(/\.add\(\s*([A-Z]\w*)\s*\(/g)) add(m[1], m.index, 'write');
  for (const m of src.matchAll(/\.(Create|Save|Delete|Updates?)\(\s*&([A-Z]\w*)\{/g)) add(m[2], m.index, 'write');
  for (const m of src.matchAll(/\.(Create|Save|Delete|Updates?|Find|First)\(\s*&(\w+)\s*[,)]/g)) { const t = types.get(m[2]); if (t) add(t, m.index, /^(Find|First)$/.test(m[1]) ? 'read' : 'write'); }
  // Laravel query builder and knex: DB::table('orders')->insert(…), knex('orders').where(…)
  for (const m of src.matchAll(/\b(?:DB::table|knex|db)\(\s*['"](\w+)['"]\s*\)([^;]{0,200})/g)) out.push({ table: clean(m[1]), line: lineAt(m.index), how: new RegExp(`(->|\\.)(${WRITES})\\(`).test(m[2]) ? 'write' : 'read' });
  return out;
}

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
  for (const u of modelUses(src, file)) out.push(u);
  const seen = new Set();
  return out.filter((u) => { const k = `${u.table || ''}|${u.model || ''}|${u.how}`; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 60);
}
