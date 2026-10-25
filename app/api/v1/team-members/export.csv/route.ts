import { route } from "@/lib/api";
import { teamDirectory } from "@/lib/services/team";
import { csvResponse, toCsv } from "@/lib/csv";
import { faDigits, formatDate } from "@/lib/format";
import { ROLE_LABEL } from "@/lib/labels";

// «خروجی اطلاعات» — managers only; includes contact data they are already allowed to see.
export const GET = route("manager", async ({ db }) => {
  const rows = await teamDirectory(db, true);
  const status = (r: (typeof rows)[number]) =>
    r.status === "inactive" ? "غیرفعال" : r.status === "invited" ? "دعوت‌شده" : r.on_leave_today ? "مرخصی" : r.work_mode === "remote" ? "دورکار" : "حاضر";
  return csvResponse(
    "team.csv",
    toCsv(
      ["نام و نام خانوادگی", "سمت", "سطح دسترسی", "وضعیت", "ایمیل", "شماره موبایل", "تاریخ شروع همکاری", "تسک‌های فعال"],
      rows.map((r) => [r.full_name, r.job_title, ROLE_LABEL[r.role], status(r), r.email ?? "", r.phone ? faDigits(r.phone) : "", r.joined_at ? formatDate(r.joined_at, "UTC") : "", r.active_task_count ?? ""]),
    ),
  );
});
