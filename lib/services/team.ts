import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { AppError, unwrap } from "@/lib/errors";
import type { Member } from "@/lib/auth";
import type { InviteMemberInput } from "@/lib/validation/team";

export type MemberOption = { user_id: string; full_name: string; job_title: string; role: "manager" | "employee"; avatar_path: string | null };

/** Active members for assignee / filter dropdowns (public directory fields only). */
export async function listMemberOptions(db: SupabaseClient, orgId: string): Promise<MemberOption[]> {
  const rows = unwrap(
    await db
      .from("organization_memberships")
      .select("user_id, job_title, role, profiles!organization_memberships_user_id_fkey(full_name, avatar_path)")
      .eq("organization_id", orgId)
      .eq("status", "active"),
  ) as unknown as { user_id: string; job_title: string; role: "manager" | "employee"; profiles: { full_name: string; avatar_path: string | null } | null }[];
  return rows
    .map((r) => ({ user_id: r.user_id, job_title: r.job_title, role: r.role, full_name: r.profiles?.full_name ?? "", avatar_path: r.profiles?.avatar_path ?? null }))
    .sort((a, b) => a.full_name.localeCompare(b.full_name, "fa"));
}

function siteUrl() {
  return process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
}

/**
 * Invite a team member (manager only — caller must already be verified with requireManager).
 * Auth user creation needs the service role; membership rows are written by a single RPC transaction.
 */
export async function inviteMember(manager: Member, input: InviteMemberInput) {
  const admin = createAdminClient();

  // Reuse an existing auth user with this email (e.g. re-invite after an earlier failed attempt).
  const existing = unwrap(await admin.from("profile_private").select("user_id").eq("email", input.email).maybeSingle());
  let userId = existing?.user_id as string | undefined;

  if (!userId) {
    if (input.send_email) {
      const { data, error } = await admin.auth.admin.inviteUserByEmail(input.email, {
        data: { full_name: input.full_name },
        redirectTo: `${siteUrl()}/auth/set-password`,
      });
      if (error || !data.user) throw new AppError(error?.status === 429 ? "RATE_LIMITED" : "INTERNAL", { reason: "invite_failed" });
      userId = data.user.id;
    } else {
      const { data, error } = await admin.auth.admin.createUser({ email: input.email, email_confirm: true, user_metadata: { full_name: input.full_name } });
      if (error || !data.user) throw new AppError("INTERNAL", { reason: "create_user_failed" });
      userId = data.user.id;
    }
  } else if (input.send_email) {
    // ponytail: existing auth user gets a "set your password" (recovery) email instead of a second invite.
    await admin.auth.resetPasswordForEmail(input.email, { redirectTo: `${siteUrl()}/auth/set-password` });
  }

  // If this fails after the auth user was created, the user stays membership-less and a retry reuses it.
  const membershipId = unwrap(
    await admin.rpc("register_invited_member", {
      p_org: manager.orgId,
      p_user: userId,
      p_invited_by: manager.userId,
      p_email: input.email,
      p_role: input.role,
      p_full_name: input.full_name,
      p_job_title: input.job_title,
      p_phone: input.phone,
      p_joined_at: input.joined_at ?? null,
      p_email_sent: input.send_email,
    }),
  ) as string;

  return { membership_id: membershipId, user_id: userId, status: "invited" as const, email_sent: input.send_email };
}

/** Re-send the set-password email to an invited member who has not accepted yet. */
export async function resendInvitation(manager: Member, membershipId: string) {
  const admin = createAdminClient();
  const membership = unwrap(
    await admin.from("organization_memberships").select("user_id, status, organization_id").eq("id", membershipId).maybeSingle(),
  );
  if (!membership || membership.organization_id !== manager.orgId) throw new AppError("NOT_FOUND");
  if (membership.status !== "invited") throw new AppError("CONFLICT", { reason: "not_invited" });
  const priv = unwrap(await admin.from("profile_private").select("email").eq("user_id", membership.user_id).maybeSingle());
  if (!priv) throw new AppError("NOT_FOUND");
  unwrap(
    await admin
      .from("invitations")
      .update({ expires_at: new Date(Date.now() + 7 * 864e5).toISOString(), email_sent: true })
      .eq("user_id", membership.user_id)
      .eq("organization_id", manager.orgId)
      .is("accepted_at", null),
  );
  const { error } = await admin.auth.resetPasswordForEmail(priv.email, { redirectTo: `${siteUrl()}/auth/set-password` });
  if (error) throw new AppError(error.status === 429 ? "RATE_LIMITED" : "INTERNAL", { reason: "email_failed" });
  return { membership_id: membershipId, email_sent: true };
}
