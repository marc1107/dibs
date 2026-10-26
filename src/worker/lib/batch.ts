import { SQL } from "drizzle-orm";
import { SQLiteAsyncDialect } from "drizzle-orm/sqlite-core";

/** A Drizzle query builder (insert/update/delete/select) or a raw `sql` template. */
export type Statement = SQL | { toSQL(): { sql: string; params: unknown[] } };

const dialect = new SQLiteAsyncDialect();

function toQuery(statement: Statement) {
  return statement instanceof SQL ? dialect.sqlToQuery(statement) : statement.toSQL();
}

/**
 * Executes statements atomically as one D1 batch (an implicit transaction).
 * Drizzle's own batch cannot carry raw SQL on D1, so statements are compiled here.
 */
export async function runBatch(d1: D1Database, statements: Statement[]): Promise<D1Result[]> {
  if (statements.length === 0) return [];
  return d1.batch(
    statements.map((s) => {
      const { sql, params } = toQuery(s);
      return d1.prepare(sql).bind(...params);
    }),
  );
}
