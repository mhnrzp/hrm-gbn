import { route } from "@/lib/api";

// Current user, active role and safe organisation settings.
export const GET = route("member", async ({ member }) => ({
  user_id: member.userId,
  membership_id: member.membershipId,
  full_name: member.fullName,
  job_title: member.jobTitle,
  role: member.role,
  organization: {
    id: member.orgId,
    name: member.org.name,
    timezone: member.org.timezone,
    week_start: member.org.weekStart,
    weekend_days: member.org.weekendDays,
    locale: "fa-IR",
    display_currency_unit: "toman",
  },
}));
