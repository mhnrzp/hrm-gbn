"use client";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Alert, Button } from "@/components/ui/primitives";
import { TextField } from "@/components/ui/controls";
import { createClient } from "@/lib/supabase/browser";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    await createClient().auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/auth/set-password` });
    // Same message whether or not the address exists (no account enumeration).
    setPending(false);
    setSent(true);
  }

  return (
    <>
      <div>
        <h1 className="text-xl font-bold leading-[1.8]">بازیابی رمز عبور</h1>
        <p className="text-xs leading-[1.8] text-muted">ایمیل حساب خود را وارد کنید تا لینک تعیین رمز جدید ارسال شود.</p>
      </div>
      {sent ? (
        <Alert tone="green" title="درخواست ثبت شد">
          اگر این ایمیل در سامانه ثبت شده باشد، لینک بازیابی تا چند دقیقه دیگر می‌رسد.
        </Alert>
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <TextField label="ایمیل" type="email" dir="ltr" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <Button type="submit" disabled={pending}>
            ارسال لینک بازیابی
          </Button>
        </form>
      )}
      <Link href="/login" className="text-xs font-bold text-brand">
        بازگشت به ورود
      </Link>
    </>
  );
}
