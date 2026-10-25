import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export const AVATAR_BUCKET = "avatars";
const SIGNED_URL_SECONDS = 60 * 10;

/** Short-lived signed URL for a private avatar (null when unset or not permitted). */
export async function avatarUrl(db: SupabaseClient, path: string | null): Promise<string | null> {
  if (!path) return null;
  const { data } = await db.storage.from(AVATAR_BUCKET).createSignedUrl(path, SIGNED_URL_SECONDS);
  return data?.signedUrl ?? null;
}

export async function avatarUrls(db: SupabaseClient, paths: (string | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(paths.filter((p): p is string => !!p))];
  const map = new Map<string, string>();
  if (unique.length === 0) return map;
  const { data } = await db.storage.from(AVATAR_BUCKET).createSignedUrls(unique, SIGNED_URL_SECONDS);
  data?.forEach((d) => d.path && d.signedUrl && map.set(d.path, d.signedUrl));
  return map;
}
