"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { AlertTriangle, ArrowUpRight, CalendarCheck, CheckCircle2, ClipboardCheck, ClipboardList, RefreshCcw, ScanLine, Search } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { createPeriodCloseAction, startInspectionAction, submitInspectionAction, submitSyncOperationsAction, type ActionResult } from "../server/actions";
import type { DueRound, Inspection, InspectionTemplateVersion, Observation, PeriodClose } from "../types";
import { listQueuedOperations, markOperationSynced, queueOperation } from "../offline-queue";

type Result = ActionResult<Record<string, unknown>>;

export function TodayPageClient({
  organizationId,
  organizationSlug,
  rounds,
}: {
  organizationId: string;
  organizationSlug: string;
  rounds: DueRound[];
}) {
  const due = rounds.filter((round) => round.status === "due").length;
  const submitted = rounds.filter((round) => round.status === "submitted").length;
  const missingTemplates = rounds.filter((round) => round.status === "missing_template").length;

  return (
    <div className="space-y-4">
      <Header title="Today" description="Assigned house rounds, offline sync status, and supervisor exceptions." />
      <div className="grid gap-3 md:grid-cols-3">
        <MetricCard icon={ClipboardList} label="Due rounds" value={due} />
        <MetricCard icon={CheckCircle2} label="Submitted" value={submitted} />
        <MetricCard icon={AlertTriangle} label="Missing templates" value={missingTemplates} />
      </div>
      <ScanCard organizationSlug={organizationSlug} />
      <RoundsTable organizationSlug={organizationSlug} rounds={rounds} organizationId={organizationId} />
    </div>
  );
}

