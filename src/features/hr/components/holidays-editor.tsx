"use client";

/**
 * Holidays tab: add/delete public holidays for the page's selected year.
 * `getManageData` already scopes `holidays` to `year`, so this component
 * never filters client-side — the year select in `manage-client.tsx` drives
 * what's fetched, same as My Leave's year select drives `getMyLeaveData`.
 */

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveHoliday, deleteHoliday } from "../server/manage-actions";
import { formatDisplayDate } from "../lib/date-format";

type HolidayRow = { id: string; date: string; name: string };

type HolidaysEditorProps = {
  organizationSlug: string;
  year: number;
  holidays: HolidayRow[];
  onChanged: () => void;
};

export function HolidaysEditor({ organizationSlug, year, holidays, onChanged }: HolidaysEditorProps) {
  const { toast } = useToast();
  const t = useTranslations("hr.manage.holidays");
  const tRoot = useTranslations();

  const [date, setDate] = useState("");
  const [name, setName] = useState("");
  const [adding, setAdding] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<HolidayRow | null>(null);

  async function handleAdd(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setAdding(true);
    try {
      const result = await saveHoliday(organizationSlug, { date, name });
      if (!result.ok) {
        toast({
          title: t("addError"),
          description: result.messageKey ? tRoot(result.messageKey as never) : result.message,
          variant: "destructive",
        });
        return;
      }
      toast({ title: t("addSuccess") });
      setDate("");
      setName("");
      onChanged();
    } finally {
      setAdding(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    const result = await deleteHoliday(organizationSlug, deleteTarget.id);
    if (!result.ok) {
      toast({
        title: t("deleteError"),
        description: result.messageKey ? tRoot(result.messageKey as never) : result.message,
        variant: "destructive",
      });
      return;
    }
    toast({ title: t("deleteSuccess") });
    onChanged();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {t("title")} {year}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={handleAdd} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="space-y-2">
            <Label htmlFor="holiday-date">{t("dateLabel")}</Label>
            <Input id="holiday-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </div>
          <div className="flex-1 space-y-2">
            <Label htmlFor="holiday-name">{t("nameLabel")}</Label>
            <Input id="holiday-name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <Button type="submit" disabled={adding}>
            {adding && <Loader2 className="animate-spin" />}
            {t("addButton")}
          </Button>
        </form>

        {holidays.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <ul className="divide-y divide-border">
            {holidays.map((h) => (
              <li key={h.id} className="flex items-center justify-between gap-2 py-2">
                <div className="flex flex-col">
                  <span className="text-sm font-medium">{h.name}</span>
                  <span className="text-xs text-muted-foreground">{formatDisplayDate(h.date)}</span>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={t("deleteConfirmAction")}
                  onClick={() => setDeleteTarget(h)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(next) => !next && setDeleteTarget(null)}
        title={t("deleteConfirmTitle")}
        description={t("deleteConfirmDescription")}
        confirmLabel={t("deleteConfirmAction")}
        onConfirm={confirmDelete}
      />
    </Card>
  );
}
