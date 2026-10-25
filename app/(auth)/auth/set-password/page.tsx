"use client";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Alert, Button } from "@/components/ui/primitives";
import { TextField } from "@/components/ui/controls";
import { createClient } from "@/lib/supabase/browser";

const MIN_LENGTH = 8;

// Reached from invite / recovery emails (after /auth/confirm created a session).
export default function SetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (password.length < MIN_LENGTH) return setError("رمز عبور باید حداقل ۸ نویسه باشد.");
    if (password !== confirm) return setError("تکرار رمز عبور یکسان نیست.");
    setPending(true);
    setError(null);
    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setPending(false);
      return setError(updateError.code === "same_password" ? "رمز جدید باید با رمز قبلی متفاوت باشد." : "لینک منقضی شده است. دوباره درخواست دهید.");
    }
    // Activates an invited membership; returns the active one if already accepted.
    const { error: acceptError } = await supabase.rpc("accept_invitation");
    setPending(false);
    if (acceptError?.message === "INVITATION_EXPIRED") return setError("مهلت این دعوت‌نامه تمام شده است. از مدیر بخواهید دوباره دعوت کند.");
    router.replace("/");
    router.refresh();
  }

  return (
    <>
      <div>
        <h1 className="text-xl font-bold leading-[1.8]">تعیین رمز عبور</h1>
        <p className="text-xs leading-[1.8] text-muted">برای ورود به GBN HRM یک رمز عبور انتخاب کنید.</p>
      </div>
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        {error && <Alert title={error} />}
        <TextField label="رمز عبور جدید" type="password" dir="ltr" autoComplete="new-password" required minLength={MIN_LENGTH} value={password} onChange={(e) => setPassword(e.target.value)} />
        <TextField label="تکرار رمز عبور" type="password" dir="ltr" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        <Button type="submit" disabled={pending}>
          {pending ? "در حال ذخیره..." : "ذخیره و ورود"}
        </Button>
      </form>
    </>
  );
}
