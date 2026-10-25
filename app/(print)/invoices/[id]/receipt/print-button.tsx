"use client";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/primitives";

export function PrintButton() {
  return (
    <Button icon={Printer} className="no-print self-start" onClick={() => window.print()}>
      چاپ یا ذخیره PDF
    </Button>
  );
}
