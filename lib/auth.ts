import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppError } from "@/lib/errors";

export type Role = "manager" | "employee";

export type Member = {
  userId: string;
  membershipId: string;
  orgId: string;
  role: Role;
  fullName: string;
  avatarPath: string | null;
  jobTitle: string;
  org: { name: string; timezone: string; weekStart: number; weekendDays: number[] };
};

type MembershipRow = {
  id: string;
  organization_id: string;
  role: Role;
  job_title: string;
  organizations: { name: string; timezone: string; week_start: number; weekend_days: number[] } | null;
  profiles: { full_name: string; avatar_path: string | null } | null;
};

/**
 * Current user + their active membership, read fresh from the database on every request
 * (never from stale JWT claims), so deactivation takes effect immediately (AUTH-04).
 */
export const getMember = cache(async (requestId?: string): Promise<{ member: Member | null; signedIn: boolean }> => {
  const db = await createClient(requestId);
  const { data: claims } = await db.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return { member: null, signedIn: false };

  const { data } = await db
    .from("organization_memberships")
    .select("id, organization_id, role, job_title, organizations(name, timezone, week_start, weekend_days), profiles!organization_memberships_user_id_fkey(full_name, avatar_path)")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("created_at")
    .limit(1)
    .maybeSingle<MembershipRow>();

  if (!data?.organizations) return { member: null, signedIn: true };
  return {
    signedIn: true,
    member: {
      userId,
      membershipId: data.id,
      orgId: data.organization_id,
      role: data.role,
      jobTitle: data.job_title,
      fullName: data.profiles?.full_name ?? "",
      avatarPath: data.profiles?.avatar_path ?? null,
      org: {
        name: data.organizations.name,
        timezone: data.organizations.timezone,
        weekStart: data.organizations.week_start,
        weekendDays: data.organizations.weekend_days,
      },
    },
  };
});

/** Pages: redirect when signed out or without an active membership. */
export async function requirePageMember(opts?: { manager?: boolean }): Promise<Member> {
  const { member, signedIn } = await getMember();
  if (!signedIn) redirect("/login");
  if (!member) redirect("/auth/no-access");
  if (opts?.manager && member.role !== "manager") redirect("/");
  return member;
}

/** API routes / services: throw typed errors instead of redirecting. */
export async function requireMember(requestId?: string): Promise<Member> {
  const { member, signedIn } = await getMember(requestId);
  if (!signedIn) throw new AppError("UNAUTHENTICATED");
  if (!member) throw new AppError("FORBIDDEN");
  return member;
}

export async function requireManager(requestId?: string): Promise<Member> {
  const member = await requireMember(requestId);
  if (member.role !== "manager") throw new AppError("FORBIDDEN");
  return member;
}
