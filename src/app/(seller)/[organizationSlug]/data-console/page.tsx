import { notFound } from "next/navigation";
import { OrderPermissionError, requireOrgRole } from "@/features/orders/server/guards";
import { DataConsoleClient } from "./data-console-client";

export default async function DataConsolePage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;
  try {
    await requireOrgRole(organizationSlug, ["owner"]);
  } catch (e) {
    if (e instanceof OrderPermissionError) notFound();
    throw e;
  }
  return <DataConsoleClient organizationSlug={organizationSlug} />;
}
