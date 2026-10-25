import { route } from "@/lib/api";
import { listAuditLogs } from "@/lib/services/settings";
import { listNotifications } from "@/lib/services/notifications";

// Managers: redacted audit trail. Employees: their own notification history.
export const GET = route("member", async ({ db, member }) =>
  member.role === "manager"
    ? { kind: "audit", items: (await listAuditLogs(db, { limit: 20 })).items }
    : { kind: "notifications", items: (await listNotifications(db, member.userId, { limit: 20 })).items },
);
