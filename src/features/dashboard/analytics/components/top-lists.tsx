"use client";

import { useFormatter, useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { SalesViewModel, TopParty, TopProduct } from "../sales-model";

function EmptyState() {
  const t = useTranslations("analytics");
  return <p className="py-4 text-sm text-muted-foreground">{t("empty")}</p>;
}

function ProductsTable({ rows }: { rows: TopProduct[] }) {
  const t = useTranslations("analytics.topLists");
  const format = useFormatter();
  if (rows.length === 0) return <EmptyState />;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("name")}</TableHead>
          <TableHead className="text-right">{t("kg")}</TableHead>
          <TableHead className="text-right">{t("revenue")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.name}>
            <TableCell>{row.name}</TableCell>
            <TableCell className="text-right tabular-nums">
              {format.number(row.kg, { maximumFractionDigits: 1 })}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {format.number(row.revenue, { style: "currency", currency: "MYR" })}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function PartyTable({ rows }: { rows: TopParty[] }) {
  const t = useTranslations("analytics.topLists");
  const format = useFormatter();
  if (rows.length === 0) return <EmptyState />;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("name")}</TableHead>
          <TableHead className="text-right">{t("orders")}</TableHead>
          <TableHead className="text-right">{t("revenue")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.name}>
            <TableCell>{row.name}</TableCell>
            <TableCell className="text-right tabular-nums">{format.number(row.orders)}</TableCell>
            <TableCell className="text-right tabular-nums">
              {format.number(row.revenue, { style: "currency", currency: "MYR" })}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function TopLists({ vm }: { vm: SalesViewModel }) {
  const t = useTranslations("analytics.topLists");
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">{t("title")}</CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="products">
          <TabsList>
            <TabsTrigger value="products">{t("products")}</TabsTrigger>
            <TabsTrigger value="customers">{t("customers")}</TabsTrigger>
            <TabsTrigger value="zones">{t("zones")}</TabsTrigger>
          </TabsList>
          <TabsContent value="products">
            <ProductsTable rows={vm.topProducts} />
          </TabsContent>
          <TabsContent value="customers">
            <PartyTable rows={vm.topCustomers} />
          </TabsContent>
          <TabsContent value="zones">
            <PartyTable rows={vm.topZones} />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
