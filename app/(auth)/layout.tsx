// Auth screens are not in Figma; they reuse the Figma card, field and button primitives.
export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-app p-4">
      <div className="flex w-full max-w-[400px] flex-col gap-5 rounded-lg border border-line bg-card p-6">
        <p className="text-[22px] font-bold leading-[1.7] text-brand" dir="ltr" style={{ textAlign: "right" }}>
          GBN HRM
        </p>
        {children}
      </div>
    </main>
  );
}
