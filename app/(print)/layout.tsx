// Bare layout for printable documents (receipts): no app shell, white page.
export default function PrintLayout({ children }: LayoutProps<"/">) {
  return <main className="min-h-dvh bg-white p-6 print:p-0">{children}</main>;
}
