"use client";

import { Scale, Bird, BadgeCheck } from "lucide-react";
import { BuyerSheet } from "./buyer-sheet";
import { markExplainerSeen } from "@/features/buyer/lib/explainer-flag";

const FRAMES = [
  { icon: Bird, title: "Anda pilih ayam", body: "Pilih saiz dan cara potong yang anda mahu." },
  { icon: Scale, title: "Kami timbang bila sedia", body: "Setiap ekor ditimbang betul-betul sebelum dihantar." },
  { icon: BadgeCheck, title: "Harga ikut berat sebenar", body: "Harga akhir = berat sebenar × harga/kg. Tanda ~ maksudnya anggaran." },
] as const;

export function PricingExplainerSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const close = (next: boolean) => {
    if (!next) markExplainerSeen(window.localStorage);
    onOpenChange(next);
  };

  return (
    <BuyerSheet open={open} onOpenChange={close} title="Kenapa harga anggaran?">
      <div className="space-y-4">
        {FRAMES.map((f) => (
          <div key={f.title} className="flex items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary">
              <f.icon className="h-4.5 w-4.5" />
            </span>
            <div>
              <p className="font-medium">{f.title}</p>
              <p className="text-sm text-muted-foreground">{f.body}</p>
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={() => close(false)}
          className="mt-2 w-full rounded-full bg-primary py-3 font-medium text-primary-foreground transition-transform active:scale-[0.97]"
        >
          Faham!
        </button>
      </div>
    </BuyerSheet>
  );
}
