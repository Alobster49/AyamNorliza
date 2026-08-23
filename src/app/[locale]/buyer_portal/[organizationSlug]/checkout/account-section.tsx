"use client";

import { motion } from "motion/react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type AccountValue = {
  displayName: string;
  phone: string;
  email: string;
  password: string;
};

type AccountSectionProps = {
  mode: "signup" | "signin";
  onModeChange: (m: "signup" | "signin") => void;
  value: AccountValue;
  onChange: (v: AccountValue) => void;
  fieldErrors: Record<string, string[]>;
  disabled: boolean;
};

function FieldError({ errors }: { errors?: string[] }) {
  if (!errors?.length) return null;
  return <p className="text-sm" style={{ color: "var(--buyer-delta)" }}>{errors[0]}</p>;
}

export function AccountSection({ mode, onModeChange, value, onChange, fieldErrors, disabled }: AccountSectionProps) {
  const set = (patch: Partial<AccountValue>) => onChange({ ...value, ...patch });

  return (
    <div className="space-y-4">
      <div className="relative grid grid-cols-2 rounded-full bg-secondary p-1" role="radiogroup" aria-label="Akaun">
        {([["signup", "Akaun baru"], ["signin", "Sudah ada akaun"]] as const).map(([m, label]) => (
          <button key={m} type="button" role="radio" aria-checked={mode === m} disabled={disabled}
            onClick={() => onModeChange(m)} className="relative z-10 rounded-full py-2 text-sm font-medium">
            {mode === m && (
              <motion.span layoutId="account-mode-pill"
                className="absolute inset-0 -z-10 rounded-full bg-card shadow-sm"
                transition={{ type: "spring", bounce: 0, duration: 0.3 }} />
            )}
            {label}
          </button>
        ))}
      </div>

      {mode === "signup" && (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="acc-name">Nama</Label>
            <Input id="acc-name" autoComplete="name" value={value.displayName}
              onChange={(e) => set({ displayName: e.target.value })} disabled={disabled} className="h-11" />
            <FieldError errors={fieldErrors.displayName} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="acc-phone">Nombor telefon</Label>
            <Input id="acc-phone" type="tel" inputMode="tel" placeholder="012-345 6789" autoComplete="tel"
              value={value.phone} onChange={(e) => set({ phone: e.target.value })} disabled={disabled} className="h-11" />
            <p className="text-xs text-muted-foreground">Kami akan hantar kemas kini pesanan ke nombor ini.</p>
            <FieldError errors={fieldErrors.phone} />
          </div>
        </>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="acc-email">Email</Label>
        <Input id="acc-email" type="email" autoComplete="email" value={value.email}
          onChange={(e) => set({ email: e.target.value })} disabled={disabled} className="h-11" />
        <FieldError errors={fieldErrors.email} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="acc-password">Kata laluan {mode === "signup" ? "(min 8 aksara)" : ""}</Label>
        <Input id="acc-password" type="password"
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
          minLength={mode === "signup" ? 8 : undefined}
          value={value.password} onChange={(e) => set({ password: e.target.value })} disabled={disabled} className="h-11" />
        <FieldError errors={fieldErrors.password} />
      </div>
    </div>
  );
}
