"use client";
// Manager TOTP: enroll on first visit, otherwise verify. Raises the session to aal2.
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Alert, Button, LoadingState } from "@/components/ui/primitives";
import { TextField } from "@/components/ui/controls";
import { createClient } from "@/lib/supabase/browser";
import { toLatinDigits } from "@/lib/format";

type Enrollment = { factorId: string; qr: string; secret: string };

export default function MfaPage() {
  const router = useRouter();
  const [factorId, setFactorId] = useState<string | null>(null);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    (async () => {
      const { data } = await supabase.auth.mfa.listFactors();
      const verified = data?.totp.find((f) => f.status === "verified");
      if (verified) return setFactorId(verified.id);
      // Clean up half-finished enrollments, then start a fresh one.
      for (const f of data?.all ?? []) if (f.status !== "verified") await supabase.auth.mfa.unenroll({ factorId: f.id });
      const { data: enrolled, error: enrollError } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "GBN HRM" });
      if (enrollError || !enrolled) return setError("راه‌اندازی ورود دومرحله‌ای انجام نشد. دوباره وارد شوید.");
      setEnrollment({ factorId: enrolled.id, qr: enrolled.totp.qr_code, secret: enrolled.totp.secret });
      setFactorId(enrolled.id);
    })();
  }, []);

  async function verify(e: FormEvent) {
    e.preventDefault();
    if (!factorId) return;
    setPending(true);
    setError(null);
    const { error: verifyError } = await createClient().auth.mfa.challengeAndVerify({ factorId, code: toLatinDigits(code).trim() });
    setPending(false);
    if (verifyError) return setError("کد واردشده درست نیست یا منقضی شده است.");
    router.replace("/");
    router.refresh();
  }

  return (
    <>
      <div>
        <h1 className="text-xl font-bold leading-[1.8]">ورود دومرحله‌ای</h1>
        <p className="text-xs leading-[1.8] text-muted">برای حساب مدیر، کد شش‌رقمی برنامه احراز هویت (مانند Google Authenticator) لازم است.</p>
      </div>
      {error && <Alert title={error} />}
      {!factorId && !error && <LoadingState />}
      {enrollment && (
        <div className="flex flex-col items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- QR is an inline SVG data URL from Supabase */}
          <img src={enrollment.qr} alt="کد QR برای افزودن حساب به برنامه احراز هویت" className="size-44" />
          <p className="text-[11px] text-muted">یا این کلید را دستی وارد کنید:</p>
          <code className="ltr rounded-ctl bg-app px-2 py-1 text-xs">{enrollment.secret}</code>
        </div>
      )}
      {factorId && (
        <form onSubmit={verify} className="flex flex-col gap-3">
          <TextField label="کد شش‌رقمی" inputMode="numeric" autoComplete="one-time-code" dir="ltr" required maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} />
          <Button type="submit" disabled={pending || code.length < 6}>
            تأیید و ورود
          </Button>
        </form>
      )}
    </>
  );
}
