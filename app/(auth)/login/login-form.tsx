"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Alert, Button } from "@/components/ui/primitives";
import { TextField } from "@/components/ui/controls";
import { createClient } from "@/lib/supabase/browser";

export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const { error } = await createClient().auth.signInWithPassword({ email: email.trim(), password });
    setPending(false);
    if (error) {
      setError(error.status === 429 ? "تعداد تلاش‌ها زیاد است. چند دقیقه بعد دوباره تلاش کنید." : "ایمیل یا رمز عبور درست نیست.");
      return;
    }
    router.replace(next);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      {error && <Alert title={error} />}
      <TextField label="ایمیل" type="email" dir="ltr" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      <TextField label="رمز عبور" type="password" dir="ltr" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      <Button type="submit" disabled={pending}>
        {pending ? "در حال ورود..." : "ورود"}
      </Button>
      <Link href="/auth/forgot" className="text-xs font-bold text-brand">
        رمز عبور را فراموش کرده‌اید؟
      </Link>
    </form>
  );
}
