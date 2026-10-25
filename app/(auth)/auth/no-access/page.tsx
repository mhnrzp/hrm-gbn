import { Alert, Button } from "@/components/ui/primitives";

export default function NoAccessPage() {
  return (
    <>
      <Alert tone="amber" title="دسترسی فعالی ندارید">
        حساب شما به مجموعه فعالی متصل نیست یا غیرفعال شده است. با مدیر مجموعه تماس بگیرید.
      </Alert>
      <form action="/auth/sign-out" method="post">
        <Button type="submit" variant="secondary" className="w-full">
          خروج از حساب
        </Button>
      </form>
    </>
  );
}
