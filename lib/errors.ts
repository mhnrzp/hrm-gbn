// Typed application errors + Persian messages. Database functions raise the same codes (app.fail).

export const ERRORS = {
  BAD_REQUEST: { status: 400, fa: "درخواست نامعتبر است." },
  UNAUTHENTICATED: { status: 401, fa: "ابتدا وارد حساب کاربری شوید." },
  FORBIDDEN: { status: 403, fa: "اجازه انجام این کار را ندارید." },
  NOT_FOUND: { status: 404, fa: "مورد درخواستی پیدا نشد." },
  CONFLICT: { status: 409, fa: "این تغییر با داده‌های فعلی تداخل دارد. صفحه را تازه کنید." },
  VALIDATION_FAILED: { status: 422, fa: "اطلاعات واردشده معتبر نیست." },
  RATE_LIMITED: { status: 429, fa: "تعداد درخواست‌ها زیاد است. کمی بعد دوباره تلاش کنید." },
  INTERNAL: { status: 500, fa: "خطای غیرمنتظره‌ای رخ داد. دوباره تلاش کنید." },

  MEMBER_INACTIVE: { status: 409, fa: "این عضو فعال نیست." },
  MEMBER_EXISTS: { status: 409, fa: "این کاربر قبلاً عضو مجموعه است." },
  LAST_MANAGER: { status: 409, fa: "مجموعه باید حداقل یک مدیر فعال داشته باشد." },
  INVITATION_INVALID: { status: 400, fa: "دعوت‌نامه معتبر نیست." },
  INVITATION_EXPIRED: { status: 410, fa: "مهلت این دعوت‌نامه تمام شده است. از مدیر بخواهید دوباره دعوت کند." },
  INVALID_TIMEZONE: { status: 422, fa: "منطقه زمانی معتبر نیست." },
  INVALID_AMOUNT: { status: 422, fa: "مبلغ معتبر نیست." },

  TASK_ALREADY_CLAIMED: { status: 409, fa: "این تسک قبلاً توسط عضو دیگری برداشته شده است." },
  TASK_NOT_ASSIGNED: { status: 403, fa: "این تسک به شما اختصاص داده نشده است." },
  TASK_ARCHIVED: { status: 409, fa: "این تسک بایگانی شده است." },
  TASK_CLOSED: { status: 409, fa: "این تسک تکمیل یا لغو شده است." },

  LEAVE_ALREADY_REVIEWED: { status: 409, fa: "این درخواست قبلاً بررسی شده است." },
  LEAVE_NOT_PENDING: { status: 409, fa: "فقط درخواست‌های در انتظار قابل تغییر هستند." },
  LEAVE_OVERLAP: { status: 409, fa: "این بازه با مرخصی تأییدشده دیگری هم‌پوشانی دارد." },
  LEAVE_TASK_CONFLICT: { status: 409, fa: "این بازه با تسک‌های برنامه‌ریزی‌شده تداخل دارد." },
  CALENDAR_RANGE_TOO_LARGE: { status: 422, fa: "حداکثر بازه قابل نمایش ۹۰ روز است." },

  INVOICE_ALREADY_PAID: { status: 409, fa: "این صورت‌حساب قبلاً پرداخت شده است." },
  INVOICE_NOT_PAID: { status: 409, fa: "این صورت‌حساب پرداخت‌نشده است." },
  INVOICE_CANCELLED: { status: 409, fa: "این صورت‌حساب لغو شده است." },
  AMOUNT_MISMATCH: { status: 422, fa: "مبلغ پرداخت باید با مبلغ صورت‌حساب برابر باشد." },

  FILE_TOO_LARGE: { status: 413, fa: "حجم فایل بیش از حد مجاز است." },
  FILE_TYPE_NOT_ALLOWED: { status: 415, fa: "نوع فایل مجاز نیست." },
} as const;

export type ErrorCode = keyof typeof ERRORS;

export class AppError extends Error {
  constructor(
    public code: ErrorCode,
    public details?: Record<string, unknown>,
  ) {
    super(code);
  }
  get status() {
    return ERRORS[this.code].status;
  }
}

export function isErrorCode(value: string): value is ErrorCode {
  return value in ERRORS;
}

type PgLikeError = { code?: string; message?: string; details?: string | null };

/** Map a PostgREST / Postgres error into an AppError without leaking SQL. */
export function fromDbError(err: PgLikeError): AppError {
  if (err.code === "P0001" && err.message && isErrorCode(err.message)) {
    let details: Record<string, unknown> | undefined;
    try {
      details = err.details ? JSON.parse(err.details) : undefined;
    } catch {
      details = undefined;
    }
    return new AppError(err.message, details);
  }
  switch (err.code) {
    case "PGRST116":
      return new AppError("NOT_FOUND");
    case "23505":
    case "40001":
      return new AppError("CONFLICT");
    case "23P01":
      return new AppError("LEAVE_OVERLAP");
    case "23514":
    case "23502":
    case "22P02":
    case "22007":
    case "22008":
      return new AppError("VALIDATION_FAILED");
    case "23503":
      return new AppError("VALIDATION_FAILED", { reason: "reference" });
    case "42501":
      return new AppError("FORBIDDEN");
    default:
      return new AppError("INTERNAL");
  }
}

/** Throw if a Supabase call failed; otherwise return its data. */
export function unwrap<T>(result: { data: T; error: PgLikeError | null }): T {
  if (result.error) throw fromDbError(result.error);
  return result.data;
}
