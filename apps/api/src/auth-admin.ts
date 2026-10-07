/**
 * The few Supabase Auth admin calls the API makes. Uses the project's secret key,
 * which stays on the server: it is read from the environment and never sent to a
 * client (CLAUDE.md, Supabase security checklist).
 */
export interface AuthAdmin {
  /** Creates the account and emails an invitation link. Returns the new user's id. */
  inviteUser(email: string): Promise<{ userId: string }>;
}

export function supabaseAuthAdmin(options: { supabaseUrl: string; secretKey: string; redirectTo?: string }): AuthAdmin {
  const base = options.supabaseUrl.replace(/\/$/, "");
  return {
    async inviteUser(email) {
      const response = await fetch(`${base}/auth/v1/invite`, {
        method: "POST",
        headers: { apikey: options.secretKey, "content-type": "application/json" },
        body: JSON.stringify({ email, ...(options.redirectTo ? { redirect_to: options.redirectTo } : {}) }),
      });
      if (!response.ok) throw new Error(`Supabase invite failed with HTTP ${response.status}`);
      const user = (await response.json()) as { id?: string };
      if (!user.id) throw new Error("Supabase invite returned no user id");
      return { userId: user.id };
    },
  };
}
