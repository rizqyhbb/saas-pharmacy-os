import postgres from "postgres";

/**
 * What a database error means for the caller. Rule violations raised by the schema's
 * triggers start with a domain error kind (`INSUFFICIENT_AVAILABLE: ...`), the same
 * names packages/domain uses, so the API can answer the way the domain would.
 */
export type DbFailure =
  | { kind: "RULE"; rule: string; message: string }
  | { kind: "ROW_LEVEL_SECURITY" }
  | { kind: "UNIQUE"; constraint: string | undefined }
  | { kind: "FOREIGN_KEY"; constraint: string | undefined }
  | { kind: "CHECK"; constraint: string | undefined };

/** A business rule refused the operation in TypeScript rather than in Postgres. */
export class RuleError extends Error {
  constructor(
    readonly rule: string,
    detail: string,
  ) {
    super(`${rule}: ${detail}`);
    this.name = "RuleError";
  }
}

export function classifyDbError(error: unknown): DbFailure | null {
  if (error instanceof RuleError) return { kind: "RULE", rule: error.rule, message: error.message };
  if (!(error instanceof postgres.PostgresError)) return null;
  const rule = /^([A-Z][A-Z_]+):/.exec(error.message)?.[1];
  if (rule) return { kind: "RULE", rule, message: error.message };
  if (error.code === "42501" && /row-level security/.test(error.message)) return { kind: "ROW_LEVEL_SECURITY" };
  if (error.code === "23505") return { kind: "UNIQUE", constraint: error.constraint_name };
  if (error.code === "23503") return { kind: "FOREIGN_KEY", constraint: error.constraint_name };
  if (error.code === "23514") return { kind: "CHECK", constraint: error.constraint_name };
  return null;
}
