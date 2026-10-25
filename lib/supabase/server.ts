import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export function supabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Supabase env vars missing: see .env.example");
  return { url, key };
}

/** Per-request client carrying the signed-in user's session, so RLS applies to every query. */
export async function createClient(requestId?: string) {
  const { url, key } = supabaseEnv();
  const cookieStore = await cookies();
  return createServerClient(url, key, {
    global: requestId ? { headers: { "x-request-id": requestId } } : undefined,
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => {
        try {
          toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server Components cannot set cookies; proxy.ts refreshes the session instead.
        }
      },
    },
  });
}
