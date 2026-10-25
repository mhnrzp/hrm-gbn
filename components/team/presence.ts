import type { Tone } from "@/components/ui/primitives";

/** Figma «وضعیت حضور»: on approved leave today → مرخصی; otherwise the manager-set work mode. No tracking. */
export function presence(r: { status: string; on_leave_today: boolean; work_mode: string }): { label: string; tone: Tone } {
  if (r.status === "inactive") return { label: "غیرفعال", tone: "gray" };
  if (r.status === "invited") return { label: "دعوت‌شده", tone: "purple" };
  if (r.on_leave_today) return { label: "مرخصی", tone: "red" };
  return r.work_mode === "remote" ? { label: "دورکار", tone: "blue" } : { label: "حاضر", tone: "green" };
}
