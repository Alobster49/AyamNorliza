"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, type ComponentProps, type ReactNode } from "react";
import {
  ArrowUpRight,
  CheckCircle2,
  ClipboardList,
  Database,
  Filter,
  Home,
  Layers3,
  Plus,
  Search,
  ShieldAlert,
  Tag,
  Target,
  Warehouse,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Field,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  approveTargetProfileVersionAction,
  createHouseAction,
  createHouseAreaAction,
  createSiteAction,
  createStorageLocationAction,
  createTargetProfileVersionAction,
  createZoneAction,
  generateIdentifierAction,
  upsertCodeSetAction,
  upsertCodeValueAction,
  upsertProductionProfileAction,
  upsertTargetProfileAction,
  type ActionResult,
} from "../server/actions";
import type {
  BiosecurityZone,
  CodeSet,
  House,
  HouseArea,
  ProductionProfile,
  QrIdentifier,
  Site,
  StorageLocation,
  TargetCurvePoint,
  TargetProfile,
  TargetProfileVersion,
} from "../types";
import { calculateHierarchyCompleteness } from "../domain";
import {
  buildSiteDetailSummary,
  getReadinessTone,
} from "../site-detail-model";
import {
  filterSitesForDisplay,
  type SiteStatusFilter,
} from "../sites-list-model";
import {
  filterZonesForDisplay,
  type ZoneRiskFilter,
  type ZoneStatusFilter,
} from "../zones-list-model";
import {
  filterStorageForDisplay,
  type StorageRestrictedFilter,
  type StorageStatusFilter,
  type StorageTypeFilter,
} from "../storage-list-model";
import {
  buildTargetProfileRows,
  filterProductionProfilesForDisplay,
  filterTargetProfilesForDisplay,
  type ProductionProfileStatusFilter,
  type ProductionTypeFilter,
  type TargetProfileStatusFilter,
} from "../profiles-list-model";
import {
  filterCodeSetsForDisplay,
  type CodeSetStatusFilter,
  type CodeValueStatusFilter,
} from "../master-data-list-model";
import {
  filterLabelsForDisplay,
  type LabelEntityTypeFilter,
  type LabelStatusFilter,
  type LabelSymbologyFilter,
} from "../labels-list-model";

type Result = ActionResult<Record<string, unknown>>;

const productionTypes = ["layer", "broiler", "breeder", "smallholder"] as const;
const structureStatuses = ["draft", "active", "maintenance", "restricted", "inactive", "retired"] as const;
const siteStatusFilters: SiteStatusFilter[] = ["all", "draft", "active", "inactive", "archived"];
const zoneRiskFilters: ZoneRiskFilter[] = ["all", "low", "medium", "high", "quarantine"];
const zoneStatusFilters: ZoneStatusFilter[] = ["all", ...structureStatuses];
const storageTypes: StorageLocation["locationType"][] = ["feed", "medicine", "chemical", "egg", "spare_part", "general"];
const storageTypeFilters: StorageTypeFilter[] = ["all", ...storageTypes];
const storageRestrictedFilters: StorageRestrictedFilter[] = ["all", "restricted", "standard"];
const storageStatusFilters: StorageStatusFilter[] = ["all", ...structureStatuses];
const productionTypeFilters: ProductionTypeFilter[] = ["all", ...productionTypes];
const productionProfileStatusFilters: ProductionProfileStatusFilter[] = ["all", "draft", "active", "inactive"];
const targetProfileStatusFilters: TargetProfileStatusFilter[] = ["all", "draft", "active", "retired"];
const codeSetStatusFilters: CodeSetStatusFilter[] = ["all", "draft", "active", "inactive"];
const codeValueStatusFilters: CodeValueStatusFilter[] = ["all", "active", "inactive", "superseded"];
const labelEntityTypes = ["house", "site", "zone", "storage_location", "asset", "flock", "lot", "sample", "shipment"];
const labelEntityTypeFilters: LabelEntityTypeFilter[] = ["all", ...labelEntityTypes];
const labelSymbologyFilters: LabelSymbologyFilter[] = ["all", "qr", "code128"];
const labelStatusFilters: LabelStatusFilter[] = ["all", "active", "replaced", "retired"];

