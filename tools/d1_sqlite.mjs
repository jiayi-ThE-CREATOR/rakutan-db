/* 検査用：D1 の代わりに Node の SQLite（メモリ上）を使う。db/schema.sql をそのまま流すので、
 * 本番と同じ表・同じ SQL で確かめられる（手書きの偽物だと SQL の間違いを見逃す）。
 *
 *   import { d1 } from "./d1_sqlite.mjs";
 *   const DB = d1();            // DB.written に bind した値がすべて残る
 */
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

export function d1() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8"));
  const written = [];
  const plain = (row) => (row ? { ...row } : null);
  const prepare = (sql) => {
    let args = [];
    const st = {
      bind(...a) { args = a; written.push(...a.map(String)); return st; },
      async run() { const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes) } }; },
      async first() { return plain(db.prepare(sql).get(...args)); },
      async all() { return { results: db.prepare(sql).all(...args).map(plain) }; },
    };
    return st;
  };
  return {
    prepare, written, raw: db,
    async batch(stmts) {
      db.exec("BEGIN");
      try { const out = []; for (const s of stmts) out.push(await s.run()); db.exec("COMMIT"); return out; }
      catch (e) { db.exec("ROLLBACK"); throw e; }
    },
  };
}
