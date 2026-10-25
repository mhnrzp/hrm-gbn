import { LoginForm } from "./login-form";

export const metadata = { title: "ورود | GBN HRM" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next } = await searchParams;
  const safeNext = typeof next === "string" && next.startsWith("/") && !next.startsWith("//") ? next : "/";
  return (
    <>
      <div>
        <h1 className="text-xl font-bold leading-[1.8]">ورود به حساب کاربری</h1>
        <p className="text-xs leading-[1.8] text-muted">با ایمیل و رمز عبوری که هنگام دعوت تعیین کرده‌اید وارد شوید.</p>
      </div>
      <LoginForm next={safeNext} />
    </>
  );
}