export function RoundsPageClient({
  organizationId,
  organizationSlug,
  rounds,
  inspections,
}: {
  organizationId: string;
  organizationSlug: string;
  rounds: DueRound[];
  inspections: Inspection[];
}) {
  return (
    <div className="space-y-4">
      <Header title="Rounds" description="Start rounds from assigned houses and review recently submitted inspections." />
      <RoundsTable organizationSlug={organizationSlug} rounds={rounds} organizationId={organizationId} />
      <Card className="shadow-none">
        <CardHeader>
          <CardTitle>Recent inspections</CardTitle>
          <CardDescription>Submitted and in-progress records from the current operating window.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Inspection</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Started</TableHead>
                <TableHead>Sync</TableHead>
                <TableHead className="w-16" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {inspections.map((inspection) => (
                <TableRow key={inspection.id}>
                  <TableCell className="font-mono text-xs">{inspection.id.slice(0, 8)}</TableCell>
                  <TableCell><StatusBadge status={inspection.status} /></TableCell>
                  <TableCell>{formatDateTime(inspection.startedAt)}</TableCell>
                  <TableCell><Badge variant="outline">{inspection.syncStatus}</Badge></TableCell>
                  <TableCell>
                    <Button asChild variant="ghost" size="icon-sm">
                      <Link href={`/${organizationSlug}/rounds/${inspection.id}`} aria-label="Open inspection">
                        <ArrowUpRight className="size-4" />
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

export function RoundCaptureClient({
  organizationId,
  organizationSlug,
  round,
  template,
  inspection,
}: {
  organizationId: string;
  organizationSlug: string;
  round: DueRound;
  template: InspectionTemplateVersion | null;
  inspection: Inspection | null;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const questions = useMemo(() => template?.definition.sections.flatMap((section) => section.questions) ?? [], [template]);

  async function startRound() {
    if (!round.templateVersionId) {
      setError("No approved template matches this house.");
      return;
    }
    setPending(true);
    setError(null);
    const clientOperationId = crypto.randomUUID();
    try {
      const result = await startInspectionAction({
        organizationId,
        siteId: round.siteId,
        houseId: round.houseId,
        flockId: round.flockId,
        templateVersionId: round.templateVersionId,
        clientOperationId,
        startedAt: new Date().toISOString(),
      });
      if (result.ok) {
        await queueOperation({
          clientOperationId,
          entityId: result.data.inspectionId,
          entityType: "inspection",
          mutationType: "create",
          localEventTime: new Date().toISOString(),
          localSaveTime: new Date().toISOString(),
          payloadSchemaVersion: 1,
          payload: { inspectionId: result.data.inspectionId },
          attachmentReferences: [],
        });
        router.push(`/${organizationSlug}/rounds/${result.data.inspectionId}`);
      } else {
        setError(result.message);
      }
    } finally {
      setPending(false);
    }
  }

  async function submit(formData: FormData) {
    if (!inspection) return;
    setPending(true);
    setError(null);
    try {
      const responses = questions.map((question) => ({
        questionKey: question.key,
        label: question.label,
        responseType: question.responseType,
        value: valueFor(formData, question.key, question.responseType),
        unit: question.unit ?? null,
        status: text(formData, `${question.key}_status`) as "ok" | "abnormal" | "skipped" | "corrected",
        exceptionReason: nullableText(formData, `${question.key}_reason`),
        source: "manual",
      }));
      const observations = buildObservation(formData, round);
      const result = await submitInspectionAction({
        organizationId,
        inspectionId: inspection.id,
        completedAt: new Date().toISOString(),
        signature: text(formData, "signature"),
        responses,
        observations,
      });
      handleResult(result as Result, setError, router);
    } finally {
      setPending(false);
    }
  }

  return (
    <form action={submit} className="space-y-4">
      <Header title={`${round.houseCode} round`} description={`${round.houseName}${round.flockCode ? ` / ${round.flockCode}` : ""}`} />
      {error ? <ErrorBanner message={error} /> : null}
      {!inspection ? (
        <Card className="shadow-none">
          <CardHeader>
            <CardTitle>Ready to start</CardTitle>
            <CardDescription>Confirm house, flock, template and current offline state before entry.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{round.productionType}</Badge>
            <Badge variant="outline">{round.riskClass}</Badge>
            <Badge variant={round.templateVersionId ? "secondary" : "destructive"}>{round.templateVersion ?? "No template"}</Badge>
            <Button type="button" disabled={pending || !round.templateVersionId} onClick={startRound}>
              <ClipboardCheck data-icon="inline-start" />
              {pending ? "Starting..." : "Start round"}
            </Button>
          </CardContent>
        </Card>
      ) : null}
      {inspection && template ? (
        <>
          {template.definition.sections.map((section) => (
            <Card key={section.key} className="shadow-none">
              <CardHeader>
                <CardTitle>{section.title}</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4">
                {section.questions.map((question) => (
                  <FieldGroup key={question.key} className="grid gap-2 rounded-md border p-3 md:grid-cols-[minmax(0,1fr)_12rem_12rem]">
                    <Field>
                      <FieldLabel htmlFor={question.key}>{question.label}</FieldLabel>
                      <Input id={question.key} name={question.key} type={question.responseType === "number" ? "number" : "text"} required={question.required} />
                    </Field>
                    <Field>
                      <FieldLabel>Status</FieldLabel>
                      <Select name={`${question.key}_status`} defaultValue="ok">
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>{["ok", "abnormal", "skipped", "corrected"].map(selectItem)}</SelectContent>
                      </Select>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor={`${question.key}_reason`}>Reason</FieldLabel>
                      <Input id={`${question.key}_reason`} name={`${question.key}_reason`} />
                    </Field>
                  </FieldGroup>
                ))}
              </CardContent>
            </Card>
          ))}
          <Card className="shadow-none">
            <CardHeader><CardTitle>Finding</CardTitle><CardDescription>Create a linked observation from abnormal findings.</CardDescription></CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-3">
              <Field><FieldLabel>Category</FieldLabel><Select name="observationCategory" defaultValue="other"><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["health", "environment", "feed_water", "litter", "equipment", "production", "biosecurity", "other"].map(selectItem)}</SelectContent></Select></Field>
              <Field><FieldLabel>Severity</FieldLabel><Select name="observationSeverity" defaultValue="low"><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["info", "low", "medium", "high", "critical"].map(selectItem)}</SelectContent></Select></Field>
              <Field><FieldLabel htmlFor="observationDescription">Description</FieldLabel><Input id="observationDescription" name="observationDescription" /></Field>
            </CardContent>
          </Card>
          <Field className="max-w-sm">
            <FieldLabel htmlFor="signature">Signature</FieldLabel>
            <Input id="signature" name="signature" required />
          </Field>
          <Button disabled={pending} type="submit">{pending ? "Submitting..." : "Submit signed round"}</Button>
        </>
      ) : null}
    </form>
  );
}

export function ExceptionsPageClient({ observations }: { observations: Observation[] }) {
  return (
    <div className="space-y-4">
      <Header title="Daily record exceptions" description="Late, abnormal, unresolved and corrected records for supervisor review." />
      <ObservationTable observations={observations} />
    </div>
  );
}

export function PeriodClosePageClient({
  organizationId,
  closes,
  rounds,
}: {
  organizationId: string;
  closes: PeriodClose[];
  rounds: DueRound[];
}) {
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const firstRound = rounds[0];
  async function createClose() {
    if (!firstRound) return;
    const result = await createPeriodCloseAction({
      organizationId,
      siteId: firstRound.siteId,
      houseId: firstRound.houseId,
      periodType: "daily",
      periodStart: new Date(new Date().setHours(0, 0, 0, 0)).toISOString(),
      periodEnd: new Date().toISOString(),
      operatingDate: new Date().toISOString().slice(0, 10),
      completeness: {
        requiredRounds: rounds.length,
        completedRounds: rounds.filter((round) => round.status === "submitted").length,
        unresolvedCriticalFindings: 0,
      },
      reviewerNotes: "Generated from current MOD-04 vertical-slice dashboard.",
    });
    handleResult(result as Result, setError, router);
  }
  return (
    <div className="space-y-4">
      <Header title="Period close" description="Daily completeness checks, approval and lock state." />
      {error ? <ErrorBanner message={error} /> : null}
      <Button type="button" onClick={createClose} disabled={!firstRound}>
        <CalendarCheck data-icon="inline-start" />
        Create daily close
      </Button>
      <Card className="shadow-none">
        <CardContent className="pt-6">
          <Table>
            <TableHeader><TableRow><TableHead>Period</TableHead><TableHead>Status</TableHead><TableHead>Completeness</TableHead></TableRow></TableHeader>
            <TableBody>{closes.map((close) => <TableRow key={close.id}><TableCell>{formatDateTime(close.periodStart)}</TableCell><TableCell><StatusBadge status={close.status} /></TableCell><TableCell className="font-mono text-xs">{JSON.stringify(close.completeness)}</TableCell></TableRow>)}</TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

export function PlaceholderWorkflowClient({ title, description }: { title: string; description: string }) {
  return (
    <div className="space-y-4">
      <Header title={title} description={description} />
      <Card className="shadow-none">
        <CardContent className="pt-6 text-sm text-muted-foreground">
          Records for this workflow are stored in MOD-04 tables and exposed through supervisor actions as the vertical slice grows.
        </CardContent>
      </Card>
    </div>
  );
}

function RoundsTable({ organizationId, organizationSlug, rounds }: { organizationId: string; organizationSlug: string; rounds: DueRound[] }) {
  const [syncing, setSyncing] = useState(false);
  async function syncQueued() {
    setSyncing(true);
    try {
      const queued = await listQueuedOperations();
      if (queued.length === 0) return;
      const result = await submitSyncOperationsAction({ organizationId, operations: queued });
      if (result.ok) {
        for (const row of result.data.results) await markOperationSynced(row.clientOperationId);
      }
    } finally {
      setSyncing(false);
    }
  }
  return (
    <Card className="shadow-none">
      <CardHeader className="gap-3 md:flex-row md:items-center md:justify-between">
        <div><CardTitle>House rounds</CardTitle><CardDescription>Scan or open a house to complete the guided checklist.</CardDescription></div>
        <Button type="button" variant="outline" onClick={syncQueued} disabled={syncing}><RefreshCcw data-icon="inline-start" />{syncing ? "Syncing..." : "Sync queue"}</Button>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader><TableRow><TableHead>House</TableHead><TableHead>Flock</TableHead><TableHead>Template</TableHead><TableHead>Status</TableHead><TableHead className="w-16" /></TableRow></TableHeader>
          <TableBody>{rounds.map((round) => <TableRow key={round.houseId}><TableCell><div className="font-medium">{round.houseCode}</div><div className="text-xs text-muted-foreground">{round.houseName}</div></TableCell><TableCell>{round.flockCode ?? "No active flock"}</TableCell><TableCell>{round.templateVersion ?? "Missing"}</TableCell><TableCell><StatusBadge status={round.status} /></TableCell><TableCell><Button asChild variant="ghost" size="icon-sm"><Link href={round.inspectionId ? `/${organizationSlug}/rounds/${round.inspectionId}` : `/${organizationSlug}/houses/${round.houseId}/round`} aria-label={`Open ${round.houseCode}`}><ArrowUpRight className="size-4" /></Link></Button></TableCell></TableRow>)}</TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function ScanCard({ organizationSlug }: { organizationSlug: string }) {
  const [code, setCode] = useState("");
  return (
    <Card className="shadow-none">
      <CardHeader><CardTitle>Scan entry</CardTitle><CardDescription>Paste or type a printable house QR code when camera scan is unavailable.</CardDescription></CardHeader>
      <CardContent className="flex flex-col gap-2 sm:flex-row">
        <div className="relative min-w-0 flex-1"><ScanLine className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input value={code} onChange={(event) => setCode(event.target.value)} className="pl-9" aria-label="Printable code" /></div>
        <Button asChild disabled={!code.trim()}><Link href={`/${organizationSlug}/scan?code=${encodeURIComponent(code.trim())}`}><Search data-icon="inline-start" />Resolve</Link></Button>
      </CardContent>
    </Card>
  );
}

function ObservationTable({ observations }: { observations: Observation[] }) {
  return (
    <Card className="shadow-none">
      <CardContent className="pt-6">
        <Table>
          <TableHeader><TableRow><TableHead>Finding</TableHead><TableHead>Severity</TableHead><TableHead>Status</TableHead><TableHead>Created</TableHead></TableRow></TableHeader>
          <TableBody>{observations.map((observation) => <TableRow key={observation.id}><TableCell><div className="font-medium">{observation.category}</div><div className="text-xs text-muted-foreground">{observation.description}</div></TableCell><TableCell><StatusBadge status={observation.severity} /></TableCell><TableCell><StatusBadge status={observation.status} /></TableCell><TableCell>{formatDateTime(observation.createdAt)}</TableCell></TableRow>)}</TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function Header({ title, description }: { title: string; description: string }) {
  return (
    <div className="space-y-1">
      <h1 className="text-xl font-medium tracking-normal">{title}</h1>
      <p className="max-w-2xl text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

function MetricCard({ icon: Icon, label, value }: { icon: typeof ClipboardList; label: string; value: number }) {
  return (
    <Card className="shadow-none">
      <CardContent className="flex items-center gap-3 pt-6">
        <Icon className="size-5 text-muted-foreground" />
        <div><div className="text-2xl font-semibold tabular-nums">{value}</div><div className="text-sm text-muted-foreground">{label}</div></div>
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: string }) {
  const variant = ["critical", "rejected", "missing_template"].includes(status) ? "destructive" : ["submitted", "synced", "locked", "approved"].includes(status) ? "default" : "secondary";
  return <Badge variant={variant}>{status.replace(/_/g, " ")}</Badge>;
}

function ErrorBanner({ message }: { message: string }) {
  return <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{message}</div>;
}

function selectItem(item: string) {
  return <SelectItem key={item} value={item}>{item.replace(/_/g, " ")}</SelectItem>;
}

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function nullableText(formData: FormData, key: string): string | null {
  const value = text(formData, key);
  return value.length > 0 ? value : null;
}

function valueFor(formData: FormData, key: string, responseType: string): string | number | boolean | null {
  const value = text(formData, key);
  if (responseType === "number") return value ? Number(value) : 0;
  if (responseType === "boolean") return ["true", "yes", "1", "ok"].includes(value.toLowerCase());
  return value || null;
}

function buildObservation(formData: FormData, round: DueRound) {
  const description = nullableText(formData, "observationDescription");
  if (!description) return [];
  return [{
    siteId: round.siteId,
    houseId: round.houseId,
    flockId: round.flockId,
    category: text(formData, "observationCategory") as "health" | "environment" | "feed_water" | "litter" | "equipment" | "production" | "biosecurity" | "other",
    severity: text(formData, "observationSeverity") as "info" | "low" | "medium" | "high" | "critical",
    description,
    immediateAction: null,
    followUpType: null,
    media: [],
  }];
}

function handleResult(result: Result, setError: (value: string | null) => void, router: ReturnType<typeof useRouter>) {
  if (!result.ok) {
    setError(result.message);
    return;
  }
  router.refresh();
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
