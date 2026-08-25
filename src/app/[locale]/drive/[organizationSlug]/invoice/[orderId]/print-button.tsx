"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Printer } from "lucide-react";

export function PrintButton() {
  const t = useTranslations("drive.invoice");
  return (
    <Button type="button" variant="outline" onClick={() => window.print()}>
      <Printer className="mr-2 h-4 w-4" />
      {t("printButton")}
    </Button>
  );
}
