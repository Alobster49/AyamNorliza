"use client";

import Link from "next/link";
import {
  AlertTriangle,
  Bell,
  ClipboardCheck,
  FileClock,
  LifeBuoy,
  ShieldCheck,
  TrendingUp,
  Users,
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
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type {
  OperationsPriorityItem,
  OverviewDashboardSummary,
} from "../summary-model";

type OperationsOverviewClientProps = {
  organizationName: string;
  organizationSlug: string;
  summary: OverviewDashboardSummary;
};

const priorityTabs = [
  { value: "all", label: "All" },
  { value: "operations", label: "Operations" },
  { value: "access", label: "Access" },
  { value: "support", label: "Support" },
  { value: "audit", label: "Audit" },
] as const;

export function OperationsOverviewClient({
  organizationName,
  organizationSlug,
  summary,
}: OperationsOverviewClientProps) {
  const cards = [
    {
      title: "Active members",
      value: summary.identity.activeMembers.toLocaleString(),
      helper: `${summary.identity.suspendedMembers} suspended`,
      icon: Users,
      href: `/${organizationSlug}/settings/users`,
    },
    {
      title: "Pending invites",
      value: summary.identity.pendingInvitations.toLocaleString(),
      helper: `${summary.identity.expiringInvitations} expiring soon`,
      icon: ShieldCheck,
      href: `/${organizationSlug}/settings/users`,
    },
    {
      title: "Access reviews",
      value: summary.identity.openAccessReviews.toLocaleString(),
      helper: "Open or in progress",
      icon: ClipboardCheck,
      href: `/${organizationSlug}/settings/access-reviews`,
    },
    {
      title: "Support sessions",
      value: summary.identity.activeSupportSessions.toLocaleString(),
      helper: "Active right now",
      icon: LifeBuoy,
      href: `/${organizationSlug}/settings/support-sessions`,
    },
    {
      title: "Open alerts",
      value: summary.operations.alerts.open.toLocaleString(),
      helper: `${summary.operations.alerts.critical} critical`,
      icon: Bell,
      href: `/${organizationSlug}/alerts`,
    },
    {
      title: "Readiness",
      value: `${summary.operations.readinessScore}%`,
      helper: "Operational snapshot",
      icon: TrendingUp,
      href: `/${organizationSlug}/overview`,
    },
  ];

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
      <section className="grid gap-4 rounded-lg border bg-card p-4 shadow-sm md:grid-cols-[1.5fr_1fr] md:p-6">
        <div className="min-w-0 space-y-3">
          <Badge variant="outline" className="border-primary/30 text-primary">
            Signed-in operations overview
          </Badge>
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold tracking-normal text-foreground md:text-3xl">
              {organizationName} command center
            </h1>
            <p className="max-w-3xl text-sm text-muted-foreground md:text-base">
              A farm-to-table operating view for access control, alert focus,
              flock readiness, and the next work that needs attention.
            </p>
          </div>
        </div>
        <div className="grid gap-3 rounded-md border bg-muted/40 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Operational readiness</p>
              <p className="text-xs text-muted-foreground">
                Placeholder farm metrics until operations modules are live
              </p>
            </div>
            <span className="text-2xl font-semibold tabular-nums">
              {summary.operations.readinessScore}%
            </span>
          </div>
          <Progress value={summary.operations.readinessScore} />
          <div className="flex flex-wrap gap-2">
            <Badge className="bg-primary text-primary-foreground">
              {summary.operations.alerts.open} open alerts
            </Badge>
            <Badge variant="secondary">
              {summary.identity.recentAuditEvents} recent audit events
            </Badge>
          </div>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
        {cards.map((card) => (
          <Card key={card.title} className="min-w-0 overflow-hidden">
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <CardDescription className="truncate">{card.title}</CardDescription>
              <card.icon className="size-4 shrink-0 text-primary" />
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="text-2xl font-semibold tabular-nums">{card.value}</div>
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-xs text-muted-foreground">{card.helper}</p>
                <Button asChild variant="ghost" size="sm" className="h-7 shrink-0 px-2 text-xs">
                  <Link href={card.href}>Open</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.3fr_0.7fr]">
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Weekly farm pulse</CardTitle>
            <CardDescription>
              Livability, feed reserve, and environment trend placeholders.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid min-h-56 grid-cols-7 items-end gap-2 rounded-md border bg-muted/30 p-4">
              {summary.operations.trend.map((point) => (
                <div key={point.label} className="flex min-w-0 flex-col items-center gap-2">
                  <div className="flex h-40 w-full max-w-12 items-end gap-1">
                    <span
                      className="w-1/3 rounded-t bg-primary"
                      style={{ height: `${point.livability}%` }}
                      aria-label={`${point.label} livability ${point.livability}%`}
                    />
                    <span
                      className="w-1/3 rounded-t bg-chart-2"
                      style={{ height: `${point.feedIndex}%` }}
                      aria-label={`${point.label} feed index ${point.feedIndex}%`}
                    />
                    <span
                      className="w-1/3 rounded-t bg-accent"
                      style={{ height: `${point.environment}%` }}
                      aria-label={`${point.label} environment ${point.environment}%`}
                    />
                  </div>
                  <span className="text-xs text-muted-foreground">{point.label}</span>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <span className="size-2 rounded-full bg-primary" />
                Livability
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="size-2 rounded-full bg-chart-2" />
                Feed index
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="size-2 rounded-full bg-accent" />
                Environment
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Flock highlights</CardTitle>
            <CardDescription>Current operating signals for the site.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {summary.operations.flockHighlights.map((item) => (
              <div key={item.label} className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{item.label}</p>
                    <p className="truncate text-xs text-muted-foreground">{item.helper}</p>
                  </div>
                  <Badge variant="outline" className={toneClass(item.tone)}>
                    {item.value}
                  </Badge>
                </div>
                <Separator />
              </div>
            ))}
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader className="gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle>Priority queue</CardTitle>
            <CardDescription>
              Access, support, audit, and operations items sorted for quick triage.
            </CardDescription>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href={`/${organizationSlug}/alerts`}>
              <AlertTriangle className="size-4" />
              Alerts
            </Link>
          </Button>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="all" className="gap-4">
            <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 bg-muted/60 md:w-fit">
              {priorityTabs.map((tab) => (
                <TabsTrigger key={tab.value} value={tab.value}>
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>
            {priorityTabs.map((tab) => (
              <TabsContent key={tab.value} value={tab.value}>
                <PriorityTable
                  organizationSlug={organizationSlug}
                  items={filterPriorityItems(summary.priorityItems, tab.value)}
                />
              </TabsContent>
            ))}
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}

function PriorityTable({
  organizationSlug,
  items,
}: {
  organizationSlug: string;
  items: OperationsPriorityItem[];
}) {
  if (items.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
        No items in this queue.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Item</TableHead>
            <TableHead className="hidden md:table-cell">Status</TableHead>
            <TableHead className="hidden lg:table-cell">When</TableHead>
            <TableHead className="text-right">Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <TableRow key={item.id}>
              <TableCell>
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className={severityClass(item.severity)}>
                      {item.severity}
                    </Badge>
                    <span className="font-medium">{item.title}</span>
                  </div>
                  <p className="line-clamp-2 text-sm text-muted-foreground">{item.detail}</p>
                </div>
              </TableCell>
              <TableCell className="hidden md:table-cell">{item.status}</TableCell>
              <TableCell className="hidden lg:table-cell text-muted-foreground">
                {formatTimestamp(item.timestamp)}
              </TableCell>
              <TableCell className="text-right">
                <Button asChild variant="ghost" size="sm">
                  <Link href={resolveHref(organizationSlug, item.href)}>Review</Link>
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function filterPriorityItems(
  items: OperationsPriorityItem[],
  value: (typeof priorityTabs)[number]["value"],
): OperationsPriorityItem[] {
  return value === "all" ? items : items.filter((item) => item.category === value);
}

function resolveHref(organizationSlug: string, href?: string): string {
  if (!href) return `/${organizationSlug}/overview`;
  return href.startsWith("/") ? `/${organizationSlug}${href}` : href;
}

function formatTimestamp(value?: string): string {
  if (!value) return "Now";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-MY", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function severityClass(severity: OperationsPriorityItem["severity"]): string {
  switch (severity) {
    case "critical":
      return "border-primary/40 bg-primary/10 text-primary";
    case "high":
      return "border-orange-500/40 bg-orange-500/10 text-orange-700 dark:text-orange-300";
    case "medium":
      return "border-yellow-500/50 bg-yellow-400/20 text-yellow-700 dark:text-yellow-200";
    case "low":
      return "border-slate-400/40 text-muted-foreground";
  }
}

function toneClass(tone: "success" | "warning" | "danger" | "neutral"): string {
  switch (tone) {
    case "success":
      return "border-green-500/40 bg-green-500/10 text-green-700 dark:text-green-300";
    case "warning":
      return "border-yellow-500/50 bg-yellow-400/20 text-yellow-700 dark:text-yellow-200";
    case "danger":
      return "border-primary/40 bg-primary/10 text-primary";
    case "neutral":
      return "border-border text-foreground";
  }
}
