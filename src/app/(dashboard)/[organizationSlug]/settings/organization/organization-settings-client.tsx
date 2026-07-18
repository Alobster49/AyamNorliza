"use client";

import { useCallback, useState } from "react";
import { Building2, Check, Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { UpdateOrganizationForm } from "@/components/forms/update-organization-form";

export type OrgFormStatus = "idle" | "pending" | "saved" | "error";

export function OrganizationSettingsClient(props: {
  organizationId: string;
  name: string;
  legalName: string | null;
  region: string | null;
  defaultTimeZone: string;
  defaultLocale: string;
}) {
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState<OrgFormStatus>("idle");

  const onSubmit = useCallback(() => {
    document
      .querySelector<HTMLFormElement>("[data-org-settings-form]")
      ?.requestSubmit();
  }, []);

  const saveDisabled = status === "pending" || !dirty;

  const saveLabel =
    status === "pending"
      ? "Saving..."
      : status === "saved"
        ? "Saved"
        : "Save changes";

  const SaveIcon =
    status === "pending" ? (
      <Loader2 className="animate-spin" aria-hidden />
    ) : status === "saved" ? (
      <Check aria-hidden />
    ) : null;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <div
            aria-hidden
            className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"
          >
            <Building2 className="size-5" />
          </div>
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">
                Organization settings
              </h1>
              {dirty && status !== "pending" && status !== "saved" ? (
                <Badge variant="outline" className="text-muted-foreground">
                  Unsaved changes
                </Badge>
              ) : null}
              {status === "saved" ? (
                <Badge variant="secondary">Saved</Badge>
              ) : null}
            </div>
            <p className="text-sm text-muted-foreground">
              Manage your organization&apos;s identity and defaults.
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            onClick={onSubmit}
            disabled={saveDisabled}
            className="self-start sm:self-auto"
          >
            {SaveIcon}
            {saveLabel}
          </Button>
        </div>
      </div>

      <Separator className="my-6" />

      <UpdateOrganizationForm
        organizationId={props.organizationId}
        name={props.name}
        legalName={props.legalName}
        region={props.region}
        defaultTimeZone={props.defaultTimeZone}
        defaultLocale={props.defaultLocale}
        onStatusChange={setStatus}
        onDirtyChange={setDirty}
      />
    </div>
  );
}