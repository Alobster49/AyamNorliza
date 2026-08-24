"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, Database, RefreshCw } from "lucide-react";
import { clearAllData, seedDemoData } from "@/features/data-console/server/actions";
import { CONSOLE_ACCOUNTS } from "@/features/data-console/lib/accounts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

type DataConsoleClientProps = {
  organizationSlug: string;
};

export function DataConsoleClient({ organizationSlug }: DataConsoleClientProps) {
  const t = useTranslations("dataConsole");
  const tCommon = useTranslations("common");
  const CONFIRM_PHRASE = t("clearCard.confirmPhrase");
  const [confirmText, setConfirmText] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function runClear() {
    if (busy) return;
    setBusy(true);
    try {
      setMessage(null);
      setError(null);
      const result = await clearAllData(organizationSlug);
      if (result.ok) {
        const total = Object.values(result.data.counts).reduce((a, b) => a + b, 0);
        setMessage(t("clearedRows", { count: total }));
        setConfirmText("");
      } else {
        setError(result.message);
      }
    } finally {
      setBusy(false);
    }
  }

  async function runSeed() {
    if (busy) return;
    setBusy(true);
    try {
      setMessage(null);
      setError(null);
      const result = await seedDemoData(organizationSlug);
      if (result.ok) {
        const s = result.data.summary;
        setMessage(
          t("seededSummary", {
            products: s.products ?? 0,
            customers: s.customers ?? 0,
            orders: s.orders ?? 0,
            runs: s.runs ?? 0,
          }),
        );
      } else {
        setError(result.message);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="text-muted-foreground">{t("subtitle")}</p>
      </div>

      {(message || error) && (
        <p
          role="status"
          aria-live="polite"
          className={
            error
              ? "rounded-lg border border-destructive/50 bg-destructive/5 px-3 py-2 text-sm text-destructive"
              : "rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300"
          }
        >
          {error ?? message}
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="size-4" />
              {t("clearCard.title")}
            </CardTitle>
            <CardDescription>{t("clearCard.description")}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <Label htmlFor="clear-confirm">
              {t("clearCard.confirmLabel", { phrase: CONFIRM_PHRASE })}
            </Label>
            <Input
              id="clear-confirm"
              value={confirmText}
              onChange={(event) => setConfirmText(event.target.value)}
              placeholder={CONFIRM_PHRASE}
              autoComplete="off"
              disabled={busy}
            />
          </CardContent>
          <CardFooter>
            <Button
              variant="destructive"
              disabled={busy || confirmText !== CONFIRM_PHRASE}
              onClick={runClear}
            >
              {t("clearCard.button")}
            </Button>
          </CardFooter>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Database className="size-4" />
              {t("seedCard.title")}
            </CardTitle>
            <CardDescription>{t("seedCard.description")}</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="text-sm text-muted-foreground">
              {CONSOLE_ACCOUNTS.map((account) => (
                <li key={account.email}>
                  {account.displayName} — {account.email} ({account.role})
                </li>
              ))}
            </ul>
          </CardContent>
          <CardFooter>
            <Dialog>
              <DialogTrigger asChild>
                <Button disabled={busy}>
                  <RefreshCw className="size-4" />
                  {t("seedCard.trigger")}
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t("seedCard.dialogTitle")}</DialogTitle>
                  <DialogDescription>{t("seedCard.dialogDescription")}</DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <DialogClose asChild>
                    <Button variant="outline">{tCommon("cancel")}</Button>
                  </DialogClose>
                  <DialogClose asChild>
                    <Button disabled={busy} onClick={runSeed}>
                      {t("seedCard.confirm")}
                    </Button>
                  </DialogClose>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
