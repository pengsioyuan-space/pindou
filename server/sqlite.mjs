import { DatabaseSync } from "node:sqlite";
export function sqliteDB(path) {
  const db = new DatabaseSync(path);
  db.exec(
    "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;",
  );
  const prepared = (sql, args = []) => ({
    sql,
    args,
    bind(...values) {
      return prepared(sql, values);
    },
    async first() {
      return db.prepare(sql).get(...args) || null;
    },
    async all() {
      return { results: db.prepare(sql).all(...args) };
    },
    async run() {
      return db.prepare(sql).run(...args);
    },
  });
  return {
    prepare: prepared,
    async batch(queries) {
      db.exec("BEGIN IMMEDIATE");
      try {
        const results = queries.map((q) => db.prepare(q.sql).run(...q.args));
        db.exec("COMMIT");
        return results;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
    exec: (sql) => db.exec(sql),
    close: () => db.close(),
  };
}
