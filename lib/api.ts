import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError, type ZodType } from "zod";
import { AppError, ERRORS, fromDbError } from "@/lib/errors";
import { requireManager, requireMember, type Member } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { rateLimit } from "@/lib/rate-limit";

type Db = Awaited<ReturnType<typeof createClient>>;

export type ApiContext = { req: NextRequest; requestId: string; member: Member; db: Db };

type Access = "member" | "manager";

function newRequestId() {
  return `req_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

function errorResponse(err: unknown, requestId: string) {
  let appErr: AppError;
  if (err instanceof AppError) appErr = err;
  else if (err instanceof ZodError) {
    appErr = new AppError("VALIDATION_FAILED", {
      fields: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
  } else if (err && typeof err === "object" && "code" in err) appErr = fromDbError(err as { code: string });
  else appErr = new AppError("INTERNAL");

  if (appErr.status >= 500) {
    // Structured, non-sensitive log line; never the request body.
    console.error(JSON.stringify({ level: "error", requestId, code: appErr.code, error: err instanceof Error ? err.message : String(err) }));
  }
  const retry = appErr.code === "RATE_LIMITED" ? { "retry-after": String(appErr.details?.retry_after_seconds ?? 60) } : undefined;
  return NextResponse.json(
    { error: { code: appErr.code, message_fa: ERRORS[appErr.code].fa, details: appErr.details ?? {} }, meta: { request_id: requestId } },
    { status: appErr.status, headers: retry },
  );
}

/** Reject cross-site cookie-authenticated mutations (CSRF): Origin must match this host. */
function assertSameOrigin(req: NextRequest) {
  if (req.method === "GET" || req.method === "HEAD") return;
  const origin = req.headers.get("origin");
  if (!origin) return; // non-browser clients; cookies are SameSite=Lax anyway
  if (new URL(origin).host !== req.headers.get("host")) throw new AppError("FORBIDDEN", { reason: "origin" });
}

/**
 * Route handler wrapper: request id, CSRF origin check, authentication from current membership,
 * role gate, uniform `{data, meta}` / `{error, meta}` envelopes.
 */
export function route<P extends Record<string, string> = Record<string, never>>(
  access: Access,
  handler: (ctx: ApiContext & { params: P }) => Promise<unknown>,
) {
  return async (req: NextRequest, context: { params: Promise<P> }) => {
    const requestId = newRequestId();
    try {
      assertSameOrigin(req);
      const member = access === "manager" ? await requireManager(requestId) : await requireMember(requestId);
      // 120 writes / 600 reads per user per minute per instance.
      rateLimit(`${member.userId}:${req.method === "GET" ? "r" : "w"}`, req.method === "GET" ? 600 : 120);
      const db = await createClient(requestId);
      const params = (await context?.params) ?? ({} as P);
      const result = await handler({ req, requestId, member, db, params });
      if (result instanceof Response) return result;
      return NextResponse.json({ data: result ?? null, meta: { request_id: requestId } });
    } catch (err) {
      return errorResponse(err, requestId);
    }
  };
}

export async function parseBody<T>(req: NextRequest, schema: ZodType<T>): Promise<T> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    throw new AppError("BAD_REQUEST", { reason: "invalid_json" });
  }
  return schema.parse(json);
}

/** Like parseBody, but an empty body is treated as `{}`. */
export async function parseOptionalBody<T>(req: NextRequest, schema: ZodType<T>): Promise<T> {
  const raw = await req.text();
  if (!raw.trim()) return schema.parse({});
  try {
    return schema.parse(JSON.parse(raw));
  } catch (err) {
    if (err instanceof SyntaxError) throw new AppError("BAD_REQUEST", { reason: "invalid_json" });
    throw err;
  }
}

export function parseQuery<T>(req: NextRequest, schema: ZodType<T>): T {
  return schema.parse(Object.fromEntries(req.nextUrl.searchParams));
}
