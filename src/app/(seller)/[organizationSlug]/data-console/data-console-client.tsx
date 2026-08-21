"use client";

import { useState, useTransition } from "react";
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

const CONFIRM_PHRASE = "PADAM SEMUA";

type DataConsoleClientProps = {
  organizationSlug: string;
};

export function DataConsoleClient({ organizationSlug }: DataConsoleClientProps) {
  const [confirmText, setConfirmText] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function runClear() {
    startTransition(async () => {
      setMessage(null);
      setError(null);
      const result = await clearAllData(organizationSlug);
      if (result.ok) {
        const total = Object.values(result.data.counts).reduce((a, b) => a + b, 0);
        setMessage(`Cleared ${total} rows. Users were kept.`);
      } else {
        setError(result.message);
      }
      setConfirmText("");
    });
  }

  function runSeed() {
    startTransition(async () => {
      setMessage(null);
      setError(null);
      const result = await seedDemoData(organizationSlug);
      if (result.ok) {
        const s = result.data.summary;
        setMessage(
          `Seeded ${s.products} products, ${s.customers} customers, ${s.orders} orders, ${s.runs} runs.`,
        );
      } else {
        setError(result.message);
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold">Data console</h1>
        <p className="text-muted-foreground">
          Reset or seed the demo data for this organization. Pilot-only, owner-only.
        </p>
      </div>

      {(message || error) && (
        <p
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
              Clear all data
            </CardTitle>
            <CardDescription>
              Permanently deletes products, customers, orders, and runs for this organization.
              User accounts and logins are kept.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <Label htmlFor="clear-confirm">{`Type ${CONFIRM_PHRASE} to enable`}</Label>
            <Input
              id="clear-confirm"
              value={confirmText}
              onChange={(event) => setConfirmText(event.target.value)}
              placeholder={CONFIRM_PHRASE}
              autoComplete="off"
              disabled={isPending}
            />
          </CardContent>
          <CardFooter>
            <Button
              variant="destructive"
              disabled={isPending || confirmText !== CONFIRM_PHRASE}
              onClick={runClear}
            >
              Clear all data
            </Button>
          </CardFooter>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Database className="size-4" />
              Seed demo data
            </CardTitle>
            <CardDescription>
              Creates a full set of demo products, customers, orders, and runs, and ensures the
              console accounts below can log in.
            </CardDescription>
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
                <Button disabled={isPending}>
                  <RefreshCw className="size-4" />
                  Seed demo data
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Seed demo data?</DialogTitle>
                  <DialogDescription>
                    This clears existing data first, then creates a fresh set of demo products,
                    customers, orders, and runs.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <DialogClose asChild>
                    <Button variant="outline">Cancel</Button>
                  </DialogClose>
                  <DialogClose asChild>
                    <Button disabled={isPending} onClick={runSeed}>
                      Seed demo data
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
