import { notFound } from "next/navigation";
import { OrderPermissionError } from "@/features/orders/server/guards";
import { requirePermission } from "@/lib/auth/require-permission";
import { DataConsoleClient } from "./data-console-client";

export default async function DataConsolePage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;
  try {
    await requirePermission(organizationSlug, "data_console.manage", "use");
  } catch (e) {
    if (e instanceof OrderPermissionError) notFound();
    throw e;
  }
  return <DataConsoleClient organizationSlug={organizationSlug} />;
}
