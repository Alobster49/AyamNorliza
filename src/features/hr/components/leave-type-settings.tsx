"use client";

/**
 * Leave types tab: per-type entitlement days, carry-forward cap, and
 * requires-attachment toggle. Each row keeps its own local draft state and
 * saves independently via `updateLeaveType` — editing one type never
 * disturbs another row's unsaved draft. An empty entitlement-days field
 * saves as `null` (upon-request, unlimited — the same encoding
 * `leave-model.ts` already treats specially).
 */

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateLeaveType, type UpdateLeaveTypeInput } from "../server/manage-actions";
import type { LeaveTypeInfo } from "../types";

function numberOrNull(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

type RowProps = {
  organizationSlug: string;
  type: LeaveTypeInfo;
  onSaved: () => void;
};

function LeaveTypeRow({ organizationSlug, type, onSaved }: RowProps) {
  const { toast } = useToast();
  const t = useTranslations("hr.manage.leaveTypes");
  const tRoot = useTranslations();

  const [entitlementDays, setEntitlementDays] = useState(
    type.entitlementDays === null ? "" : String(type.entitlementDays),
  );
  const [carryForwardCap, setCarryForwardCap] = useState(
    type.carryForwardCap === null ? "" : String(type.carryForwardCap),
  );
  const [requiresAttachment, setRequiresAttachment] = useState(type.requiresAttachment);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      const input: UpdateLeaveTypeInput = {
        entitlementDays: numberOrNull(entitlementDays),
        carryForwardCap: numberOrNull(carryForwardCap),
        requiresAttachment,
      };
      const result = await updateLeaveType(organizationSlug, type.id, input);
      if (!result.ok) {
        toast({
          title: t("saveError"),
          description: result.messageKey ? tRoot(result.messageKey as never) : result.message,
          variant: "destructive",
        });
        return;
      }
      toast({ title: t("saveSuccess") });
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border p-3 sm:flex-row sm:items-end sm:gap-4">
      <div className="min-w-[7rem]">
        <p className="text-sm font-medium">{type.name}</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor={`entitlement-${type.id}`}>{t("entitlementLabel")}</Label>
        <Input
          id={`entitlement-${type.id}`}
          type="number"
          min="0"
          step="0.5"
          placeholder={t("entitlementHint")}
          value={entitlementDays}
          onChange={(e) => setEntitlementDays(e.target.value)}
          className="w-full sm:w-32"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`cf-cap-${type.id}`}>{t("carryForwardCapLabel")}</Label>
        <Input
          id={`cf-cap-${type.id}`}
          type="number"
          min="0"
          step="0.5"
          value={carryForwardCap}
          onChange={(e) => setCarryForwardCap(e.target.value)}
          className="w-full sm:w-32"
        />
      </div>
      <div className="flex items-center gap-2">
        <button
          id={`requires-attachment-${type.id}`}
          type="button"
          role="switch"
          aria-checked={requiresAttachment}
          aria-label={t("requiresAttachmentLabel")}
          onClick={() => setRequiresAttachment((prev) => !prev)}
          className={`relative h-5 w-9 shrink-0 rounded-full transition-colors duration-200 ${
            requiresAttachment ? "bg-primary" : "bg-muted-foreground/30"
          }`}
        >
          <span
            className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform duration-200 ease-out ${
              requiresAttachment ? "translate-x-4" : "translate-x-0"
            }`}
          />
        </button>
        <Label htmlFor={`requires-attachment-${type.id}`} className="text-sm">
          {t("requiresAttachmentLabel")}
        </Label>
      </div>
      <Button type="button" size="sm" disabled={saving} onClick={() => void handleSave()} className="sm:ml-auto">
        {saving && <Loader2 className="animate-spin" />}
        {t("save")}
      </Button>
    </div>
  );
}

type LeaveTypeSettingsProps = {
  organizationSlug: string;
  types: LeaveTypeInfo[];
  onSaved: () => void;
};

export function LeaveTypeSettings({ organizationSlug, types, onSaved }: LeaveTypeSettingsProps) {
  const t = useTranslations("hr.manage.leaveTypes");

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {types.map((type) => (
          <LeaveTypeRow key={type.id} organizationSlug={organizationSlug} type={type} onSaved={onSaved} />
        ))}
      </CardContent>
    </Card>
  );
}
