import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

/** The signed-in Supabase Auth user. Identity only: roles come from the database. */
export interface AuthUser {
  userId: string;
  email: string | null;
}

export type VerifyToken = (token: string) => Promise<AuthUser | null>;

/**
 * Verifies Supabase access tokens against the project's published signing keys
 * (asymmetric ES256/RS256, `<url>/auth/v1/.well-known/jwks.json`). Checks signature,
 * expiry, issuer and audience. Never reads authorization data from the token:
 * `user_metadata` is user-editable, and roles are resolved per request from
 * app.staff_members.
 *
 * A deleted or signed-out user's token stays valid until it expires (jwt_expiry in
 * supabase/config.toml), which is why every tenant request re-checks the staff row.
 */
export function supabaseVerifier(options: { supabaseUrl: string; keys?: JWTVerifyGetKey }): VerifyToken {
  const issuer = `${options.supabaseUrl.replace(/\/$/, "")}/auth/v1`;
  const keys = options.keys ?? createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
  return async (token) => {
    try {
      const { payload } = await jwtVerify(token, keys, {
        issuer,
        audience: "authenticated",
        algorithms: ["ES256", "RS256"],
      });
      if (typeof payload.sub !== "string" || payload.role !== "authenticated") return null;
      return { userId: payload.sub, email: typeof payload.email === "string" ? payload.email : null };
    } catch {
      return null;
    }
  };
}
