"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { resolveMessageKey } from "@/lib/i18n/resolve-message-key";
import { roleDisplayLabel } from "@/features/access-control/components/role-label";
import { createRoleAction } from "@/features/identity-access/server/roles";
import type { RoleRow } from "@/features/identity-access/server/roles";

const NO_CLONE = "__none__";

export function CreateRoleDialog({
  organizationSlug,
  roles,
  open,
  onOpenChange,
  onCreated,
}: {
  organizationSlug: string;
  /** Existing roles offered as a clone source, highest rank first. */
  roles: RoleRow[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (roleId: string) => void;
}) {
  const { toast } = useToast();
  const t = useTranslations("identity.rolesEditor.createDialog");
  const tRoles = useTranslations("roles");
  const tRoot = useTranslations();
  const [name, setName] = useState("");
  const [cloneFromRoleId, setCloneFromRoleId] = useState<string>(NO_CLONE);
  const [saving, setSaving] = useState(false);

  function reset() {
    setName("");
    setCloneFromRoleId(NO_CLONE);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const result = await createRoleAction({
        organizationSlug,
        name,
        ...(cloneFromRoleId !== NO_CLONE ? { cloneFromRoleId } : {}),
      });
      if (!result.ok) {
        toast({
          title: t("errorTitle"),
          description: result.messageKey
            ? resolveMessageKey(tRoot, result.messageKey, result.messageParams)
            : result.message,
          variant: "destructive",
        });
        return;
      }
      toast({ title: t("success") });
      onCreated(result.data.roleId);
      reset();
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!saving) {
          if (!next) reset();
          onOpenChange(next);
        }
      }}
    >
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="new-role-name">{t("nameLabel")}</Label>
            <Input
              id="new-role-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("namePlaceholder")}
              autoFocus
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-role-clone">{t("cloneLabel")}</Label>
            <Select value={cloneFromRoleId} onValueChange={setCloneFromRoleId}>
              <SelectTrigger id="new-role-clone" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_CLONE}>{t("cloneNone")}</SelectItem>
                {roles.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {roleDisplayLabel(tRoles, r)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={() => {
                reset();
                onOpenChange(false);
              }}
            >
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={saving || !name.trim()}>
              {saving && <Loader2 className="animate-spin" />}
              {saving ? t("creating") : t("create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
