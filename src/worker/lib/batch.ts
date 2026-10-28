import { SQL, sql } from "drizzle-orm";
import { SQLiteAsyncDialect } from "drizzle-orm/sqlite-core";

/** A Drizzle query builder (insert/update/delete/select) or a raw `sql` template. */
export type Statement = SQL | { toSQL(): { sql: string; params: unknown[] } };

const dialect = new SQLiteAsyncDialect();
/** Only guard() can produce this error message ("bad JSON path: '<marker>'"). */
const GUARD_MARKER = "dibs_guard_violated";

/** Raised when a `guard` statement inside a batch found its condition violated; nothing was written. */
export class GuardError extends Error {}

function toQuery(statement: Statement) {
  return statement instanceof SQL ? dialect.sqlToQuery(statement) : statement.toSQL();
}

/**
 * A statement that aborts the whole batch (rolling back every statement in it) when
 * `violated` is true. D1 has no interactive transactions, so checks that must hold at
 * write time are expressed this way. It forces an SQLite error with a unique marker.
 */
export function guard(violated: SQL): SQL {
  return sql`SELECT CASE WHEN ${violated} THEN json_extract('{}', ${sql.raw(`'${GUARD_MARKER}'`)}) END`;
}

/**
 * Executes statements atomically as one D1 batch (an implicit transaction).
 * Drizzle's own batch cannot carry raw SQL on D1, so statements are compiled here.
 */
export async function runBatch(d1: D1Database, statements: Statement[]): Promise<D1Result[]> {
  if (statements.length === 0) return [];
  try {
    return await d1.batch(
      statements.map((s) => {
        const { sql: text, params } = toQuery(s);
        return d1.prepare(text).bind(...params);
      }),
    );
  } catch (err) {
    if (err instanceof Error && err.message.includes(GUARD_MARKER)) throw new GuardError(err.message);
    throw err;
  }
}
