"use client";

import { useTranslations } from "next-intl";

type AvailabilitySwitchProps = {
  available: boolean;
  onToggle: () => void;
  label: string;
  disabled?: boolean;
  id?: string;
};

/** One-tap sold-out toggle for a variant row. */
export function AvailabilitySwitch({
  available,
  onToggle,
  label,
  disabled,
  id,
}: AvailabilitySwitchProps) {
  const t = useTranslations("seller.products.availabilitySwitch");
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={available}
      aria-label={t("statusAriaLabel", {
        label,
        status: available ? t("available") : t("soldOut"),
      })}
      disabled={disabled}
      onClick={onToggle}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors duration-200 disabled:opacity-50 ${
        available ? "bg-green-600" : "bg-muted-foreground/30"
      }`}
    >
      {/* Thumb slides via transform so the 200ms move stays off the main thread */}
      <span
        className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform duration-200 ease-out ${
          available ? "translate-x-4" : "translate-x-0"
        }`}
      />
    </button>
  );
}
