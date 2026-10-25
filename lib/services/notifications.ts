import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, unwrap } from "@/lib/errors";
import type { NotificationRow } from "@/lib/notification-text";

const COLS = "id, type, entity_type, entity_id, title_key, message_data, is_read, created_at";

export async function listNotifications(db: SupabaseClient, userId: string, opts: { unreadOnly?: boolean; limit: number; cursor?: string }) {
  let q = db.from("notifications").select(COLS).eq("recipient_user_id", userId).order("created_at", { ascending: false }).limit(opts.limit + 1);
  if (opts.unreadOnly) q = q.eq("is_read", false);
  if (opts.cursor) q = q.lt("created_at", opts.cursor);
  const rows = unwrap(await q) as NotificationRow[];
  const items = rows.slice(0, opts.limit);
  const { count } = await db.from("notifications").select("id", { count: "exact", head: true }).eq("recipient_user_id", userId).eq("is_read", false);
  return { items, unread_count: count ?? 0, next_cursor: rows.length > opts.limit ? items[items.length - 1].created_at : null };
}

export async function markRead(db: SupabaseClient, userId: string, id: string) {
  const rows = unwrap(await db.from("notifications").update({ is_read: true }).eq("id", id).eq("recipient_user_id", userId).select("id"));
  if (!rows?.length) throw new AppError("NOT_FOUND");
  return { id, is_read: true };
}

export async function markAllRead(db: SupabaseClient, userId: string) {
  const rows = unwrap(await db.from("notifications").update({ is_read: true }).eq("recipient_user_id", userId).eq("is_read", false).select("id"));
  return { updated: rows?.length ?? 0 };
}
