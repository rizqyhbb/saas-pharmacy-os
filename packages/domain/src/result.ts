/**
 * Expected business outcomes (insufficient stock, illegal transition, a unit
 * conversion that would need rounding) are returned as values so callers have
 * to handle them. Malformed input and programmer errors throw.
 */
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export const ok = <T>(value: T): { ok: true; value: T } => ({ ok: true, value });
export const err = <E>(error: E): { ok: false; error: E } => ({ ok: false, error });
