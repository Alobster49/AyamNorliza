"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ArrowUpRight, CheckCircle2, ClipboardList, Filter, Plus, Search } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { House, ProductionProfile, Site, TargetProfileVersion } from "@/features/farm-structure/types";
import {
  approveFlockPlanAction,
  approveHouseReadinessAction,
  closeFlockAction,
  createFlockPlanAction,
  recordFlockMovementAction,
  recordHarvestPlanAction,
  recordPlacementAction,
  type ActionResult,
} from "../server/actions";
import type { Flock, FlockStatus, ProductionType } from "../types";
import {
  filterFlocksForDisplay,
  type FlockProductionTypeFilter,
  type FlockStatusFilter,
} from "../flocks-list-model";

type Result = ActionResult<Record<string, unknown>>;

const flockStatuses: FlockStatus[] = [
  "draft",
  "planned",
  "readiness_pending",
  "ready",
  "active",
  "restricted",
  "harvest_pending",
  "depopulated",
  "closing",
  "closed",
];
const productionTypes: ProductionType[] = ["layer", "broiler", "breeder", "smallholder"];

export function FlocksPageClient({
  organizationSlug,
  flocks,
  sites,
}: {
  organizationSlug: string;
  flocks: Flock[];
  sites: Site[];
}) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<FlockStatusFilter>("all");
  const [siteId, setSiteId] = useState("all");
  const [productionType, setProductionType] = useState<FlockProductionTypeFilter>("all");
  const filtered = useMemo(
    () => filterFlocksForDisplay(flocks, { search, status, siteId, productionType }),
    [flocks, productionType, search, siteId, status],
  );
  const sitesById = new Map(sites.map((site) => [site.id, site]));

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-medium tracking-normal">Flocks</h1>
            <Badge variant="secondary">{flocks.length}</Badge>
          </div>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Plan, place, move, harvest, and close traceable bird cohorts.
          </p>
        </div>
        <Button asChild size="lg">
          <Link href={`/${organizationSlug}/flocks/new`}>
            <Plus data-icon="inline-start" />
            New flock
          </Link>
        </Button>
      </div>

      <Card className="shadow-none">
        <CardHeader className="gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle>Lifecycle register</CardTitle>
            <CardDescription>Open flock plans and current production cohorts.</CardDescription>
          </div>
          <div className="grid gap-2 sm:grid-cols-[minmax(12rem,1fr)_10rem_10rem_10rem]">
            <div className="relative min-w-0">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={(event) => setSearch(event.target.value)} className="pl-9" aria-label="Search flocks" />
            </div>
            <FilterSelect value={status} onValueChange={(value) => setStatus(value as FlockStatusFilter)} items={["all", ...flockStatuses]} label="Status" />
            <FilterSelect value={siteId} onValueChange={setSiteId} items={["all", ...sites.map((site) => site.id)]} label="Site" labels={new Map([["all", "All sites"], ...sites.map((site) => [site.id, site.code] as const)])} />
            <FilterSelect value={productionType} onValueChange={(value) => setProductionType(value as FlockProductionTypeFilter)} items={["all", ...productionTypes]} label="Production" />
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Flock</TableHead>
                <TableHead>Site</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Live birds</TableHead>
                <TableHead className="w-16" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((flock) => (
                <TableRow key={flock.id}>
                  <TableCell>
                    <div className="font-medium">{flock.code}</div>
                    <div className="text-xs text-muted-foreground">{flock.name}</div>
                  </TableCell>
                  <TableCell>{sitesById.get(flock.siteId)?.code ?? "Unknown"}</TableCell>
                  <TableCell><StatusBadge status={flock.status} /></TableCell>
                  <TableCell className="text-right tabular-nums">{flock.currentLiveBirds.toLocaleString()}</TableCell>
                  <TableCell>
                    <Button asChild variant="ghost" size="icon-sm" className="rounded-full">
                      <Link href={`/${organizationSlug}/flocks/${flock.id}/overview`} aria-label={`Open ${flock.code}`}>
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

export function NewFlockPageClient({
  organizationId,
  organizationSlug,
  sites,
  houses,
  productionProfiles,
  targetVersions,
}: {
  organizationId: string;
  organizationSlug: string;
  sites: Site[];
  houses: House[];
  productionProfiles: ProductionProfile[];
  targetVersions: TargetProfileVersion[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(formData: FormData) {
    setPending(true);
    setError(null);
    try {
      const houseId = text(formData, "houseId");
      const selectedHouse = houses.find((house) => house.id === houseId);
      const result = await createFlockPlanAction({
        organizationId,
        siteId: selectedHouse?.siteId ?? text(formData, "siteId"),
        houseId: houseId === "none" ? null : houseId,
        productionProfileId: text(formData, "productionProfileId"),
        targetProfileVersionId: nullableSelect(formData, "targetProfileVersionId"),
        code: text(formData, "code").toUpperCase(),
        name: text(formData, "name"),
        productionType: text(formData, "productionType"),
        sourceName: text(formData, "sourceName"),
        breedStrain: text(formData, "breedStrain"),
        sex: text(formData, "sex"),
        hatchDate: text(formData, "hatchDate"),
        plannedArrivalDate: text(formData, "plannedArrivalDate"),
        expectedEndDate: nullableText(formData, "expectedEndDate"),
        plannedQuantity: numberValue(formData, "plannedQuantity"),
        planNotes: nullableText(formData, "planNotes"),
      });
      handleResult(result as Result, setError, router);
      if (result.ok) router.push(`/${organizationSlug}/flocks/${result.data.flockId}/overview`);
    } finally {
      setPending(false);
    }
  }

  return (
    <form action={onSubmit} className="max-w-3xl space-y-4">
      <div className="space-y-1">
        <h1 className="text-xl font-medium tracking-normal">New flock plan</h1>
        <p className="text-sm text-muted-foreground">Create the draft plan before approval and house readiness.</p>
      </div>
      <Card className="shadow-none">
        <CardContent className="grid gap-4 pt-6 md:grid-cols-2">
          <TextField name="code" label="Code" required />
          <TextField name="name" label="Name" required />
          <SelectField name="productionType" label="Production type" items={productionTypes} />
          <SelectField name="sex" label="Sex" items={["unknown", "mixed", "female", "male"]} />
          <SelectField name="productionProfileId" label="Production profile" items={productionProfiles.map((profile) => profile.id)} labels={new Map(productionProfiles.map((profile) => [profile.id, profile.name]))} />
          <SelectField name="targetProfileVersionId" label="Target version" items={["none", ...targetVersions.map((version) => version.id)]} labels={new Map([["none", "No target version"], ...targetVersions.map((version) => [version.id, version.version] as const)])} />
          <SelectField name="siteId" label="Fallback site" items={sites.map((site) => site.id)} labels={new Map(sites.map((site) => [site.id, site.code]))} />
          <SelectField name="houseId" label="House" items={["none", ...houses.map((house) => house.id)]} labels={new Map([["none", "Assign later"], ...houses.map((house) => [house.id, house.code] as const)])} />
          <TextField name="sourceName" label="Source" required />
          <TextField name="breedStrain" label="Breed / strain" required />
          <TextField name="hatchDate" label="Hatch date" type="date" required />
          <TextField name="plannedArrivalDate" label="Planned arrival" type="date" required />
          <TextField name="expectedEndDate" label="Expected end" type="date" />
          <TextField name="plannedQuantity" label="Planned quantity" type="number" required />
          <div className="md:col-span-2">
            <TextField name="planNotes" label="Plan notes" />
          </div>
        </CardContent>
      </Card>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <Button type="submit" disabled={pending}>{pending ? "Creating..." : "Create plan"}</Button>
    </form>
  );
}

export function FlockDetailClient({
  organizationId,
  organizationSlug,
  flock,
  view,
}: {
  organizationId: string;
  organizationSlug: string;
  flock: Flock;
  view: "overview" | "readiness" | "placement" | "movements" | "harvest" | "closeout";
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-medium tracking-normal">{flock.code}</h1>
            <StatusBadge status={flock.status} />
          </div>
          <p className="text-sm text-muted-foreground">{flock.name}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {["overview", "readiness", "placement", "movements", "harvest", "closeout"].map((item) => (
            <Button key={item} asChild variant={view === item ? "default" : "outline"} size="sm">
              <Link href={`/${organizationSlug}/flocks/${flock.id}/${item}`}>{title(item)}</Link>
            </Button>
          ))}
        </div>
      </div>
      {view === "overview" ? <FlockOverview organizationId={organizationId} flock={flock} /> : null}
      {view === "readiness" ? <ReadinessForm organizationId={organizationId} flock={flock} /> : null}
      {view === "placement" ? <PlacementForm organizationId={organizationId} flock={flock} /> : null}
      {view === "movements" ? <MovementForm organizationId={organizationId} flock={flock} /> : null}
      {view === "harvest" ? <HarvestForm organizationId={organizationId} flock={flock} /> : null}
      {view === "closeout" ? <CloseoutForm organizationId={organizationId} flock={flock} /> : null}
    </div>
  );
}

function FlockOverview({ organizationId, flock }: { organizationId: string; flock: Flock }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  async function approve() {
    const result = await approveFlockPlanAction({
      organizationId,
      flockId: flock.id,
      approvalNotes: "Plan reviewed against house capacity, source, dates, and target profile.",
    });
    handleResult(result as Result, setError, router);
  }
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Metric label="Planned birds" value={flock.plannedQuantity.toLocaleString()} />
      <Metric label="Live birds" value={flock.currentLiveBirds.toLocaleString()} />
      <Metric label="Production" value={flock.productionType} />
      <Card className="md:col-span-3 shadow-none">
        <CardHeader>
          <CardTitle>Plan gate</CardTitle>
          <CardDescription>Approve the draft plan to start readiness.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <Button onClick={approve} disabled={flock.status !== "draft"}>
            <CheckCircle2 className="size-4" />
            Approve plan
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function ReadinessForm({ organizationId, flock }: { organizationId: string; flock: Flock }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    const result = await approveHouseReadinessAction({
      organizationId,
      flockId: flock.id,
      checklistVersion: "v1",
      results: [
        { key: "sanitation", label: "Sanitation release complete", status: "pass" },
        { key: "maintenance", label: "Critical maintenance complete", status: "pass" },
        { key: "calibration", label: "Calibration complete", status: "pass" },
        { key: "supplies", label: "Supplies ready", status: "pass" },
        { key: "environment", label: "Environment stabilized", status: "pass" },
      ],
      approverNotes: "Readiness checklist completed for placement.",
    });
    handleResult(result as Result, setError, router);
  }
  return <WorkflowCard title="House readiness" description="Approve the default readiness gate." error={error} button="Approve readiness" disabled={!["planned", "readiness_pending"].includes(flock.status)} onClick={submit} />;
}

function PlacementForm({ organizationId, flock }: { organizationId: string; flock: Flock }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  async function submit(formData: FormData) {
    const result = await recordPlacementAction({
      organizationId,
      flockId: flock.id,
      placementTime: new Date().toISOString(),
      actualQuantity: numberValue(formData, "actualQuantity"),
      doaQuantity: numberValue(formData, "doaQuantity"),
      vehicleReference: nullableText(formData, "vehicleReference"),
      initialObservations: nullableText(formData, "initialObservations"),
    });
    handleResult(result as Result, setError, router);
  }
  return (
    <WorkflowForm title="Placement" description="Record accepted birds and DOA." error={error} action={submit} button="Record placement" disabled={flock.status !== "ready"}>
      <TextField name="actualQuantity" label="Actual quantity" type="number" required defaultValue={String(flock.plannedQuantity)} />
      <TextField name="doaQuantity" label="DOA" type="number" defaultValue="0" />
      <TextField name="vehicleReference" label="Vehicle" />
      <TextField name="initialObservations" label="Observations" />
    </WorkflowForm>
  );
}

function MovementForm({ organizationId, flock }: { organizationId: string; flock: Flock }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  async function submit(formData: FormData) {
    const result = await recordFlockMovementAction({
      organizationId,
      sourceFlockId: flock.id,
      movementType: text(formData, "movementType"),
      quantity: numberValue(formData, "quantity"),
      reason: text(formData, "reason"),
    });
    handleResult(result as Result, setError, router);
  }
  return (
    <WorkflowForm title="Movement" description="Record transfer, split, merge, or partial removal." error={error} action={submit} button="Record movement" disabled={!["active", "restricted"].includes(flock.status)}>
      <SelectField name="movementType" label="Movement type" items={["transfer_out", "partial_removal", "split", "merge", "transfer_in"]} />
      <TextField name="quantity" label="Quantity" type="number" required />
      <TextField name="reason" label="Reason" required />
    </WorkflowForm>
  );
}

function HarvestForm({ organizationId, flock }: { organizationId: string; flock: Flock }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  async function submit(formData: FormData) {
    const result = await recordHarvestPlanAction({
      organizationId,
      flockId: flock.id,
      plannedDate: text(formData, "plannedDate"),
      destination: text(formData, "destination"),
      expectedQuantity: numberValue(formData, "expectedQuantity"),
      vehicleReference: nullableText(formData, "vehicleReference"),
    });
    handleResult(result as Result, setError, router);
  }
  return (
    <WorkflowForm title="Harvest" description="Plan final removal or harvest." error={error} action={submit} button="Record harvest plan" disabled={flock.status !== "active"}>
      <TextField name="plannedDate" label="Planned date" type="date" required />
      <TextField name="destination" label="Destination" required />
      <TextField name="expectedQuantity" label="Expected quantity" type="number" required defaultValue={String(Math.max(flock.currentLiveBirds, 1))} />
      <TextField name="vehicleReference" label="Vehicle" />
    </WorkflowForm>
  );
}

function CloseoutForm({ organizationId, flock }: { organizationId: string; flock: Flock }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  async function submit(formData: FormData) {
    const result = await closeFlockAction({
      organizationId,
      flockId: flock.id,
      finalLiveBirds: numberValue(formData, "finalLiveBirds"),
      reconciliation: { birdBalanceReviewed: true, source: "web" },
      approvalNotes: text(formData, "approvalNotes"),
    });
    handleResult(result as Result, setError, router);
  }
  return (
    <WorkflowForm title="Closeout" description="Approve final reconciliation and lock the flock." error={error} action={submit} button="Close flock" disabled={!["harvest_pending", "depopulated", "closing"].includes(flock.status)}>
      <TextField name="finalLiveBirds" label="Final live birds" type="number" defaultValue="0" required />
      <TextField name="approvalNotes" label="Approval notes" required defaultValue="Final bird balance, records, and exceptions reviewed." />
    </WorkflowForm>
  );
}

function WorkflowCard({ title, description, error, button, disabled, onClick }: { title: string; description: string; error: string | null; button: string; disabled: boolean; onClick: () => void }) {
  return (
    <Card className="shadow-none">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <Button onClick={onClick} disabled={disabled}><ClipboardList className="size-4" />{button}</Button>
      </CardContent>
    </Card>
  );
}

function WorkflowForm({ title, description, error, action, button, disabled, children }: { title: string; description: string; error: string | null; action: (formData: FormData) => Promise<void>; button: string; disabled: boolean; children: React.ReactNode }) {
  return (
    <form action={action}>
      <Card className="max-w-3xl shadow-none">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          {children}
          <div className="md:col-span-2 space-y-3">
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <Button type="submit" disabled={disabled}>{button}</Button>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Card className="shadow-none">
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
      </CardHeader>
      <CardContent className="text-2xl font-semibold tabular-nums">{value}</CardContent>
    </Card>
  );
}

function TextField({ name, label, type = "text", required, defaultValue }: { name: string; label: string; type?: string; required?: boolean; defaultValue?: string }) {
  return (
    <FieldGroup>
      <FieldLabel htmlFor={name}>{label}</FieldLabel>
      <Input id={name} name={name} type={type} required={required} defaultValue={defaultValue} />
    </FieldGroup>
  );
}

function SelectField({ name, label, items, labels }: { name: string; label: string; items: readonly string[]; labels?: Map<string, string> }) {
  return (
    <FieldGroup>
      <FieldLabel>{label}</FieldLabel>
      <Select name={name} defaultValue={items[0]}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          {items.map((item) => <SelectItem key={item} value={item}>{labels?.get(item) ?? title(item)}</SelectItem>)}
        </SelectContent>
      </Select>
    </FieldGroup>
  );
}

function FilterSelect({ value, onValueChange, items, label, labels }: { value: string; onValueChange: (value: string) => void; items: readonly string[]; label: string; labels?: Map<string, string> }) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => <SelectItem key={item} value={item}>{labels?.get(item) ?? title(item)}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

function StatusBadge({ status }: { status: FlockStatus }) {
  return <Badge variant={status === "active" ? "default" : status === "closed" ? "secondary" : "outline"}>{title(status)}</Badge>;
}

function handleResult(result: Result, setError: (message: string | null) => void, router: ReturnType<typeof useRouter>) {
  if (!result.ok) {
    setError(result.message);
    return;
  }
  setError(null);
  router.refresh();
}

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function nullableText(formData: FormData, key: string): string | null {
  const value = text(formData, key);
  return value.length > 0 ? value : null;
}

function nullableSelect(formData: FormData, key: string): string | null {
  const value = text(formData, key);
  return value && value !== "none" ? value : null;
}

function numberValue(formData: FormData, key: string): number {
  return Number(text(formData, key));
}

function title(value: string): string {
  return value.replace(/_/gu, " ").replace(/\b\w/gu, (char) => char.toUpperCase());
}
