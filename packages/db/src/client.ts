import postgres from "postgres";

export type Sql = postgres.Sql;
export type Tx = postgres.TransactionSql;

/**
 * One pool per process. The connection user is `postgres`, which bypasses RLS, so
 * request code must never use this handle directly: go through `withContext`.
 */
export function createDb(url: string, options: { max?: number } = {}): Sql {
  return postgres(url, {
    max: options.max ?? 10,
    // numeric comes back as a string; callers turn it into a domain Qty (bigint).
    onnotice: () => {},
  });
}
