"use client";

type ViewButtonProps = {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  /** Extra layout classes — e.g. `flex-1` to split a toggle evenly across a phone row. */
  className?: string;
  /** Icon-only below `md`; the label stays available to screen readers. */
  compactLabel?: boolean;
};

export function ViewButton({
  active,
  onClick,
  icon,
  label,
  className = "",
  compactLabel = false,
}: ViewButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={compactLabel ? label : undefined}
      className={`inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors md:min-h-0 ${
        active
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground"
      } ${className}`}
    >
      {icon}
      <span className={compactLabel ? "hidden md:inline" : undefined}>{label}</span>
    </button>
  );
}

export function ViewToggle({
  label,
  children,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={`flex w-fit gap-0.5 rounded-lg border bg-muted p-0.5 ${className}`}
    >
      {children}
    </div>
  );
}