export function SitesPageClient({
  organizationId,
  organizationSlug,
  sites,
}: {
  organizationId: string;
  organizationSlug: string;
  sites: Site[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<SiteStatusFilter>("all");
  const filteredSites = useMemo(
    () => filterSitesForDisplay(sites, { search, status: statusFilter }),
    [search, sites, statusFilter],
  );

  function clearFilters() {
    setSearch("");
    setStatusFilter("all");
  }

  async function onSubmit(formData: FormData) {
    setPending(true);
    setError(null);
    try {
      const result = await createSiteAction({
        organizationId,
        name: text(formData, "name"),
        code: text(formData, "code").toUpperCase(),
        timeZone: text(formData, "timeZone"),
        defaultUnitSystem: text(formData, "defaultUnitSystem"),
        currencyCode: text(formData, "currencyCode").toUpperCase(),
        status: text(formData, "status"),
      });
      handleResult(result as Result, setError, router);
      if (result.ok) setDialogOpen(false);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-medium tracking-normal">Sites</h1>
            <Badge variant="secondary">{sites.length}</Badge>
          </div>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Register farm locations and keep their operating profile ready for zones, houses, and storage.
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="lg">
              <Plus data-icon="inline-start" />
              Add site
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-xl">
            <DialogHeader>
              <DialogTitle>Add site</DialogTitle>
              <DialogDescription>
                Create the farm location record used by downstream setup.
              </DialogDescription>
            </DialogHeader>
            {error ? (
              <div
                role="alert"
                className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              >
                {error}
              </div>
            ) : null}
            <form action={onSubmit} className="space-y-5">
              <FieldGroup className="gap-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="site-name">Name</FieldLabel>
                    <Input id="site-name" name="name" minLength={2} maxLength={150} required />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="site-code">Code</FieldLabel>
                    <Input id="site-code" name="code" pattern="[A-Za-z0-9_-]+" required />
                  </Field>
                </div>
                <Field>
                  <FieldLabel htmlFor="site-time-zone">Time zone</FieldLabel>
                  <Input
                    id="site-time-zone"
                    name="timeZone"
                    defaultValue="Asia/Kuala_Lumpur"
                    required
                  />
                </Field>
                <div className="grid gap-4 sm:grid-cols-3">
                  <Field>
                    <FieldLabel>Units</FieldLabel>
                    <Select name="defaultUnitSystem" defaultValue="metric">
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="metric">Metric</SelectItem>
                        <SelectItem value="imperial">Imperial</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="site-currency">Currency</FieldLabel>
                    <Input id="site-currency" name="currencyCode" defaultValue="MYR" maxLength={3} required />
                  </Field>
                  <Field>
                    <FieldLabel>Status</FieldLabel>
                    <Select name="status" defaultValue="draft">
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="draft">Draft</SelectItem>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="inactive">Inactive</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                </div>
              </FieldGroup>
              <DialogFooter>
                <Button type="submit" disabled={pending} className="w-full sm:w-auto">
                  {pending ? "Saving..." : "Create site"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card className="rounded-lg">
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div className="relative w-full md:max-w-sm">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="Search sites"
                className="pl-9"
                placeholder="Search sites, codes, time zones..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <div className="flex items-center gap-2">
              <Filter className="size-4 text-muted-foreground" />
              <Select
                value={statusFilter}
                onValueChange={(value) => setStatusFilter(value as SiteStatusFilter)}
              >
                <SelectTrigger aria-label="Filter by status" className="w-[150px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {siteStatusFilters.map((status) => (
                    <SelectItem key={status} value={status}>
                      {formatLabel(status)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-[180px] text-muted-foreground">Code</TableHead>
                  <TableHead className="min-w-[220px] text-muted-foreground">Name</TableHead>
                  <TableHead className="text-muted-foreground">Status</TableHead>
                  <TableHead className="text-muted-foreground">Time zone</TableHead>
                  <TableHead className="text-muted-foreground">Units</TableHead>
                  <TableHead className="text-muted-foreground">Updated</TableHead>
                  <TableHead className="w-[80px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredSites.length > 0 ? (
                  filteredSites.map((site) => (
                    <TableRow key={site.id}>
                      <TableCell>
                        <code className="rounded-md bg-secondary px-2 py-1 font-mono text-xs text-secondary-foreground">
                          {site.code}
                        </code>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{site.name}</div>
                        <div className="text-xs text-muted-foreground">{site.currencyCode}</div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusBadgeVariant(site.status)}>{formatLabel(site.status)}</Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{site.timeZone}</TableCell>
                      <TableCell className="text-muted-foreground">{formatLabel(site.defaultUnitSystem)}</TableCell>
                      <TableCell className="text-muted-foreground">{formatDate(site.updatedAt)}</TableCell>
                      <TableCell className="text-right">
                        <Button asChild variant="ghost" size="sm">
                          <Link href={`/${organizationSlug}/settings/sites/${site.id}`}>
                            Open
                            <ArrowUpRight data-icon="inline-end" />
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={7}>
                      <div className="flex min-h-32 flex-col items-center justify-center gap-3 py-6 text-center">
                        <div className="space-y-1">
                          <p className="font-medium">
                            {sites.length === 0 ? "No sites yet" : "No sites match your filters"}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {sites.length === 0
                              ? "Add the first farm site to continue setup."
                              : "Try a different search or status."}
                          </p>
                        </div>
                        {sites.length === 0 ? (
                          <Button type="button" onClick={() => setDialogOpen(true)}>
                            <Plus data-icon="inline-start" />
                            Add site
                          </Button>
                        ) : (
                          <Button type="button" variant="outline" onClick={clearFilters}>
                            Clear filters
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function SiteDetailClient({
  site,
  zones,
  houses,
  storageLocations,
  organizationSlug,
}: {
  site: Site;
  zones: BiosecurityZone[];
  houses: House[];
  storageLocations: StorageLocation[];
  organizationSlug: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [zoneDialogOpen, setZoneDialogOpen] = useState(false);
  const [houseDialogOpen, setHouseDialogOpen] = useState(false);
  const [storageDialogOpen, setStorageDialogOpen] = useState(false);
  const completeness = calculateHierarchyCompleteness({
    site,
    zones,
    houses: houses.map((house) => ({ status: house.operationalStatus })),
    storageLocations,
  });
  const readinessTone = getReadinessTone(completeness);
  const summary = buildSiteDetailSummary({ zones, houses, storageLocations });

  async function createZone(formData: FormData) {
    setPending(true);
    setError(null);
    try {
      const result = await createZoneAction({
        organizationId: site.organizationId,
        siteId: site.id,
        name: text(formData, "zoneName"),
        code: text(formData, "zoneCode").toUpperCase(),
        riskClass: text(formData, "riskClass"),
        status: text(formData, "zoneStatus"),
      });
      handleResult(result as Result, setError, router);
      if (result.ok) setZoneDialogOpen(false);
    } finally {
      setPending(false);
    }
  }

  async function createHouse(formData: FormData) {
    setPending(true);
    setError(null);
    try {
      const result = await createHouseAction({
        organizationId: site.organizationId,
        siteId: site.id,
        zoneId: nullableSelectText(formData, "houseZoneId"),
        code: text(formData, "houseCode").toUpperCase(),
        name: text(formData, "houseName"),
        capacityBirds: numberValue(formData, "capacityBirds"),
        lengthMeters: nullableNumber(formData, "lengthMeters"),
        widthMeters: nullableNumber(formData, "widthMeters"),
        housingSystem: text(formData, "housingSystem"),
        productionPurpose: text(formData, "productionPurpose"),
        operationalStatus: text(formData, "operationalStatus"),
      });
      handleResult(result as Result, setError, router);
      if (result.ok) setHouseDialogOpen(false);
    } finally {
      setPending(false);
    }
  }

  async function createStorage(formData: FormData) {
    setPending(true);
    setError(null);
    try {
      const result = await createStorageLocationAction({
        organizationId: site.organizationId,
        siteId: site.id,
        zoneId: nullableSelectText(formData, "storageZoneId"),
        code: text(formData, "storageCode").toUpperCase(),
        name: text(formData, "storageName"),
        locationType: text(formData, "locationType"),
        restricted: formData.get("restricted") === "on",
        status: text(formData, "storageStatus"),
      });
      handleResult(result as Result, setError, router);
      if (result.ok) setStorageDialogOpen(false);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-medium tracking-normal">{site.name}</h1>
            <Badge variant="secondary">{site.code}</Badge>
            <Badge variant={statusBadgeVariant(site.status)}>{formatLabel(site.status)}</Badge>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span>{site.timeZone}</span>
            <span>{formatLabel(site.defaultUnitSystem)}</span>
            <span>{site.currencyCode}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline">
            <Link href={`/${organizationSlug}/settings/sites`}>
              <Layers3 data-icon="inline-start" />
              Sites
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={`/${organizationSlug}/settings/labels`}>
              <ClipboardList data-icon="inline-start" />
              Labels
            </Link>
          </Button>
        </div>
      </div>

      {error ? (
        <div
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.8fr)]">
        <Card className="rounded-lg">
          <CardHeader className="gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <CardTitle>Site readiness</CardTitle>
              <CardDescription>Required setup before the site is operational.</CardDescription>
            </div>
            <Badge variant={readinessBadgeVariant(readinessTone.tone)}>
              {readinessTone.label}
            </Badge>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-end gap-3">
              <div className="text-3xl font-medium">{completeness.score}%</div>
              <div className="pb-1 text-sm text-muted-foreground">complete</div>
            </div>
            <Progress value={completeness.score} />
            {completeness.missing.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {completeness.missing.map((item) => (
                  <Badge key={item} variant="outline" className="gap-1">
                    <ShieldAlert data-icon="inline-start" />
                    {item}
                  </Badge>
                ))}
              </div>
            ) : (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <CheckCircle2 className="size-4 text-emerald-500" />
                Ready for farm operations.
              </div>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
          <Dialog open={zoneDialogOpen} onOpenChange={setZoneDialogOpen}>
            <Card className="rounded-lg">
              <CardContent className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 font-medium">
                    <Layers3 className="size-4 text-muted-foreground" />
                    Zones
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {summary.zones.active}/{summary.zones.total} active
                  </p>
                </div>
                <DialogTrigger asChild>
                  <Button size="sm">
                    <Plus data-icon="inline-start" />
                    Add
                  </Button>
                </DialogTrigger>
              </CardContent>
            </Card>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>Add zone</DialogTitle>
                <DialogDescription>Create a biosecurity area inside this site.</DialogDescription>
              </DialogHeader>
              <form action={createZone} className="space-y-5">
                <FieldGroup className="gap-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field>
                      <FieldLabel htmlFor="zone-name">Name</FieldLabel>
                      <Input id="zone-name" name="zoneName" required />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="zone-code">Code</FieldLabel>
                      <Input id="zone-code" name="zoneCode" required />
                    </Field>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field>
                      <FieldLabel>Risk</FieldLabel>
                      <Select name="riskClass" defaultValue="medium">
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {["low", "medium", "high", "quarantine"].map(selectItem)}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field>
                      <FieldLabel>Status</FieldLabel>
                      <Select name="zoneStatus" defaultValue="active">
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>{structureStatuses.map(selectItem)}</SelectContent>
                      </Select>
                    </Field>
                  </div>
                </FieldGroup>
                <DialogFooter>
                  <Button type="submit" disabled={pending} className="w-full sm:w-auto">
                    {pending ? "Saving..." : "Add zone"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>

          <Dialog open={houseDialogOpen} onOpenChange={setHouseDialogOpen}>
            <Card className="rounded-lg">
              <CardContent className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 font-medium">
                    <Home className="size-4 text-muted-foreground" />
                    Houses
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {summary.houses.active}/{summary.houses.total} active
                  </p>
                </div>
                <DialogTrigger asChild>
                  <Button size="sm">
                    <Plus data-icon="inline-start" />
                    Add
                  </Button>
                </DialogTrigger>
              </CardContent>
            </Card>
            <DialogContent className="sm:max-w-2xl">
              <DialogHeader>
                <DialogTitle>Add house</DialogTitle>
                <DialogDescription>Create a production house under this site.</DialogDescription>
              </DialogHeader>
              <form action={createHouse} className="space-y-5">
                <FieldGroup className="gap-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field>
                      <FieldLabel htmlFor="house-name">Name</FieldLabel>
                      <Input id="house-name" name="houseName" required />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="house-code">Code</FieldLabel>
                      <Input id="house-code" name="houseCode" required />
                    </Field>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <Field>
                      <FieldLabel>Zone</FieldLabel>
                      <Select name="houseZoneId" defaultValue="none">
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">No zone</SelectItem>
                          {zones.map((zone) => (
                            <SelectItem key={zone.id} value={zone.id}>
                              {zone.code}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="house-capacity">Capacity</FieldLabel>
                      <Input id="house-capacity" name="capacityBirds" type="number" min={0} defaultValue={0} required />
                    </Field>
                    <Field>
                      <FieldLabel>Status</FieldLabel>
                      <Select name="operationalStatus" defaultValue="draft">
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>{structureStatuses.map(selectItem)}</SelectContent>
                      </Select>
                    </Field>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field>
                      <FieldLabel htmlFor="house-length">Length m</FieldLabel>
                      <Input id="house-length" name="lengthMeters" type="number" min={0} step="0.01" />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="house-width">Width m</FieldLabel>
                      <Input id="house-width" name="widthMeters" type="number" min={0} step="0.01" />
                    </Field>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field>
                      <FieldLabel>Housing</FieldLabel>
                      <Select name="housingSystem" defaultValue="closed_house">
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {["closed_house", "open_sided", "cage", "aviary", "deep_litter", "free_range", "other"].map(selectItem)}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field>
                      <FieldLabel>Purpose</FieldLabel>
                      <Select name="productionPurpose" defaultValue="layer">
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>{productionTypes.map(selectItem)}</SelectContent>
                      </Select>
                    </Field>
                  </div>
                </FieldGroup>
                <DialogFooter>
                  <Button type="submit" disabled={pending} className="w-full sm:w-auto">
                    {pending ? "Saving..." : "Add house"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>

          <Dialog open={storageDialogOpen} onOpenChange={setStorageDialogOpen}>
            <Card className="rounded-lg">
              <CardContent className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 font-medium">
                    <Warehouse className="size-4 text-muted-foreground" />
                    Storage
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {summary.storage.active}/{summary.storage.total} active
                  </p>
                </div>
                <DialogTrigger asChild>
                  <Button size="sm">
                    <Plus data-icon="inline-start" />
                    Add
                  </Button>
                </DialogTrigger>
              </CardContent>
            </Card>
            <DialogContent className="sm:max-w-xl">
              <DialogHeader>
                <DialogTitle>Add storage</DialogTitle>
                <DialogDescription>Create a feed, medicine, egg, or general store.</DialogDescription>
              </DialogHeader>
              <form action={createStorage} className="space-y-5">
                <FieldGroup className="gap-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field>
                      <FieldLabel htmlFor="storage-name">Name</FieldLabel>
                      <Input id="storage-name" name="storageName" required />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="storage-code">Code</FieldLabel>
                      <Input id="storage-code" name="storageCode" required />
                    </Field>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field>
                      <FieldLabel>Zone</FieldLabel>
                      <Select name="storageZoneId" defaultValue="none">
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">No zone</SelectItem>
                          {zones.map((zone) => (
                            <SelectItem key={zone.id} value={zone.id}>
                              {zone.code}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field>
                      <FieldLabel>Type</FieldLabel>
                      <Select name="locationType" defaultValue="general">
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {["feed", "medicine", "chemical", "egg", "spare_part", "general"].map(selectItem)}
                        </SelectContent>
                      </Select>
                    </Field>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field>
                      <FieldLabel>Status</FieldLabel>
                      <Select name="storageStatus" defaultValue="active">
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>{structureStatuses.map(selectItem)}</SelectContent>
                      </Select>
                    </Field>
                    <label className="flex min-h-8 items-center gap-2 rounded-2xl bg-input/50 px-3 text-sm">
                      <input name="restricted" type="checkbox" className="size-4" />
                      Restricted
                    </label>
                  </div>
                </FieldGroup>
                <DialogFooter>
                  <Button type="submit" disabled={pending} className="w-full sm:w-auto">
                    {pending ? "Saving..." : "Add storage"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <HierarchyTables
        organizationSlug={organizationSlug}
        zones={zones}
        houses={houses}
        storageLocations={storageLocations}
        onAddHouse={() => setHouseDialogOpen(true)}
        onAddStorage={() => setStorageDialogOpen(true)}
        onAddZone={() => setZoneDialogOpen(true)}
      />
    </div>
  );
}

export function HouseDetailClient({
  house,
  areas,
  organizationSlug,
}: {
  house: House;
  areas: HouseArea[];
  organizationSlug: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  async function createArea(formData: FormData) {
    const result = await createHouseAreaAction({
      organizationId: house.organizationId,
      houseId: house.id,
      code: text(formData, "code").toUpperCase(),
      name: text(formData, "name"),
      areaType: text(formData, "areaType"),
      capacityBirds: nullableNumber(formData, "capacityBirds"),
      sequence: numberValue(formData, "sequence"),
      status: text(formData, "status"),
    });
    handleResult(result as Result, setError, router);
  }
  return (
    <div>
      {error ? <p role="alert">{error}</p> : null}
      <div className="page-actions"><Link href={`/${organizationSlug}/settings/sites/${house.siteId}`}>Site</Link><Link href={`/${organizationSlug}/settings/labels`}>Labels</Link></div>
      <table className="data-table">
        <tbody>
          <tr><th>Code</th><td><code>{house.code}</code></td></tr>
          <tr><th>Capacity</th><td>{house.capacityBirds}</td></tr>
          <tr><th>Status</th><td>{house.operationalStatus}</td></tr>
          <tr><th>Purpose</th><td>{house.productionPurpose}</td></tr>
        </tbody>
      </table>
      <form action={createArea} className="settings-form">
        <h2>Add area</h2>
        <label>Name<input name="name" required /></label>
        <label>Code<input name="code" required /></label>
        <label>Type<select name="areaType" defaultValue="section"><option value="room">Room</option><option value="pen">Pen</option><option value="tier">Tier</option><option value="section">Section</option><option value="sensor_zone">Sensor zone</option><option value="other">Other</option></select></label>
        <label>Capacity<input name="capacityBirds" type="number" min={0} /></label>
        <label>Sequence<input name="sequence" type="number" min={0} defaultValue={0} /></label>
        <label>Status<select name="status" defaultValue="active">{structureStatuses.map(option)}</select></label>
        <button type="submit">Add area</button>
      </form>
      <table className="data-table">
        <thead><tr><th>Code</th><th>Name</th><th>Type</th><th>Status</th></tr></thead>
        <tbody>{areas.map((area) => <tr key={area.id}><td><code>{area.code}</code></td><td>{area.name}</td><td>{area.areaType}</td><td>{area.status}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

export function ZonesPageClient({
  organizationId,
  sites,
  zones,
}: {
  organizationId: string;
  sites: Site[];
  zones: BiosecurityZone[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [siteFilter, setSiteFilter] = useState<"all" | string>("all");
  const [riskFilter, setRiskFilter] = useState<ZoneRiskFilter>("all");
  const [statusFilter, setStatusFilter] = useState<ZoneStatusFilter>("all");
  const sitesById = useMemo(() => new Map(sites.map((site) => [site.id, site])), [sites]);
  const filteredZones = useMemo(
    () =>
      filterZonesForDisplay(zones, sites, {
        search,
        siteId: siteFilter,
        risk: riskFilter,
        status: statusFilter,
      }),
    [riskFilter, search, siteFilter, sites, statusFilter, zones],
  );

  function clearFilters() {
    setSearch("");
    setSiteFilter("all");
    setRiskFilter("all");
    setStatusFilter("all");
  }

  async function onSubmit(formData: FormData) {
    setPending(true);
    setError(null);
    try {
      const result = await createZoneAction({
        organizationId,
        siteId: text(formData, "siteId"),
        name: text(formData, "name"),
        code: text(formData, "code").toUpperCase(),
        riskClass: text(formData, "riskClass"),
        status: text(formData, "status"),
      });
      handleResult(result as Result, setError, router);
      if (result.ok) setDialogOpen(false);
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-medium tracking-normal">Biosecurity zones</h1>
            <Badge variant="secondary">{zones.length}</Badge>
          </div>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Track farm access areas by site, risk class, and operating status.
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="lg" disabled={sites.length === 0}>
              <Plus data-icon="inline-start" />
              Add zone
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-xl">
            <DialogHeader>
              <DialogTitle>Add zone</DialogTitle>
              <DialogDescription>
                Create a biosecurity area within one of the farm sites.
              </DialogDescription>
            </DialogHeader>
            {error ? (
              <div
                role="alert"
                className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              >
                {error}
              </div>
            ) : null}
            <form action={onSubmit} className="space-y-5">
              <FieldGroup className="gap-4">
                <Field>
                  <FieldLabel>Site</FieldLabel>
                  <Select name="siteId" defaultValue={sites[0]?.id}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {sites.map((site) => (
                        <SelectItem key={site.id} value={site.id}>
                          {site.code}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="zone-name">Name</FieldLabel>
                    <Input id="zone-name" name="name" required />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="zone-code">Code</FieldLabel>
                    <Input id="zone-code" name="code" required />
                  </Field>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field>
                    <FieldLabel>Risk</FieldLabel>
                    <Select name="riskClass" defaultValue="medium">
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {["low", "medium", "high", "quarantine"].map(selectItem)}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field>
                    <FieldLabel>Status</FieldLabel>
                    <Select name="status" defaultValue="active">
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>{structureStatuses.map(selectItem)}</SelectContent>
                    </Select>
                  </Field>
                </div>
              </FieldGroup>
              <DialogFooter>
                <Button type="submit" disabled={pending} className="w-full sm:w-auto">
                  {pending ? "Saving..." : "Add zone"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card className="rounded-lg">
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
            <div className="relative w-full xl:max-w-sm">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="Search zones"
                className="pl-9"
                placeholder="Search zones or sites..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
              <Filter className="hidden size-4 text-muted-foreground sm:block" />
              <Select value={siteFilter} onValueChange={setSiteFilter}>
                <SelectTrigger aria-label="Filter by site" className="w-full sm:w-[180px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All sites</SelectItem>
                  {sites.map((site) => (
                    <SelectItem key={site.id} value={site.id}>
                      {site.code}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={riskFilter} onValueChange={(value) => setRiskFilter(value as ZoneRiskFilter)}>
                <SelectTrigger aria-label="Filter by risk" className="w-full sm:w-[150px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {zoneRiskFilters.map((risk) => (
                    <SelectItem key={risk} value={risk}>
                      {risk === "all" ? "All risks" : formatLabel(risk)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as ZoneStatusFilter)}>
                <SelectTrigger aria-label="Filter by status" className="w-full sm:w-[160px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {zoneStatusFilters.map((status) => (
                    <SelectItem key={status} value={status}>
                      {status === "all" ? "All statuses" : formatLabel(status)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-[160px] text-muted-foreground">Code</TableHead>
                  <TableHead className="min-w-[220px] text-muted-foreground">Name</TableHead>
                  <TableHead className="min-w-[180px] text-muted-foreground">Site</TableHead>
                  <TableHead className="text-muted-foreground">Risk</TableHead>
                  <TableHead className="text-muted-foreground">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredZones.length > 0 ? (
                  filteredZones.map((zone) => {
                    const site = sitesById.get(zone.siteId);

                    return (
                      <TableRow key={zone.id}>
                        <TableCell>
                          <CodeChip value={zone.code} />
                        </TableCell>
                        <TableCell className="font-medium">{zone.name}</TableCell>
                        <TableCell>
                          <div className="font-medium">{site?.code ?? "-"}</div>
                          <div className="text-xs text-muted-foreground">{site?.name ?? "Unknown site"}</div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{formatLabel(zone.riskClass)}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={entityStatusBadgeVariant(zone.status)}>
                            {formatLabel(zone.status)}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })
                ) : (
                  <TableRow>
                    <TableCell colSpan={5}>
                      <div className="flex min-h-32 flex-col items-center justify-center gap-3 py-6 text-center">
                        <div className="space-y-1">
                          <p className="font-medium">
                            {zones.length === 0 ? "No zones yet" : "No zones match your filters"}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {zones.length === 0
                              ? "Add the first biosecurity zone to organize farm access."
                              : "Try a different search, site, risk, or status."}
                          </p>
                        </div>
                        {zones.length === 0 ? (
                          <Button type="button" onClick={() => setDialogOpen(true)} disabled={sites.length === 0}>
                            <Plus data-icon="inline-start" />
                            Add zone
                          </Button>
                        ) : (
                          <Button type="button" variant="outline" onClick={clearFilters}>
                            Clear filters
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function StorageLocationsPageClient({
  organizationId,
  sites,
  zones,
  storageLocations,
}: {
  organizationId: string;
  sites: Site[];
  zones: BiosecurityZone[];
  storageLocations: StorageLocation[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [siteFilter, setSiteFilter] = useState<"all" | string>("all");
  const [zoneFilter, setZoneFilter] = useState<"all" | string>("all");
  const [typeFilter, setTypeFilter] = useState<StorageTypeFilter>("all");
  const [restrictedFilter, setRestrictedFilter] = useState<StorageRestrictedFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StorageStatusFilter>("all");
  const sitesById = useMemo(() => new Map(sites.map((site) => [site.id, site])), [sites]);
  const zonesById = useMemo(() => new Map(zones.map((zone) => [zone.id, zone])), [zones]);
  const filteredStorage = useMemo(
    () =>
      filterStorageForDisplay(storageLocations, sites, zones, {
        search,
        siteId: siteFilter,
        zoneId: zoneFilter,
        type: typeFilter,
        restricted: restrictedFilter,
        status: statusFilter,
      }),
    [restrictedFilter, search, siteFilter, sites, statusFilter, storageLocations, typeFilter, zoneFilter, zones],
  );

  function clearFilters() {
    setSearch("");
    setSiteFilter("all");
    setZoneFilter("all");
    setTypeFilter("all");
    setRestrictedFilter("all");
    setStatusFilter("all");
  }

  async function onSubmit(formData: FormData) {
    setPending(true);
    setError(null);
    try {
      const result = await createStorageLocationAction({
        organizationId,
        siteId: text(formData, "siteId"),
        zoneId: nullableSelectText(formData, "zoneId"),
        code: text(formData, "code").toUpperCase(),
        name: text(formData, "name"),
        locationType: text(formData, "locationType"),
        restricted: formData.get("restricted") === "on",
        status: text(formData, "status"),
      });
      handleResult(result as Result, setError, router);
      if (result.ok) setDialogOpen(false);
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="space-y-4">
      <PageHeader
        actionLabel="Add storage"
        count={storageLocations.length}
        description="Track feed, medicine, egg, and general storage locations across sites."
        icon={Warehouse}
        onAction={() => setDialogOpen(true)}
        title="Storage locations"
      />
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add storage</DialogTitle>
            <DialogDescription>Create a storage location and assign it to a site or zone.</DialogDescription>
          </DialogHeader>
          <FormError message={error} />
          <form action={onSubmit} className="space-y-5">
            <FieldGroup className="gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel>Site</FieldLabel>
                  <Select name="siteId" defaultValue={sites[0]?.id}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>{sites.map((site) => <SelectItem key={site.id} value={site.id}>{site.code}</SelectItem>)}</SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel>Zone</FieldLabel>
                  <Select name="zoneId" defaultValue="none">
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No zone</SelectItem>
                      {zones.map((zone) => <SelectItem key={zone.id} value={zone.id}>{zone.code}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field><FieldLabel htmlFor="storage-name">Name</FieldLabel><Input id="storage-name" name="name" required /></Field>
                <Field><FieldLabel htmlFor="storage-code">Code</FieldLabel><Input id="storage-code" name="code" required /></Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel>Type</FieldLabel>
                  <Select name="locationType" defaultValue="general">
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>{storageTypes.map(selectItem)}</SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel>Status</FieldLabel>
                  <Select name="status" defaultValue="active">
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>{structureStatuses.map(selectItem)}</SelectContent>
                  </Select>
                </Field>
              </div>
              <label className="flex min-h-8 items-center gap-2 rounded-lg bg-input/50 px-3 text-sm">
                <input name="restricted" type="checkbox" className="size-4" />
                Restricted
              </label>
            </FieldGroup>
            <DialogFooter><Button type="submit" disabled={pending}>{pending ? "Saving..." : "Add storage"}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Card className="rounded-lg">
        <CardContent className="space-y-4">
          <FilterToolbar search={search} searchLabel="Search storage" searchPlaceholder="Search storage, sites, zones..." onSearchChange={setSearch}>
            <FilterSelect label="Filter by site" value={siteFilter} onValueChange={setSiteFilter} options={[{ value: "all", label: "All sites" }, ...sites.map((site) => ({ value: site.id, label: site.code }))]} />
            <FilterSelect label="Filter by zone" value={zoneFilter} onValueChange={setZoneFilter} options={[{ value: "all", label: "All zones" }, ...zones.map((zone) => ({ value: zone.id, label: zone.code }))]} />
            <FilterSelect label="Filter by type" value={typeFilter} onValueChange={(value) => setTypeFilter(value as StorageTypeFilter)} options={storageTypeFilters.map((type) => ({ value: type, label: type === "all" ? "All types" : formatLabel(type) }))} />
            <FilterSelect label="Filter by access" value={restrictedFilter} onValueChange={(value) => setRestrictedFilter(value as StorageRestrictedFilter)} options={storageRestrictedFilters.map((value) => ({ value, label: value === "all" ? "All access" : formatLabel(value) }))} />
            <FilterSelect label="Filter by status" value={statusFilter} onValueChange={(value) => setStatusFilter(value as StorageStatusFilter)} options={storageStatusFilters.map((status) => ({ value: status, label: status === "all" ? "All statuses" : formatLabel(status) }))} />
          </FilterToolbar>
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader><TableRow className="hover:bg-transparent"><TableHead>Code</TableHead><TableHead>Name</TableHead><TableHead>Site</TableHead><TableHead>Zone</TableHead><TableHead>Type</TableHead><TableHead>Access</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
              <TableBody>
                {filteredStorage.length > 0 ? filteredStorage.map((location) => {
                  const site = sitesById.get(location.siteId);
                  const zone = location.zoneId ? zonesById.get(location.zoneId) : null;
                  return (
                    <TableRow key={location.id}>
                      <TableCell><CodeChip value={location.code} /></TableCell>
                      <TableCell className="font-medium">{location.name}</TableCell>
                      <TableCell><div className="font-medium">{site?.code ?? "-"}</div><div className="text-xs text-muted-foreground">{site?.name ?? "Unknown site"}</div></TableCell>
                      <TableCell className="text-muted-foreground">{zone?.code ?? "No zone"}</TableCell>
                      <TableCell><Badge variant="outline">{formatLabel(location.locationType)}</Badge></TableCell>
                      <TableCell><Badge variant={location.restricted ? "outline" : "secondary"}>{location.restricted ? "Restricted" : "Standard"}</Badge></TableCell>
                      <TableCell><Badge variant={entityStatusBadgeVariant(location.status)}>{formatLabel(location.status)}</Badge></TableCell>
                    </TableRow>
                  );
                }) : <EmptyTableRow colSpan={7} empty={storageLocations.length === 0} emptyText="No storage yet" filteredText="No storage matches your filters" onPrimary={() => setDialogOpen(true)} onReset={clearFilters} primaryLabel="Add storage" />}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function ProfilesPageClient({
  organizationId,
  productionProfiles,
}: {
  organizationId: string;
  productionProfiles: ProductionProfile[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<ProductionTypeFilter>("all");
  const [statusFilter, setStatusFilter] = useState<ProductionProfileStatusFilter>("all");
  const filteredProfiles = useMemo(
    () => filterProductionProfilesForDisplay(productionProfiles, { search, type: typeFilter, status: statusFilter }),
    [productionProfiles, search, statusFilter, typeFilter],
  );

  function clearFilters() {
    setSearch("");
    setTypeFilter("all");
    setStatusFilter("all");
  }

  async function saveProduction(formData: FormData) {
    setPending(true);
    setError(null);
    try {
      const result = await upsertProductionProfileAction({
        organizationId,
        type: text(formData, "type"),
        name: text(formData, "name"),
        status: text(formData, "status"),
      });
      handleResult(result as Result, setError, router);
      if (result.ok) setDialogOpen(false);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader actionLabel="Add production profile" count={productionProfiles.length} description="Manage production workflows for layers, broilers, breeders, and smallholder operations." icon={ClipboardList} onAction={() => setDialogOpen(true)} title="Production profiles" />
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader><DialogTitle>Add production profile</DialogTitle><DialogDescription>Create a reusable production workflow profile.</DialogDescription></DialogHeader>
          <FormError message={error} />
          <form action={saveProduction} className="space-y-5">
            <FieldGroup className="gap-4">
              <Field><FieldLabel>Type</FieldLabel><Select name="type" defaultValue="layer"><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{productionTypes.map(selectItem)}</SelectContent></Select></Field>
              <Field><FieldLabel htmlFor="production-name">Name</FieldLabel><Input id="production-name" name="name" required /></Field>
              <Field><FieldLabel>Status</FieldLabel><Select name="status" defaultValue="draft"><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{["draft", "active", "inactive"].map(selectItem)}</SelectContent></Select></Field>
            </FieldGroup>
            <DialogFooter><Button type="submit" disabled={pending}>{pending ? "Saving..." : "Save production profile"}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Card className="rounded-lg">
        <CardContent className="space-y-4">
          <FilterToolbar search={search} searchLabel="Search production profiles" searchPlaceholder="Search production profiles..." onSearchChange={setSearch}>
            <FilterSelect label="Filter by type" value={typeFilter} onValueChange={(value) => setTypeFilter(value as ProductionTypeFilter)} options={productionTypeFilters.map((type) => ({ value: type, label: type === "all" ? "All types" : formatLabel(type) }))} />
            <FilterSelect label="Filter by status" value={statusFilter} onValueChange={(value) => setStatusFilter(value as ProductionProfileStatusFilter)} options={productionProfileStatusFilters.map((status) => ({ value: status, label: status === "all" ? "All statuses" : formatLabel(status) }))} />
          </FilterToolbar>
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader><TableRow className="hover:bg-transparent"><TableHead>Type</TableHead><TableHead>Name</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
              <TableBody>
                {filteredProfiles.length > 0 ? filteredProfiles.map((profile) => (
                  <TableRow key={profile.id}>
                    <TableCell><Badge variant="outline">{formatLabel(profile.type)}</Badge></TableCell>
                    <TableCell className="font-medium">{profile.name}</TableCell>
                    <TableCell><Badge variant={profile.status === "active" ? "default" : profile.status === "draft" ? "secondary" : "outline"}>{formatLabel(profile.status)}</Badge></TableCell>
                  </TableRow>
                )) : <EmptyTableRow colSpan={3} empty={productionProfiles.length === 0} emptyText="No production profiles yet" filteredText="No production profiles match your filters" onPrimary={() => setDialogOpen(true)} onReset={clearFilters} primaryLabel="Add production profile" />}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function TargetProfilesPageClient({
  organizationId,
  organizationSlug,
  targetProfiles,
  targetProfileVersions,
}: {
  organizationId: string;
  organizationSlug: string;
  targetProfiles: TargetProfile[];
  targetProfileVersions: TargetProfileVersion[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [targetDialogOpen, setTargetDialogOpen] = useState(false);
  const [versionDialogOpen, setVersionDialogOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<ProductionTypeFilter>("all");
  const [statusFilter, setStatusFilter] = useState<TargetProfileStatusFilter>("all");
  const rows = useMemo(() => buildTargetProfileRows(targetProfiles, targetProfileVersions), [targetProfileVersions, targetProfiles]);
  const filteredRows = useMemo(() => filterTargetProfilesForDisplay(rows, { search, productionType: typeFilter, status: statusFilter }), [rows, search, statusFilter, typeFilter]);

  function clearFilters() {
    setSearch("");
    setTypeFilter("all");
    setStatusFilter("all");
  }

  async function saveTarget(formData: FormData) {
    setPending(true);
    setError(null);
    try {
      const result = await upsertTargetProfileAction({
        organizationId,
        profileFamily: text(formData, "profileFamily"),
        productionType: text(formData, "productionType"),
        breedStrain: text(formData, "breedStrain"),
        housingSystem: nullableText(formData, "housingSystem"),
        region: nullableText(formData, "region"),
        status: text(formData, "targetStatus"),
      });
      handleResult(result as Result, setError, router);
      if (result.ok) setTargetDialogOpen(false);
    } finally {
      setPending(false);
    }
  }

  async function createVersion(formData: FormData) {
    setPending(true);
    setError(null);
    try {
      let points: unknown;
      try {
        points = JSON.parse(text(formData, "points"));
      } catch {
        setError("Points must be valid JSON");
        return;
      }
      const result = await createTargetProfileVersionAction({
        organizationId,
        targetProfileId: text(formData, "targetProfileId"),
        version: text(formData, "version"),
        status: text(formData, "versionStatus"),
        sourceDocument: nullableText(formData, "sourceDocument"),
        points,
      });
      handleResult(result as Result, setError, router);
      if (result.ok) setVersionDialogOpen(false);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader actionLabel="Add target profile" count={targetProfiles.length} description="Maintain breed, housing, and target curve profile families." icon={Target} onAction={() => setTargetDialogOpen(true)} title="Target profiles" />
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={() => setVersionDialogOpen(true)} disabled={targetProfiles.length === 0}><Plus data-icon="inline-start" />Create version</Button>
      </div>
      <Dialog open={targetDialogOpen} onOpenChange={setTargetDialogOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader><DialogTitle>Add target profile</DialogTitle><DialogDescription>Create a target profile family for a breed and production type.</DialogDescription></DialogHeader>
          <FormError message={error} />
          <form action={saveTarget} className="space-y-5">
            <FieldGroup className="gap-4">
              <div className="grid gap-4 sm:grid-cols-2"><Field><FieldLabel htmlFor="target-family">Family</FieldLabel><Input id="target-family" name="profileFamily" required /></Field><Field><FieldLabel>Production</FieldLabel><Select name="productionType" defaultValue="layer"><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{productionTypes.map(selectItem)}</SelectContent></Select></Field></div>
              <div className="grid gap-4 sm:grid-cols-2"><Field><FieldLabel htmlFor="breed-strain">Breed strain</FieldLabel><Input id="breed-strain" name="breedStrain" required /></Field><Field><FieldLabel htmlFor="target-region">Region</FieldLabel><Input id="target-region" name="region" /></Field></div>
              <div className="grid gap-4 sm:grid-cols-2"><Field><FieldLabel htmlFor="housing-system">Housing</FieldLabel><Input id="housing-system" name="housingSystem" /></Field><Field><FieldLabel>Status</FieldLabel><Select name="targetStatus" defaultValue="draft"><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{["draft", "active", "retired"].map(selectItem)}</SelectContent></Select></Field></div>
            </FieldGroup>
            <DialogFooter><Button type="submit" disabled={pending}>{pending ? "Saving..." : "Save target profile"}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={versionDialogOpen} onOpenChange={setVersionDialogOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader><DialogTitle>Create version</DialogTitle><DialogDescription>Add a target curve version for an existing profile.</DialogDescription></DialogHeader>
          <FormError message={error} />
          <form action={createVersion} className="space-y-5">
            <FieldGroup className="gap-4">
              <Field><FieldLabel>Profile</FieldLabel><Select name="targetProfileId" defaultValue={targetProfiles[0]?.id}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{targetProfiles.map((profile) => <SelectItem key={profile.id} value={profile.id}>{profile.profileFamily} / {profile.breedStrain}</SelectItem>)}</SelectContent></Select></Field>
              <div className="grid gap-4 sm:grid-cols-2"><Field><FieldLabel htmlFor="target-version">Version</FieldLabel><Input id="target-version" name="version" defaultValue="2026.1" required /></Field><Field><FieldLabel>Status</FieldLabel><Select name="versionStatus" defaultValue="draft"><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{["draft", "pending_approval"].map(selectItem)}</SelectContent></Select></Field></div>
              <Field><FieldLabel htmlFor="source-document">Source</FieldLabel><Input id="source-document" name="sourceDocument" /></Field>
              <Field><FieldLabel htmlFor="target-points">Points</FieldLabel><textarea id="target-points" name="points" className="min-h-28 rounded-md border bg-background px-3 py-2 text-sm" defaultValue={'[{"metric":"body_weight","ageStartDay":1,"ageEndDay":7,"targetValue":120,"minValue":100,"maxValue":140,"unit":"g"}]'} /></Field>
            </FieldGroup>
            <DialogFooter><Button type="submit" disabled={pending}>{pending ? "Saving..." : "Create version"}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Card className="rounded-lg">
        <CardContent className="space-y-4">
          <FilterToolbar search={search} searchLabel="Search target profiles" searchPlaceholder="Search target profiles..." onSearchChange={setSearch}>
            <FilterSelect label="Filter by production" value={typeFilter} onValueChange={(value) => setTypeFilter(value as ProductionTypeFilter)} options={productionTypeFilters.map((type) => ({ value: type, label: type === "all" ? "All production" : formatLabel(type) }))} />
            <FilterSelect label="Filter by status" value={statusFilter} onValueChange={(value) => setStatusFilter(value as TargetProfileStatusFilter)} options={targetProfileStatusFilters.map((status) => ({ value: status, label: status === "all" ? "All statuses" : formatLabel(status) }))} />
          </FilterToolbar>
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader><TableRow className="hover:bg-transparent"><TableHead>Family</TableHead><TableHead>Production</TableHead><TableHead>Breed</TableHead><TableHead>Status</TableHead><TableHead>Versions</TableHead></TableRow></TableHeader>
              <TableBody>
                {filteredRows.length > 0 ? filteredRows.map((profile) => (
                  <TableRow key={profile.id}>
                    <TableCell className="font-medium">{profile.profileFamily}<div className="text-xs text-muted-foreground">{profile.region ?? "No region"}</div></TableCell>
                    <TableCell><Badge variant="outline">{formatLabel(profile.productionType)}</Badge></TableCell>
                    <TableCell>{profile.breedStrain}</TableCell>
                    <TableCell><Badge variant={profile.status === "active" ? "default" : profile.status === "draft" ? "secondary" : "outline"}>{formatLabel(profile.status)}</Badge></TableCell>
                    <TableCell><div className="flex flex-wrap gap-1">{profile.versions.length > 0 ? profile.versions.map((version) => <Button key={version.id} asChild variant="ghost" size="sm"><Link href={`/${organizationSlug}/settings/target-profiles/${profile.id}/versions/${version.id}`}>{version.version}<ArrowUpRight data-icon="inline-end" /></Link></Button>) : <span className="text-sm text-muted-foreground">No versions</span>}</div></TableCell>
                  </TableRow>
                )) : <EmptyTableRow colSpan={5} empty={targetProfiles.length === 0} emptyText="No target profiles yet" filteredText="No target profiles match your filters" onPrimary={() => setTargetDialogOpen(true)} onReset={clearFilters} primaryLabel="Add target profile" />}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function TargetVersionClient({
  organizationId,
  version,
  points,
}: {
  organizationId: string;
  version: TargetProfileVersion;
  points: TargetCurvePoint[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  async function approve(formData: FormData) {
    const result = await approveTargetProfileVersionAction({
      organizationId,
      versionId: version.id,
      effectiveFrom: text(formData, "effectiveFrom"),
      approvalNotes: text(formData, "approvalNotes"),
    });
    handleResult(result as Result, setError, router);
  }
  return (
    <div>
      {error ? <p role="alert">{error}</p> : null}
      <table className="data-table"><tbody><tr><th>Version</th><td>{version.version}</td></tr><tr><th>Status</th><td>{version.status}</td></tr><tr><th>Hash</th><td><code>{version.definitionHash ?? "not approved"}</code></td></tr></tbody></table>
      {["draft", "pending_approval"].includes(version.status) ? (
        <form action={approve} className="settings-form">
          <h2>Approve</h2>
          <label>Effective from<input name="effectiveFrom" defaultValue={new Date().toISOString()} required /></label>
          <label>Notes<input name="approvalNotes" minLength={3} required /></label>
          <button type="submit">Approve version</button>
        </form>
      ) : null}
      <table className="data-table"><thead><tr><th>Metric</th><th>Age</th><th>Target</th><th>Band</th><th>Unit</th></tr></thead><tbody>{points.map((point) => <tr key={point.id}><td>{point.metric}</td><td>{point.ageStartDay}-{point.ageEndDay}</td><td>{point.targetValue}</td><td>{point.minValue ?? "-"} / {point.maxValue ?? "-"}</td><td>{point.unit}</td></tr>)}</tbody></table>
    </div>
  );
}

export function MasterDataClient({ organizationId, codeSets }: { organizationId: string; codeSets: CodeSet[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [setDialogOpen, setSetDialogOpen] = useState(false);
  const [valueDialogOpen, setValueDialogOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [setStatusFilter, setSetStatusFilter] = useState<CodeSetStatusFilter>("all");
  const [valueStatusFilter, setValueStatusFilter] = useState<CodeValueStatusFilter>("all");
  const filteredCodeSets = useMemo(
    () => filterCodeSetsForDisplay(codeSets, { search, setStatus: setStatusFilter, valueStatus: valueStatusFilter }),
    [codeSets, search, setStatusFilter, valueStatusFilter],
  );

  function clearFilters() {
    setSearch("");
    setSetStatusFilter("all");
    setValueStatusFilter("all");
  }

  async function saveSet(formData: FormData) {
    setPending(true);
    setError(null);
    try {
      const result = await upsertCodeSetAction({
        organizationId,
        key: text(formData, "key"),
        name: text(formData, "name"),
        description: nullableText(formData, "description"),
        status: text(formData, "status"),
      });
      handleResult(result as Result, setError, router);
      if (result.ok) setSetDialogOpen(false);
    } finally {
      setPending(false);
    }
  }
  async function saveValue(formData: FormData) {
    setPending(true);
    setError(null);
    try {
      const result = await upsertCodeValueAction({
        organizationId,
        codeSetId: text(formData, "codeSetId"),
        code: text(formData, "code").toUpperCase(),
        label: text(formData, "label"),
        status: text(formData, "valueStatus"),
      });
      handleResult(result as Result, setError, router);
      if (result.ok) setValueDialogOpen(false);
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="space-y-4">
      <PageHeader actionLabel="Add code set" count={codeSets.length} description="Maintain controlled values used across farm setup and operations." icon={Database} onAction={() => setSetDialogOpen(true)} title="Master data" />
      <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" onClick={() => setValueDialogOpen(true)} disabled={codeSets.length === 0}><Plus data-icon="inline-start" />Add code value</Button></div>
      <Dialog open={setDialogOpen} onOpenChange={setSetDialogOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader><DialogTitle>Add code set</DialogTitle><DialogDescription>Create a controlled vocabulary group.</DialogDescription></DialogHeader>
          <FormError message={error} />
          <form action={saveSet} className="space-y-5">
            <FieldGroup className="gap-4">
              <Field><FieldLabel htmlFor="code-set-key">Key</FieldLabel><Input id="code-set-key" name="key" required /></Field>
              <Field><FieldLabel htmlFor="code-set-name">Name</FieldLabel><Input id="code-set-name" name="name" required /></Field>
              <Field><FieldLabel htmlFor="code-set-description">Description</FieldLabel><Input id="code-set-description" name="description" /></Field>
              <Field><FieldLabel>Status</FieldLabel><Select name="status" defaultValue="active"><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{["draft", "active", "inactive"].map(selectItem)}</SelectContent></Select></Field>
            </FieldGroup>
            <DialogFooter><Button type="submit" disabled={pending}>{pending ? "Saving..." : "Save code set"}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={valueDialogOpen} onOpenChange={setValueDialogOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader><DialogTitle>Add code value</DialogTitle><DialogDescription>Add a value to an existing code set.</DialogDescription></DialogHeader>
          <FormError message={error} />
          <form action={saveValue} className="space-y-5">
            <FieldGroup className="gap-4">
              <Field><FieldLabel>Set</FieldLabel><Select name="codeSetId" defaultValue={codeSets[0]?.id}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{codeSets.map((set) => <SelectItem key={set.id} value={set.id}>{set.key}</SelectItem>)}</SelectContent></Select></Field>
              <div className="grid gap-4 sm:grid-cols-2"><Field><FieldLabel htmlFor="code-value-code">Code</FieldLabel><Input id="code-value-code" name="code" required /></Field><Field><FieldLabel htmlFor="code-value-label">Label</FieldLabel><Input id="code-value-label" name="label" required /></Field></div>
              <Field><FieldLabel>Status</FieldLabel><Select name="valueStatus" defaultValue="active"><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{["active", "inactive", "superseded"].map(selectItem)}</SelectContent></Select></Field>
            </FieldGroup>
            <DialogFooter><Button type="submit" disabled={pending}>{pending ? "Saving..." : "Save code value"}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Card className="rounded-lg">
        <CardContent className="space-y-4">
          <FilterToolbar search={search} searchLabel="Search master data" searchPlaceholder="Search sets and values..." onSearchChange={setSearch}>
            <FilterSelect label="Filter by set status" value={setStatusFilter} onValueChange={(value) => setSetStatusFilter(value as CodeSetStatusFilter)} options={codeSetStatusFilters.map((status) => ({ value: status, label: status === "all" ? "All set statuses" : formatLabel(status) }))} />
            <FilterSelect label="Filter by value status" value={valueStatusFilter} onValueChange={(value) => setValueStatusFilter(value as CodeValueStatusFilter)} options={codeValueStatusFilters.map((status) => ({ value: status, label: status === "all" ? "All value statuses" : formatLabel(status) }))} />
          </FilterToolbar>
          <Tabs defaultValue="sets" className="gap-4">
            <TabsList><TabsTrigger value="sets">Code sets <Badge variant="secondary">{filteredCodeSets.length}</Badge></TabsTrigger><TabsTrigger value="values">Values <Badge variant="secondary">{filteredCodeSets.reduce((sum, set) => sum + set.values.length, 0)}</Badge></TabsTrigger></TabsList>
            <TabsContent value="sets">
              <div className="overflow-x-auto rounded-lg border">
                <Table><TableHeader><TableRow className="hover:bg-transparent"><TableHead>Key</TableHead><TableHead>Name</TableHead><TableHead>Description</TableHead><TableHead>Values</TableHead><TableHead>Status</TableHead></TableRow></TableHeader><TableBody>
                  {filteredCodeSets.length > 0 ? filteredCodeSets.map((set) => <TableRow key={set.id}><TableCell><CodeChip value={set.key} /></TableCell><TableCell className="font-medium">{set.name}</TableCell><TableCell className="text-muted-foreground">{set.description ?? "-"}</TableCell><TableCell>{set.values.length}</TableCell><TableCell><Badge variant={set.status === "active" ? "default" : set.status === "draft" ? "secondary" : "outline"}>{formatLabel(set.status)}</Badge></TableCell></TableRow>) : <EmptyTableRow colSpan={5} empty={codeSets.length === 0} emptyText="No code sets yet" filteredText="No code sets match your filters" onPrimary={() => setSetDialogOpen(true)} onReset={clearFilters} primaryLabel="Add code set" />}
                </TableBody></Table>
              </div>
            </TabsContent>
            <TabsContent value="values">
              <div className="overflow-x-auto rounded-lg border">
                <Table><TableHeader><TableRow className="hover:bg-transparent"><TableHead>Set</TableHead><TableHead>Code</TableHead><TableHead>Label</TableHead><TableHead>Status</TableHead></TableRow></TableHeader><TableBody>
                  {filteredCodeSets.flatMap((set) => set.values.map((value) => ({ set, value }))).length > 0 ? filteredCodeSets.flatMap((set) => set.values.map((value) => <TableRow key={value.id}><TableCell>{set.key}</TableCell><TableCell><CodeChip value={value.code} /></TableCell><TableCell className="font-medium">{value.label}</TableCell><TableCell><Badge variant={value.status === "active" ? "default" : value.status === "inactive" ? "outline" : "secondary"}>{formatLabel(value.status)}</Badge></TableCell></TableRow>)) : <EmptyTableRow colSpan={4} empty={codeSets.length === 0} emptyText="No code values yet" filteredText="No code values match your filters" onPrimary={() => setValueDialogOpen(true)} onReset={clearFilters} primaryLabel="Add code value" />}
                </TableBody></Table>
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}

export function LabelsClient({
  organizationId,
  organizationSlug,
  identifiers,
}: {
  organizationId: string;
  organizationSlug: string;
  identifiers: QrIdentifier[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [entityTypeFilter, setEntityTypeFilter] = useState<LabelEntityTypeFilter>("all");
  const [symbologyFilter, setSymbologyFilter] = useState<LabelSymbologyFilter>("all");
  const [statusFilter, setStatusFilter] = useState<LabelStatusFilter>("all");
  const filteredLabels = useMemo(
    () => filterLabelsForDisplay(identifiers, { search, entityType: entityTypeFilter, symbology: symbologyFilter, status: statusFilter }),
    [entityTypeFilter, identifiers, search, statusFilter, symbologyFilter],
  );

  function clearFilters() {
    setSearch("");
    setEntityTypeFilter("all");
    setSymbologyFilter("all");
    setStatusFilter("all");
  }

  async function generate(formData: FormData) {
    setPending(true);
    setError(null);
    try {
      const result = await generateIdentifierAction({
        organizationId,
        entityType: text(formData, "entityType"),
        entityId: text(formData, "entityId"),
        entityCode: text(formData, "entityCode").toUpperCase(),
        symbology: text(formData, "symbology"),
      });
      handleResult(result as Result, setError, router);
      if (result.ok) setDialogOpen(false);
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="space-y-4">
      <PageHeader actionLabel="Generate label" count={identifiers.length} description="Generate and open printable identifiers for farm entities." icon={Tag} onAction={() => setDialogOpen(true)} title="Labels" />
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader><DialogTitle>Generate label</DialogTitle><DialogDescription>Create a printable code for an entity.</DialogDescription></DialogHeader>
          <FormError message={error} />
          <form action={generate} className="space-y-5">
            <FieldGroup className="gap-4">
              <Field><FieldLabel>Type</FieldLabel><Select name="entityType" defaultValue="house"><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{labelEntityTypes.map(selectItem)}</SelectContent></Select></Field>
              <Field><FieldLabel htmlFor="label-entity-id">Entity id</FieldLabel><Input id="label-entity-id" name="entityId" required /></Field>
              <Field><FieldLabel htmlFor="label-entity-code">Entity code</FieldLabel><Input id="label-entity-code" name="entityCode" required /></Field>
              <Field><FieldLabel>Symbology</FieldLabel><Select name="symbology" defaultValue="qr"><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{["qr", "code128"].map(selectItem)}</SelectContent></Select></Field>
            </FieldGroup>
            <DialogFooter><Button type="submit" disabled={pending}>{pending ? "Generating..." : "Generate label"}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Card className="rounded-lg">
        <CardContent className="space-y-4">
          <FilterToolbar search={search} searchLabel="Search labels" searchPlaceholder="Search labels, entity types, ids..." onSearchChange={setSearch}>
            <FilterSelect label="Filter by type" value={entityTypeFilter} onValueChange={(value) => setEntityTypeFilter(value as LabelEntityTypeFilter)} options={labelEntityTypeFilters.map((type) => ({ value: type, label: type === "all" ? "All types" : formatLabel(type) }))} />
            <FilterSelect label="Filter by symbology" value={symbologyFilter} onValueChange={(value) => setSymbologyFilter(value as LabelSymbologyFilter)} options={labelSymbologyFilters.map((symbology) => ({ value: symbology, label: symbology === "all" ? "All symbologies" : formatLabel(symbology) }))} />
            <FilterSelect label="Filter by status" value={statusFilter} onValueChange={(value) => setStatusFilter(value as LabelStatusFilter)} options={labelStatusFilters.map((status) => ({ value: status, label: status === "all" ? "All statuses" : formatLabel(status) }))} />
          </FilterToolbar>
          <div className="overflow-x-auto rounded-lg border">
            <Table><TableHeader><TableRow className="hover:bg-transparent"><TableHead>Code</TableHead><TableHead>Type</TableHead><TableHead>Symbology</TableHead><TableHead>Status</TableHead><TableHead className="w-[90px]" /></TableRow></TableHeader><TableBody>
              {filteredLabels.length > 0 ? filteredLabels.map((identifier) => <TableRow key={identifier.id}><TableCell><CodeChip value={identifier.printableCode} /></TableCell><TableCell>{formatLabel(identifier.entityType)}</TableCell><TableCell><Badge variant="outline">{formatLabel(identifier.symbology)}</Badge></TableCell><TableCell><Badge variant={identifier.status === "active" ? "default" : identifier.status === "retired" ? "outline" : "secondary"}>{formatLabel(identifier.status)}</Badge></TableCell><TableCell className="text-right"><Button asChild variant="ghost" size="sm"><Link href={`/${organizationSlug}/labels/${identifier.printableCode}`}>Open<ArrowUpRight data-icon="inline-end" /></Link></Button></TableCell></TableRow>) : <EmptyTableRow colSpan={5} empty={identifiers.length === 0} emptyText="No labels yet" filteredText="No labels match your filters" onPrimary={() => setDialogOpen(true)} onReset={clearFilters} primaryLabel="Generate label" />}
            </TableBody></Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function HierarchyTables({
  organizationSlug,
  zones,
  houses,
  storageLocations,
  onAddHouse,
  onAddStorage,
  onAddZone,
}: {
  organizationSlug: string;
  zones: BiosecurityZone[];
  houses: House[];
  storageLocations: StorageLocation[];
  onAddHouse: () => void;
  onAddStorage: () => void;
  onAddZone: () => void;
}) {
  return (
    <Card className="rounded-lg">
      <CardHeader className="gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <CardTitle>Site hierarchy</CardTitle>
          <CardDescription>Manage zones, production houses, and storage locations.</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="zones" className="gap-4">
          <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 bg-muted/60 md:w-fit">
            <TabsTrigger value="zones" className="gap-2">
              Zones
              <Badge variant="secondary">{zones.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="houses" className="gap-2">
              Houses
              <Badge variant="secondary">{houses.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="storage" className="gap-2">
              Storage
              <Badge variant="secondary">{storageLocations.length}</Badge>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="zones">
            {zones.length > 0 ? (
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="w-[160px] text-muted-foreground">Code</TableHead>
                      <TableHead className="min-w-[220px] text-muted-foreground">Name</TableHead>
                      <TableHead className="text-muted-foreground">Risk</TableHead>
                      <TableHead className="text-muted-foreground">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {zones.map((zone) => (
                      <TableRow key={zone.id}>
                        <TableCell>
                          <CodeChip value={zone.code} />
                        </TableCell>
                        <TableCell className="font-medium">{zone.name}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{formatLabel(zone.riskClass)}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={entityStatusBadgeVariant(zone.status)}>
                            {formatLabel(zone.status)}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <HierarchyEmptyState
                actionLabel="Add zone"
                description="Create the first biosecurity area for this site."
                icon={Layers3}
                onAction={onAddZone}
                title="No zones yet"
              />
            )}
          </TabsContent>

          <TabsContent value="houses">
            {houses.length > 0 ? (
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="w-[160px] text-muted-foreground">Code</TableHead>
                      <TableHead className="min-w-[220px] text-muted-foreground">Name</TableHead>
                      <TableHead className="text-muted-foreground">Purpose</TableHead>
                      <TableHead className="text-muted-foreground">Status</TableHead>
                      <TableHead className="w-[90px]" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {houses.map((house) => (
                      <TableRow key={house.id}>
                        <TableCell>
                          <CodeChip value={house.code} />
                        </TableCell>
                        <TableCell>
                          <div className="font-medium">{house.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {house.capacityBirds.toLocaleString()} birds
                          </div>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {formatLabel(house.productionPurpose)}
                        </TableCell>
                        <TableCell>
                          <Badge variant={entityStatusBadgeVariant(house.operationalStatus)}>
                            {formatLabel(house.operationalStatus)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button asChild variant="ghost" size="sm">
                            <Link href={`/${organizationSlug}/settings/houses/${house.id}`}>
                              Open
                              <ArrowUpRight data-icon="inline-end" />
                            </Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <HierarchyEmptyState
                actionLabel="Add house"
                description="Create a production house once the site structure is ready."
                icon={Home}
                onAction={onAddHouse}
                title="No houses yet"
              />
            )}
          </TabsContent>

          <TabsContent value="storage">
            {storageLocations.length > 0 ? (
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="w-[160px] text-muted-foreground">Code</TableHead>
                      <TableHead className="min-w-[220px] text-muted-foreground">Name</TableHead>
                      <TableHead className="text-muted-foreground">Type</TableHead>
                      <TableHead className="text-muted-foreground">Access</TableHead>
                      <TableHead className="text-muted-foreground">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {storageLocations.map((location) => (
                      <TableRow key={location.id}>
                        <TableCell>
                          <CodeChip value={location.code} />
                        </TableCell>
                        <TableCell className="font-medium">{location.name}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {formatLabel(location.locationType)}
                        </TableCell>
                        <TableCell>
                          <Badge variant={location.restricted ? "outline" : "secondary"}>
                            {location.restricted ? "Restricted" : "Standard"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={entityStatusBadgeVariant(location.status)}>
                            {formatLabel(location.status)}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <HierarchyEmptyState
                actionLabel="Add storage"
                description="Add feed, medicine, egg, or general storage locations."
                icon={Warehouse}
                onAction={onAddStorage}
                title="No storage yet"
              />
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

function PageHeader({
  actionLabel,
  count,
  description,
  icon: Icon,
  onAction,
  title,
}: {
  actionLabel: string;
  count: number;
  description: string;
  icon: typeof Layers3;
  onAction: () => void;
  title: string;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <Icon className="size-5 text-muted-foreground" />
          <h1 className="text-xl font-medium tracking-normal">{title}</h1>
          <Badge variant="secondary">{count}</Badge>
        </div>
        <p className="max-w-2xl text-sm text-muted-foreground">{description}</p>
      </div>
      <Button type="button" size="lg" onClick={onAction}>
        <Plus data-icon="inline-start" />
        {actionLabel}
      </Button>
    </div>
  );
}

function FormError({ message }: { message: string | null }) {
  return message ? (
    <div
      role="alert"
      className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
    >
      {message}
    </div>
  ) : null;
}

function FilterToolbar({
  children,
  onSearchChange,
  search,
  searchLabel,
  searchPlaceholder,
}: {
  children: ReactNode;
  onSearchChange: (value: string) => void;
  search: string;
  searchLabel: string;
  searchPlaceholder: string;
}) {
  return (
    <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
      <div className="relative w-full xl:max-w-sm">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          aria-label={searchLabel}
          className="pl-9"
          placeholder={searchPlaceholder}
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
        />
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <Filter className="hidden size-4 text-muted-foreground sm:block" />
        {children}
      </div>
    </div>
  );
}

function FilterSelect({
  label,
  onValueChange,
  options,
  value,
}: {
  label: string;
  onValueChange: (value: string) => void;
  options: Array<{ label: string; value: string }>;
  value: string;
}) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger aria-label={label} className="w-full sm:w-[170px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function EmptyTableRow({
  colSpan,
  empty,
  emptyText,
  filteredText,
  onPrimary,
  onReset,
  primaryLabel,
}: {
  colSpan: number;
  empty: boolean;
  emptyText: string;
  filteredText: string;
  onPrimary: () => void;
  onReset: () => void;
  primaryLabel: string;
}) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan}>
        <div className="flex min-h-32 flex-col items-center justify-center gap-3 py-6 text-center">
          <div className="space-y-1">
            <p className="font-medium">{empty ? emptyText : filteredText}</p>
            <p className="text-sm text-muted-foreground">
              {empty ? "Create the first record to continue setup." : "Try a different search or filter."}
            </p>
          </div>
          {empty ? (
            <Button type="button" onClick={onPrimary}>
              <Plus data-icon="inline-start" />
              {primaryLabel}
            </Button>
          ) : (
            <Button type="button" variant="outline" onClick={onReset}>
              Clear filters
            </Button>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

function CodeChip({ value }: { value: string }) {
  return (
    <code className="rounded-md bg-secondary px-2 py-1 font-mono text-xs text-secondary-foreground">
      {value}
    </code>
  );
}

function HierarchyEmptyState({
  actionLabel,
  description,
  icon: Icon,
  onAction,
  title,
}: {
  actionLabel: string;
  description: string;
  icon: typeof Layers3;
  onAction: () => void;
  title: string;
}) {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center gap-3 rounded-lg border border-dashed py-8 text-center">
      <div className="flex size-10 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
        <Icon className="size-5" />
      </div>
      <div className="space-y-1">
        <p className="font-medium">{title}</p>
        <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
      </div>
      <Button type="button" onClick={onAction}>
        <Plus data-icon="inline-start" />
        {actionLabel}
      </Button>
    </div>
  );
}

function option(value: string) {
  return <option key={value} value={value}>{value.replace(/_/gu, " ")}</option>;
}

function formatLabel(value: string): string {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";

  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(date);
}

function statusBadgeVariant(
  status: Site["status"],
): ComponentProps<typeof Badge>["variant"] {
  if (status === "active") return "default";
  if (status === "inactive" || status === "archived") return "outline";
  return "secondary";
}

function entityStatusBadgeVariant(status: string): ComponentProps<typeof Badge>["variant"] {
  if (status === "active") return "default";
  if (status === "draft" || status === "maintenance" || status === "restricted") return "secondary";
  return "outline";
}

function readinessBadgeVariant(tone: "ready" | "warning" | "blocked"): ComponentProps<typeof Badge>["variant"] {
  if (tone === "ready") return "default";
  if (tone === "blocked") return "destructive";
  return "secondary";
}

function selectItem(value: string) {
  return (
    <SelectItem key={value} value={value}>
      {formatLabel(value)}
    </SelectItem>
  );
}

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function nullableText(formData: FormData, key: string): string | null {
  const value = text(formData, key);
  return value.length > 0 ? value : null;
}

function nullableSelectText(formData: FormData, key: string): string | null {
  const value = text(formData, key);
  return value.length > 0 && value !== "none" ? value : null;
}

function numberValue(formData: FormData, key: string): number {
  const value = Number(formData.get(key) ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function nullableNumber(formData: FormData, key: string): number | null {
  const value = text(formData, key);
  if (!value) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function handleResult(result: Result, setError: (value: string | null) => void, router: ReturnType<typeof useRouter>) {
  if (!result.ok) {
    setError(result.message);
    return;
  }
  setError(null);
  router.refresh();
}
