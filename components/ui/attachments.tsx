"use client";
// Private attachments for invoices / tasks / leave: server checks permission, then issues 60s signed URLs.
import { useCallback, useEffect, useRef, useState } from "react";
import { Download, Paperclip, Trash2 } from "lucide-react";
import { Button } from "./primitives";
import { api, ApiError } from "@/lib/client-api";
import { createClient } from "@/lib/supabase/browser";
import { faNumber } from "@/lib/format";

type Attachment = { id: string; file_name: string; size_bytes: number; created_at: string };

export function Attachments({ entityType, entityId, canUpload = true }: { entityType: "invoice" | "task_occurrence" | "leave_request"; entityId: string; canUpload?: boolean }) {
  const [items, setItems] = useState<Attachment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    api<{ items: Attachment[] }>(`/attachments?entity_type=${entityType}&entity_id=${entityId}`)
      .then((r) => setItems(r.items))
      .catch(() => setItems([]));
  }, [entityType, entityId]);

  useEffect(() => {
    load();
  }, [load]);

  async function upload(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const slot = await api<{ path: string; token: string }>("/attachments/upload-url", {
        body: { entity_type: entityType, entity_id: entityId, file_name: file.name, mime_type: file.type || "application/octet-stream", size_bytes: file.size },
      });
      const { error: upErr } = await createClient().storage.from("attachments").uploadToSignedUrl(slot.path, slot.token, file, { contentType: file.type });
      if (upErr) throw new ApiError("INTERNAL", "بارگذاری فایل انجام نشد.");
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.messageFa : "بارگذاری فایل انجام نشد.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  async function download(id: string) {
    try {
      const { url } = await api<{ url: string }>(`/attachments/${id}/download-url`);
      window.open(url, "_blank", "noopener");
    } catch (e) {
      setError(e instanceof ApiError ? e.messageFa : "دریافت فایل انجام نشد.");
    }
  }

  async function remove(id: string) {
    if (!window.confirm("این پیوست حذف شود؟")) return;
    try {
      await api(`/attachments/${id}`, { method: "DELETE" });
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.messageFa : "حذف انجام نشد.");
    }
  }

  return (
    <div className="flex flex-col gap-2 border-t border-line pt-4">
      <div className="flex items-center justify-between">
        <h4 className="text-[13px] font-bold">پیوست‌ها</h4>
        {canUpload && (
          <>
            <input ref={input} type="file" className="hidden" accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.csv,.xlsx,.docx" onChange={(e) => upload(e.target.files?.[0])} />
            <Button variant="ghost" icon={Paperclip} disabled={busy} onClick={() => input.current?.click()}>
              {busy ? "در حال بارگذاری..." : "افزودن پیوست"}
            </Button>
          </>
        )}
      </div>
      {error && <p className="text-[11px] text-danger">{error}</p>}
      {items.length === 0 && <p className="text-[11px] text-muted">پیوستی ثبت نشده است.</p>}
      {items.map((a) => (
        <div key={a.id} className="flex items-center justify-between gap-2 rounded-ctl bg-app px-3 py-2 text-xs">
          <span className="truncate">{a.file_name}</span>
          <span className="flex shrink-0 items-center gap-2 text-muted">
            {faNumber(Math.max(1, Math.round(a.size_bytes / 1024)))} کیلوبایت
            <button type="button" aria-label={`دریافت ${a.file_name}`} onClick={() => download(a.id)} className="hover:text-brand">
              <Download size={14} />
            </button>
            {canUpload && (
              <button type="button" aria-label={`حذف ${a.file_name}`} onClick={() => remove(a.id)} className="hover:text-danger">
                <Trash2 size={14} />
              </button>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}
