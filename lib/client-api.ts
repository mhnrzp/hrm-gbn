// Browser-side helper for /api/v1 calls: returns `data` or throws ApiError with the Persian message.
export class ApiError extends Error {
  constructor(
    public code: string,
    public messageFa: string,
    public details: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

export async function api<T = unknown>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method: init?.method ?? (init?.body !== undefined ? "POST" : "GET"),
      headers: init?.body !== undefined ? { "content-type": "application/json" } : undefined,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new ApiError("NETWORK", "اتصال به سرور برقرار نشد. اتصال شبکه را بررسی کنید.");
  }
  const json = await res.json().catch(() => null);
  if (!res.ok || !json || "error" in json) {
    const err = json?.error;
    throw new ApiError(err?.code ?? "INTERNAL", err?.message_fa ?? "خطای غیرمنتظره‌ای رخ داد.", err?.details ?? {});
  }
  return json.data as T;
}

/** First field-level validation message, if the server returned one. */
export function fieldError(err: unknown, field: string): string | undefined {
  if (!(err instanceof ApiError)) return undefined;
  const fields = err.details.fields as { path: string; message: string }[] | undefined;
  return fields?.find((f) => f.path === field)?.message;
}
