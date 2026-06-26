import { NextResponse } from "next/server";
import { getOrganizationBySlug } from "@/features/identity-access/server/queries";
import { getIdentifierByCode } from "@/features/farm-structure/server/queries";
import { renderIdentifierSvg } from "@/features/farm-structure/server/render-label";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ organizationSlug: string; printableCode: string }> },
) {
  const { organizationSlug, printableCode } = await params;
  const org = await getOrganizationBySlug(organizationSlug);
  if (!org) return new NextResponse("Not found", { status: 404 });
  const identifier = await getIdentifierByCode(org.id, decodeURIComponent(printableCode));
  if (!identifier) return new NextResponse("Not found", { status: 404 });
  const svg = renderIdentifierSvg({
    identifier,
    organizationSlug,
    baseUrl: new URL(request.url).origin,
  });
  return new NextResponse(svg, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "private, no-store",
    },
  });
}
