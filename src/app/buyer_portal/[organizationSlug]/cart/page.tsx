"use client";

import { useEffect, useState } from "react";
import { CartView } from "@/features/buyer/components/cart-view";

type CartPageProps = { params: Promise<{ organizationSlug: string }> };

export default function CartPage({ params }: CartPageProps) {
  const [organizationSlug, setOrganizationSlug] = useState("");
  useEffect(() => {
    params.then((p) => setOrganizationSlug(p.organizationSlug));
  }, [params]);

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="font-buyer-display mb-8 text-3xl font-bold">Troli Anda</h1>
      {organizationSlug && <CartView organizationSlug={organizationSlug} />}
    </div>
  );
}
