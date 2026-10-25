import { notFound } from "next/navigation";
import { UiKitPreview } from "./preview";

// Development-only visual check of the UI kit against Figma board 1:77. Never served in production.
export default function DevUiPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <UiKitPreview />;
}
