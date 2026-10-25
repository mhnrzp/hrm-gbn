import Link from "next/link";
import { Alert } from "@/components/ui/primitives";

export default function LinkInvalidPage() {
  return (
    <>
      <Alert title="لینک نامعتبر یا منقضی است">لینک‌های دعوت و بازیابی فقط یک‌بار و برای مدت محدود معتبرند.</Alert>
      <Link href="/auth/forgot" className="text-xs font-bold text-brand">
        درخواست لینک جدید
      </Link>
    </>
  );
}
