"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { createCustomer, updateCustomer, deleteCustomer } from "@/features/seller/server/actions";
import type { CustomerWithPortal } from "@/features/seller/types";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AddressFields } from "@/components/forms/address-fields";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { lookupPostcode } from "@/lib/malaysia-postcodes";
import { parseCustomerAddress } from "@/features/seller/lib/customer-schema";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Plus,
  Trash2,
  Pencil,
  Search,
  Phone,
  MapPin,
  StickyNote,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type CustomersClientProps = {
  organizationSlug: string;
  organizationId: string;
  initialCustomers: CustomerWithPortal[];
};

export function CustomersClient({
  organizationSlug,
  organizationId,
  initialCustomers,
}: CustomersClientProps) {
  const { toast } = useToast();
  const t = useTranslations("seller.customers");
  const tCommon = useTranslations("common");
  const [customers, setCustomers] = useState(initialCustomers);
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<CustomerWithPortal | null>(null);
  // Target and visibility are separate so the closing dialog keeps its text
  // through the exit animation.
  const [deleteTarget, setDeleteTarget] = useState<CustomerWithPortal | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    phone: "",
    email: "",
    address: "",
    postcode: "",
    state: "",
    area: "",
    notes: "",
  });

  const filteredCustomers = customers.filter(
    (c) =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.phone.includes(search) ||
      (c.email ?? "").toLowerCase().includes(search.toLowerCase())
  );

  const openCreateDialog = () => {
    setEditingCustomer(null);
    setFormData({
      name: "",
      phone: "",
      email: "",
      address: "",
      postcode: "",
      state: "",
      area: "",
      notes: "",
    });
    setDialogOpen(true);
  };

  const openEditDialog = (customer: CustomerWithPortal) => {
    setEditingCustomer(customer);
    // The SQL backfill could only recover a postcode — it cannot read the
    // vendored dataset. Resolve state and area here so a backfilled customer
    // shows a complete address the first time a seller opens it.
    const derived =
      customer.postcode && !customer.state ? lookupPostcode(customer.postcode) : null;
    setFormData({
      name: customer.name,
      phone: customer.phone,
      email: customer.email || "",
      address: customer.address || "",
      postcode: customer.postcode || "",
      state: customer.state || derived?.state || "",
      area: customer.area || derived?.area || "",
      notes: customer.notes || "",
    });
    setDialogOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Validate client-side before hitting the server action: Next.js redacts
    // uncaught Server Action error messages in production builds, so the
    // "Enter a 5-digit postcode..." message from parseCustomerAddress would
    // otherwise never reach the seller in prod. The server action still
    // calls parseCustomerAddress itself as defence in depth.
    try {
      parseCustomerAddress(formData);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast({ title: t("error"), description: message, variant: "destructive" });
      return;
    }
    try {
      if (editingCustomer) {
        const updated = await updateCustomer(editingCustomer.id, {
          name: formData.name,
          phone: formData.phone,
          email: formData.email || null,
          address: formData.address || null,
          postcode: formData.postcode || null,
          state: formData.state || null,
          area: formData.area || null,
          notes: formData.notes || null,
        });
        setCustomers(
          customers.map((c) =>
            c.id === updated.id
              ? { ...updated, has_portal_account: c.has_portal_account }
              : c
          )
        );
        toast({ title: t("customerUpdated") });
      } else {
        const newCustomer = await createCustomer(organizationId, {
          name: formData.name,
          phone: formData.phone,
          email: formData.email || null,
          address: formData.address || null,
          postcode: formData.postcode || null,
          state: formData.state || null,
          area: formData.area || null,
          notes: formData.notes || null,
        });
        setCustomers([...customers, { ...newCustomer, has_portal_account: false }]);
        toast({ title: t("customerCreated") });
      }
      setDialogOpen(false);
    } catch (error) {
      toast({ title: t("error"), description: String(error), variant: "destructive" });
    }
  };

  const performDelete = async (id: string) => {
    try {
      await deleteCustomer(id);
      setCustomers(customers.filter((c) => c.id !== id));
      toast({ title: t("customerDeleted") });
    } catch (error) {
      toast({ title: t("error"), description: String(error), variant: "destructive" });
    }
  };

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString("en-MY", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t("heading")}</h1>
          <p className="text-muted-foreground">{t("subtitle")}</p>
        </div>
        <Button onClick={openCreateDialog}>
          <Plus className="mr-2 h-4 w-4" />
          {t("addCustomer")}
        </Button>
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder={t("searchPlaceholder")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Table */}
      <div className="min-h-[calc(100vh-15rem)] rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("table.name")}</TableHead>
              <TableHead>{t("table.phone")}</TableHead>
              <TableHead>{t("table.address")}</TableHead>
              <TableHead>{t("table.notes")}</TableHead>
              <TableHead>{t("table.added")}</TableHead>
              <TableHead className="w-24">{t("table.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredCustomers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                  {search ? t("emptySearch") : t("emptyNone")}
                </TableCell>
              </TableRow>
            ) : (
              filteredCustomers.map((customer) => (
                <TableRow key={customer.id}>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      <span>{customer.name}</span>
                      {customer.has_portal_account && (
                        <Badge variant="secondary">{t("portalBadge")}</Badge>
                      )}
                    </div>
                    {customer.email && (
                      <div className="text-xs font-normal text-muted-foreground">
                        {customer.email}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Phone className="h-4 w-4 text-muted-foreground" />
                      {customer.phone}
                    </div>
                  </TableCell>
                  <TableCell>
                    {customer.address ? (
                      <div className="flex items-center gap-2">
                        <MapPin className="h-4 w-4 text-muted-foreground" />
                        <span className="max-w-[200px] truncate">{customer.address}</span>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {customer.notes ? (
                      <div className="flex items-start gap-2">
                        <StickyNote className="h-4 w-4 text-muted-foreground mt-0.5" />
                        <span className="max-w-[200px] truncate">{customer.notes}</span>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(customer.created_at)}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => openEditDialog(customer)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => {
                          setDeleteTarget(customer);
                          setDeleteOpen(true);
                        }}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingCustomer ? t("editTitle") : t("addCustomer")}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">{t("nameLabel")}</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">{t("phoneLabel")}</Label>
              <Input
                id="phone"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">{t("emailLabel")}</Label>
              <Input
                id="email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              />
            </div>
            <AddressFields
              value={{
                addressLine: formData.address,
                postcode: formData.postcode,
                state: formData.state,
                area: formData.area,
              }}
              onChange={(next) =>
                setFormData({
                  ...formData,
                  address: next.addressLine,
                  postcode: next.postcode,
                  state: next.state,
                  area: next.area,
                })
              }
              required={false}
            />
            <div className="space-y-2">
              <Label htmlFor="notes">{t("notesLabel")}</Label>
              <Textarea
                id="notes"
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                {tCommon("cancel")}
              </Button>
              <Button type="submit">
                {editingCustomer ? t("saveChanges") : t("create")}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={(next) => {
          if (!next) setDeleteOpen(false);
        }}
        title={t("deleteTitle")}
        description={t("deleteConfirm", { name: deleteTarget?.name ?? "" })}
        confirmLabel={t("confirmDelete")}
        onConfirm={() => (deleteTarget ? performDelete(deleteTarget.id) : undefined)}
      />
    </div>
  );
}
