"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { AlertCircle, Check, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { updateOrganizationSettingsAction } from "@/features/identity-access/server/actions";

type Status = "idle" | "pending" | "saved" | "error";

const TIMEZONE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "UTC", label: "UTC" },
  { value: "Asia/Kuala_Lumpur", label: "Asia/Kuala Lumpur (UTC+08:00)" },
  { value: "Asia/Singapore", label: "Asia/Singapore (UTC+08:00)" },
  { value: "Asia/Jakarta", label: "Asia/Jakarta (UTC+07:00)" },
  { value: "Asia/Bangkok", label: "Asia/Bangkok (UTC+07:00)" },
  { value: "Asia/Hong_Kong", label: "Asia/Hong Kong (UTC+08:00)" },
  { value: "Asia/Manila", label: "Asia/Manila (UTC+08:00)" },
  { value: "Asia/Tokyo", label: "Asia/Tokyo (UTC+09:00)" },
  { value: "Asia/Shanghai", label: "Asia/Shanghai (UTC+08:00)" },
  { value: "Asia/Kolkata", label: "Asia/Kolkata (UTC+05:30)" },
  { value: "Australia/Sydney", label: "Australia/Sydney (UTC+10:00)" },
  { value: "Europe/London", label: "Europe/London (UTC+00:00)" },
  { value: "Europe/Paris", label: "Europe/Paris (UTC+01:00)" },
  { value: "Europe/Berlin", label: "Europe/Berlin (UTC+01:00)" },
  { value: "America/New_York", label: "America/New York (UTC−05:00)" },
  { value: "America/Chicago", label: "America/Chicago (UTC−06:00)" },
  { value: "America/Denver", label: "America/Denver (UTC−07:00)" },
  { value: "America/Los_Angeles", label: "America/Los Angeles (UTC−08:00)" },
];

const LOCALE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "en-MY", label: "English (Malaysia)" },
  { value: "en-SG", label: "English (Singapore)" },
  { value: "en-GB", label: "English (United Kingdom)" },
  { value: "en-US", label: "English (United States)" },
  { value: "ms-MY", label: "Bahasa Melayu (Malaysia)" },
  { value: "id-ID", label: "Bahasa Indonesia" },
  { value: "zh-CN", label: "简体中文 (Simplified Chinese)" },
  { value: "zh-TW", label: "繁體中文 (Traditional Chinese)" },
  { value: "th-TH", label: "ไทย (Thai)" },
  { value: "vi-VN", label: "Tiếng Việt (Vietnamese)" },
  { value: "tl-PH", label: "Filipino" },
];

