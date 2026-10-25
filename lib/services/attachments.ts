import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { AppError, unwrap } from "@/lib/errors";

const BUCKET = "attachments";
const DOWNLOAD_SECONDS = 60;

/**
 * Permission is checked in the database (prepare_attachment / attachment_path run as the caller);
 * only after that does the server use the service role to sign a short-lived URL for that exact path.
 */
export async function prepareUpload(db: SupabaseClient, input: { entity_type: string; entity_id: string; file_name: string; mime_type: string; size_bytes: number }) {
  const slot = unwrap(
    await db.rpc("prepare_attachment", { p_type: input.entity_type, p_id: input.entity_id, p_file_name: input.file_name, p_mime: input.mime_type, p_size: input.size_bytes }),
  ) as { attachment_id: string; storage_path: string };
  const { data, error } = await createAdminClient().storage.from(BUCKET).createSignedUploadUrl(slot.storage_path);
  if (error || !data) throw new AppError("INTERNAL", { reason: "sign_upload" });
  return { attachment_id: slot.attachment_id, upload_url: data.signedUrl, token: data.token, path: slot.storage_path };
}

export async function downloadUrl(db: SupabaseClient, attachmentId: string) {
  const path = unwrap(await db.rpc("attachment_path", { p_id: attachmentId })) as string;
  const { data, error } = await createAdminClient().storage.from(BUCKET).createSignedUrl(path, DOWNLOAD_SECONDS, { download: true });
  if (error || !data) throw new AppError("NOT_FOUND");
  return { url: data.signedUrl, expires_in: DOWNLOAD_SECONDS };
}

export async function listAttachments(db: SupabaseClient, entityType: string, entityId: string) {
  return unwrap(
    await db
      .from("attachments")
      .select("id, file_name, mime_type, size_bytes, created_at, uploaded_by")
      .eq("owner_entity_type", entityType)
      .eq("owner_entity_id", entityId)
      .order("created_at"),
  );
}

export async function deleteAttachment(db: SupabaseClient, id: string) {
  unwrap(await db.rpc("delete_attachment", { p_id: id }));
  return { id, deleted: true };
}
