import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const variantIdsParam = searchParams.get("variantIds");

  if (!variantIdsParam) {
    return NextResponse.json({ error: "Missing variantIds" }, { status: 400 });
  }

  const variantIds = variantIdsParam.split(",").filter(Boolean);

  if (variantIds.length === 0) {
    return NextResponse.json({ variants: [] });
  }

  const supabase = await createSupabaseServerClient();

  const { data: variants, error } = await supabase
    .from("product_variants")
    .select(
      `
      *,
      product:products(id, name, image_url)
    `,
    )
    .in("id", variantIds)
    .eq("is_available", true);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ variants: variants || [] });
}
