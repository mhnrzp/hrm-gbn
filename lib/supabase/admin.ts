import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Service-role client: bypasses RLS. Only call after an explicit server-side permission check
 * (requireManager) — used for auth admin operations such as invitations.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) throw new Error("SUPABASE_SECRET_KEY missing: see .env.example");
  return createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
}
