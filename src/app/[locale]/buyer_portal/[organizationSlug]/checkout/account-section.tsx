"use client";

import { motion } from "motion/react";
import { useTranslations } from "next-intl";
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
  const t = useTranslations("buyer.checkout");
  const tLogin = useTranslations("buyer.login");

  const modeOptions = [
    ["signup", t("accountModeNew")],
    ["signin", t("accountModeExisting")],
  ] as const;

  return (
    <div className="space-y-4">
      <div className="relative grid grid-cols-2 rounded-full bg-secondary p-1" role="radiogroup" aria-label={t("accountRadiogroupLabel")}>
        {modeOptions.map(([m, label]) => (
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
            <Label htmlFor="acc-name">{tLogin("nameLabel")}</Label>
            <Input id="acc-name" autoComplete="name" value={value.displayName}
              onChange={(e) => set({ displayName: e.target.value })} disabled={disabled} className="h-11" />
            <FieldError errors={fieldErrors.displayName} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="acc-phone">{tLogin("phoneLabel")}</Label>
            <Input id="acc-phone" type="tel" inputMode="tel" placeholder={t("phonePlaceholder")} autoComplete="tel"
              value={value.phone} onChange={(e) => set({ phone: e.target.value })} disabled={disabled} className="h-11" />
            <p className="text-xs text-muted-foreground">{tLogin("phoneHint")}</p>
            <FieldError errors={fieldErrors.phone} />
          </div>
        </>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="acc-email">{tLogin("emailLabel")}</Label>
        <Input id="acc-email" type="email" autoComplete="email" value={value.email}
          onChange={(e) => set({ email: e.target.value })} disabled={disabled} className="h-11" />
        <FieldError errors={fieldErrors.email} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="acc-password">{tLogin("passwordLabel")} {mode === "signup" ? t("passwordMinHint") : ""}</Label>
        <Input id="acc-password" type="password"
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
          minLength={mode === "signup" ? 8 : undefined}
          value={value.password} onChange={(e) => set({ password: e.target.value })} disabled={disabled} className="h-11" />
        <FieldError errors={fieldErrors.password} />
      </div>
    </div>
  );
}
