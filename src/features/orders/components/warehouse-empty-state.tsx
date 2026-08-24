"use client";

import { useTranslations } from "next-intl";
import { HenEmptyState } from "@/components/shared/hen-empty-state";

/** Warehouse task screens' empty state: the sleeping hen with warehouse copy. */
export function WarehouseEmptyState({ className }: { className?: string }) {
  const t = useTranslations("warehouse.empty");
  return <HenEmptyState title={t("title")} subtitle={t("subtitle")} className={className} />;
}
