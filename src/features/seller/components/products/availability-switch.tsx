"use client";

type AvailabilitySwitchProps = {
  available: boolean;
  onToggle: () => void;
  label: string;
  disabled?: boolean;
};

/** One-tap sold-out toggle for a variant row. */
export function AvailabilitySwitch({
  available,
  onToggle,
  label,
  disabled,
}: AvailabilitySwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={available}
      aria-label={`${label}: ${available ? "available" : "sold out"}`}
      disabled={disabled}
      onClick={onToggle}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
        available ? "bg-green-600" : "bg-muted-foreground/30"
      }`}
    >
      <span
        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-[left] duration-200 ${
          available ? "left-[18px]" : "left-0.5"
        }`}
      />
    </button>
  );
}