export function UpdateOrganizationForm(props: {
  organizationId: string;
  name: string;
  legalName: string | null;
  region: string | null;
  defaultTimeZone: string;
  defaultLocale: string;
  onStatusChange?: (status: Status) => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const router = useRouter();
  const t = useTranslations("identity.updateOrganizationForm");
  const tRoot = useTranslations();

  const initial = useMemo(
    () => ({
      name: props.name,
      legalName: props.legalName ?? "",
      region: props.region ?? "",
      tz: props.defaultTimeZone,
      locale: props.defaultLocale,
    }),
    [props.name, props.legalName, props.region, props.defaultTimeZone, props.defaultLocale],
  );

  const [name, setName] = useState(initial.name);
  const [legalName, setLegalName] = useState(initial.legalName);
  const [region, setRegion] = useState(initial.region);
  const [tz, setTz] = useState(initial.tz);
  const [locale, setLocale] = useState(initial.locale);

  const [status, setStatus] = useState<Status>("idle");
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const dirty =
    name !== initial.name ||
    legalName !== initial.legalName ||
    region !== initial.region ||
    tz !== initial.tz ||
    locale !== initial.locale;

  useEffect(() => {
    props.onStatusChange?.(status);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  useEffect(() => {
    props.onDirtyChange?.(dirty);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty]);

  useEffect(() => {
    if (status !== "saved") return;
    const t = setTimeout(() => setStatus("idle"), 1500);
    return () => clearTimeout(t);
  }, [status]);

  function resetLocal() {
    setName(initial.name);
    setLegalName(initial.legalName);
    setRegion(initial.region);
    setTz(initial.tz);
    setLocale(initial.locale);
    setFormError(null);
    setFieldErrors({});
    setStatus("idle");
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!dirty || status === "pending") return;
    setFormError(null);
    setFieldErrors({});
    setStatus("pending");
    const result = await updateOrganizationSettingsAction({
      organizationId: props.organizationId,
      name,
      legalName: legalName || null,
      region: region || null,
      defaultTimeZone: tz,
      defaultLocale: locale,
    });
    if (!result.ok) {
      const fe = result.fieldErrors ?? {};
      const flat: Record<string, string> = {};
      for (const [k, v] of Object.entries(fe)) {
        if (Array.isArray(v) && v.length > 0) flat[k] = v[0]!;
      }
      setFieldErrors(flat);
      // `messageKey` is a dynamic full path (e.g. "errors.identity.organization.updateForbidden");
      // next-intl's typed `t()` only accepts literal keys, so this is cast at the call site.
      setFormError(tRoot(result.messageKey as never));
      setStatus("error");
      return;
    }
    setStatus("saved");
    router.refresh();
  }

  const saveLabel =
    status === "pending"
      ? t("saving")
      : status === "saved"
        ? t("saved")
        : t("saveChanges");

  const SaveIcon =
    status === "pending" ? (
      <Loader2 className="animate-spin" aria-hidden />
    ) : status === "saved" ? (
      <Check aria-hidden />
    ) : null;

  const saveDisabled = status === "pending" || !dirty;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("cardTitle")}</CardTitle>
        <CardDescription>{t("cardDescription")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} noValidate data-org-settings-form>
          {formError ? (
            <div
              role="alert"
              className="mb-6 flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
            >
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <div className="space-y-0.5">
                <p className="font-medium">{t("errorTitle")}</p>
                <p className="text-destructive/90">{formError}</p>
              </div>
            </div>
          ) : null}

          <FieldSet>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="org-name">
                  {t("nameLabel")} <span className="text-destructive" aria-hidden>*</span>
                </FieldLabel>
                <Input
                  id="org-name"
                  name="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  minLength={2}
                  maxLength={150}
                  aria-required="true"
                  aria-invalid={Boolean(fieldErrors.name)}
                />
                <FieldDescription>{t("nameDescription")}</FieldDescription>
                {fieldErrors.name ? <FieldError>{fieldErrors.name}</FieldError> : null}
              </Field>

              <Field>
                <FieldLabel htmlFor="org-legal-name">{t("legalNameLabel")}</FieldLabel>
                <Input
                  id="org-legal-name"
                  name="legalName"
                  value={legalName}
                  onChange={(e) => setLegalName(e.target.value)}
                  maxLength={200}
                  aria-invalid={Boolean(fieldErrors.legalName)}
                />
                <FieldDescription>{t("legalNameDescription")}</FieldDescription>
                {fieldErrors.legalName ? <FieldError>{fieldErrors.legalName}</FieldError> : null}
              </Field>

              <Field>
                <FieldLabel htmlFor="org-region">{t("regionLabel")}</FieldLabel>
                <Input
                  id="org-region"
                  name="region"
                  value={region}
                  onChange={(e) => setRegion(e.target.value)}
                  maxLength={50}
                  aria-invalid={Boolean(fieldErrors.region)}
                />
                <FieldDescription>{t("regionDescription")}</FieldDescription>
                {fieldErrors.region ? <FieldError>{fieldErrors.region}</FieldError> : null}
              </Field>
            </FieldGroup>

            <FieldSeparator>
              <span className="bg-card px-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                {t("localizationSectionLabel")}
              </span>
            </FieldSeparator>

            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="org-timezone">
                  {t("timezoneLabel")} <span className="text-destructive" aria-hidden>*</span>
                </FieldLabel>
                <Select value={tz} onValueChange={setTz} name="defaultTimeZone">
                  <SelectTrigger id="org-timezone" aria-required="true">
                    <SelectValue placeholder={t("timezonePlaceholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    {TIMEZONE_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {fieldErrors.defaultTimeZone ? (
                  <FieldError>{fieldErrors.defaultTimeZone}</FieldError>
                ) : null}
              </Field>

              <Field>
                <FieldLabel htmlFor="org-locale">
                  {t("localeLabel")} <span className="text-destructive" aria-hidden>*</span>
                </FieldLabel>
                <Select value={locale} onValueChange={setLocale} name="defaultLocale">
                  <SelectTrigger id="org-locale" aria-required="true">
                    <SelectValue placeholder={t("localePlaceholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    {LOCALE_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {fieldErrors.defaultLocale ? (
                  <FieldError>{fieldErrors.defaultLocale}</FieldError>
                ) : null}
              </Field>
            </FieldGroup>
          </FieldSet>
        </form>
      </CardContent>
      <CardFooter className="justify-end gap-2 border-t">
        <Button
          type="button"
          variant="outline"
          onClick={resetLocal}
          disabled={status === "pending" || !dirty}
        >
          {t("cancel")}
        </Button>
        <Button
          type="button"
          onClick={() => {
            document
              .querySelector<HTMLFormElement>("[data-org-settings-form]")
              ?.requestSubmit();
          }}
          disabled={saveDisabled}
        >
          {SaveIcon}
          {saveLabel}
        </Button>
      </CardFooter>
    </Card>
  );
}