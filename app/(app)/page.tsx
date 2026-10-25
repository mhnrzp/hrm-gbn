import { PageTitle } from "@/components/ui/primitives";
import { requirePageMember } from "@/lib/auth";

// Dashboard widgets are wired in milestone 5; until then the page shows only its Figma header.
export default async function DashboardPage() {
  await requirePageMember();
  return <PageTitle title="داشبورد" subtitle="خلاصه وضعیت تیم" />;
}
