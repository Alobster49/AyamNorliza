"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { createCustomer, searchCustomers, getCatalogForOrdering } from "@/features/seller/server/actions";
import type { Customer } from "@/features/seller/types";
import { getActiveZones } from "@/features/orders/server/portal-actions";
import { getDeliveryOptionsForOrg, createManualOrder, resolveDeliveryZone } from "@/features/orders/server/order-actions";
import type { DeliveryOption, DeliveryZone, OrderFallback, OrderItemMode } from "@/features/orders/types";
import { FALLBACKS } from "@/features/orders/types";
import { AddressFields } from "@/components/forms/address-fields";
import { parseCustomerAddress } from "@/features/seller/lib/customer-schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Search, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type CategoryWithProducts = Array<{
  id: string;
  name: string;
  products: Array<{ id: string; name: string }>;
}>;

type ProductOption = { id: string; name: string; categoryName: string };

type LineDraft = {
  key: string;
  productId: string;
  mode: OrderItemMode;
  quantity: string;
  sizeMinKg: string;
  sizeMaxKg: string;
  fallback: OrderFallback;
};

let lineKeySeq = 0;
function newLine(): LineDraft {
  lineKeySeq += 1;
  return {
    key: `line-${lineKeySeq}`,
    productId: "",
    mode: "piece",
    quantity: "1",
    sizeMinKg: "1",
    sizeMaxKg: "2",
    fallback: "mix",
  };
}

type NewOrderClientProps = {
  organizationSlug: string;
  organizationId: string;
};

export function NewOrderClient({ organizationSlug, organizationId }: NewOrderClientProps) {
  const { toast } = useToast();
  const router = useRouter();
  const t = useTranslations("orders.new");
  const tFallback = useTranslations("orders.fallback");
  const tError = useTranslations("orders");
  const tRoot = useTranslations();
  const tCommon = useTranslations("common");

  const [products, setProducts] = useState<ProductOption[]>([]);
  const [zones, setZones] = useState<DeliveryZone[]>([]);
  // Mirrors `zones` for applyCustomer to read: `zones` is filled by a
  // fire-and-forget effect, and applyCustomer is re-created every render, so
  // an in-flight call would otherwise see whatever `zones` was at the render
  // it started in (often still []) instead of the latest loaded value.
  const zonesRef = useRef<DeliveryZone[]>([]);
  // Bumped at the start of every applyCustomer call; see the comment inside
  // applyCustomer for what it protects against.
  const customerSeqRef = useRef(0);

  const [customerSearch, setCustomerSearch] = useState("");
  const [customerResults, setCustomerResults] = useState<Customer[]>([]);
  const [customerSearching, setCustomerSearching] = useState(false);
  // Debounce timer + monotonic id so a slow, stale search response can never
  // overwrite the results of a newer query (or repopulate a cleared box).
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchSeqRef = useRef(0);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [newCustomerMode, setNewCustomerMode] = useState(false);
  const [newCustomer, setNewCustomer] = useState({
    name: "",
    phone: "",
    address: "",
    postcode: "",
    state: "",
    area: "",
    notes: "",
  });

  const [lines, setLines] = useState<LineDraft[]>([newLine()]);

  const [zoneId, setZoneId] = useState("");
  const [deliveryOptions, setDeliveryOptions] = useState<DeliveryOption[]>([]);
  const [selectedOptionKey, setSelectedOptionKey] = useState("");
  const [address, setAddress] = useState("");
  const [postcode, setPostcode] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      const catalog = (await getCatalogForOrdering(organizationSlug)) as CategoryWithProducts;
      const flattened: ProductOption[] = catalog.flatMap((category) =>
        category.products.map((product) => ({
          id: product.id,
          name: product.name,
          categoryName: category.name,
        })),
      );
      setProducts(flattened);
    })();
    (async () => {
      const result = await getActiveZones(organizationSlug);
      if (result.ok) {
        setZones(result.data);
        zonesRef.current = result.data;
      }
    })();
  }, [organizationId, organizationSlug]);

  const handleCustomerSearch = (query: string) => {
    setCustomerSearch(query);
    const seq = ++searchSeqRef.current;
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    const trimmed = query.trim();
    if (trimmed.length < 1) {
      setCustomerResults([]);
      setCustomerSearching(false);
      return;
    }
    setCustomerSearching(true);
    searchTimerRef.current = setTimeout(async () => {
      try {
        const results = await searchCustomers(organizationSlug, trimmed);
        if (searchSeqRef.current !== seq) return;
        setCustomerResults(results);
      } catch (error) {
        console.error(error);
      } finally {
        if (searchSeqRef.current === seq) setCustomerSearching(false);
      }
    }, 250);
  };

  /**
   * Selecting a customer is an explicit action, so their saved address and
   * postcode authoritatively overwrite whatever is in the delivery fields
   * (including clearing them for a customer with none on file), and the
   * zone is resolved from the postcode the same way the buyer checkout
   * does it.
   */
  const applyCustomer = async (customer: Customer) => {
    // Guards against a cross-customer race: applyCustomer is fired without
    // awaiting from a synchronous onClick, so clicking a second customer
    // before the first one's resolveDeliveryZone round-trip returns must
    // not let the first (now-superseded) response apply its zone or pop a
    // toast on top of the second customer's selection. Do not remove.
    const seq = ++customerSeqRef.current;

    setSelectedCustomer(customer);
    // Always assign, even when empty, so a customer with no address/postcode
    // on file clears out whatever the previously selected customer left behind.
    setAddress(customer.address ?? "");
    setPostcode(customer.postcode ?? "");

    if (!customer.postcode) {
      toast({
        title: t("toasts.noPostcodeTitle"),
        description: t("toasts.noPostcodeDescription"),
      });
      return;
    }

    const result = await resolveDeliveryZone(organizationSlug, customer.postcode);
    if (customerSeqRef.current !== seq) return;

    if (!result.ok) {
      toast({
        title: t("toasts.coverageErrorTitle"),
        description: result.messageKey ? tRoot(result.messageKey as never) : result.message,
        variant: "destructive",
      });
      return;
    }

    // Only adopt a zone the seller can actually see in the picker; the
    // resolver can return a zone that is not in the active list.
    if (result.data.zoneId && zonesRef.current.some((zone) => zone.id === result.data.zoneId)) {
      await handleZoneChange(result.data.zoneId);
      return;
    }
    toast({
      title: t("toasts.noZoneCoverageTitle", { postcode: customer.postcode }),
      description: t("toasts.noZoneCoverageDescription"),
    });
  };

  const handleAddNewCustomer = async () => {
    if (!newCustomer.name || !newCustomer.phone) {
      toast({ title: t("toasts.nameRequired"), variant: "destructive" });
      return;
    }
    // Validate client-side before hitting the server action: Next.js
    // redacts uncaught Server Action error messages in production builds,
    // so the "Enter a 5-digit postcode..." message from parseCustomerAddress
    // would otherwise never reach the seller in prod. createCustomer still
    // calls parseCustomerAddress itself as defence in depth.
    try {
      parseCustomerAddress(newCustomer);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast({ title: tError("error"), description: message, variant: "destructive" });
      return;
    }
    try {
      const customer = await createCustomer(organizationSlug, {
        name: newCustomer.name,
        phone: newCustomer.phone,
        address: newCustomer.address || null,
        postcode: newCustomer.postcode || null,
        state: newCustomer.state || null,
        area: newCustomer.area || null,
        notes: newCustomer.notes || null,
      });
      await applyCustomer(customer);
      setNewCustomerMode(false);
      toast({ title: t("toasts.customerCreated") });
    } catch (error) {
      toast({ title: tError("error"), description: String(error), variant: "destructive" });
    }
  };

  const handleZoneChange = async (nextZoneId: string) => {
    setZoneId(nextZoneId);
    setSelectedOptionKey("");
    setDeliveryOptions([]);
    if (!nextZoneId) return;
    const result = await getDeliveryOptionsForOrg(organizationSlug, nextZoneId);
    if (!result.ok) {
      toast({ title: tError("error"), description: result.messageKey ? tRoot(result.messageKey as never) : result.message, variant: "destructive" });
      return;
    }
    setDeliveryOptions(result.data);
  };

  const addLine = () => setLines((prev) => [...prev, newLine()]);
  const removeLine = (key: string) => setLines((prev) => prev.filter((line) => line.key !== key));
  const updateLine = (key: string, patch: Partial<LineDraft>) =>
    setLines((prev) => prev.map((line) => (line.key === key ? { ...line, ...patch } : line)));

  const selectedOption = deliveryOptions.find(
    (option) => `${option.slotId}-${option.date}` === selectedOptionKey,
  );

  const submitOrder = async () => {
    if (!selectedCustomer) {
      toast({ title: t("toasts.selectCustomer"), variant: "destructive" });
      return;
    }
    if (!zoneId || !selectedOption) {
      toast({ title: t("toasts.selectZoneSlot"), variant: "destructive" });
      return;
    }
    if (!address.trim()) {
      toast({ title: t("toasts.enterAddress"), variant: "destructive" });
      return;
    }
    if (lines.length === 0 || lines.some((line) => !line.productId)) {
      toast({ title: t("toasts.selectProductEveryLine"), variant: "destructive" });
      return;
    }
    for (const line of lines) {
      const quantity = Number(line.quantity);
      const sizeMinKg = Number(line.sizeMinKg);
      const sizeMaxKg = Number(line.sizeMaxKg);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        toast({ title: tError("error"), description: t("toasts.invalidQuantity"), variant: "destructive" });
        return;
      }
      if (line.mode === "piece" && !Number.isInteger(quantity)) {
        toast({ title: tError("error"), description: t("toasts.wholeNumberPieces"), variant: "destructive" });
        return;
      }
      if (!Number.isFinite(sizeMinKg) || !Number.isFinite(sizeMaxKg) || sizeMinKg <= 0 || sizeMaxKg < sizeMinKg) {
        toast({ title: tError("error"), description: t("toasts.invalidSizeRange"), variant: "destructive" });
        return;
      }
    }

    const items = lines.map((line) => ({
      productId: line.productId,
      mode: line.mode,
      quantity: Number(line.quantity),
      sizeMinKg: Number(line.sizeMinKg),
      sizeMaxKg: Number(line.sizeMaxKg),
      fallback: line.fallback,
    }));

    setSubmitting(true);
    const result = await createManualOrder({
      organizationSlug,
      customerId: selectedCustomer.id,
      zoneId,
      slotId: selectedOption.slotId,
      deliveryDate: selectedOption.date,
      address,
      postcode: postcode.trim() || undefined,
      notes: notes || undefined,
      items,
    });
    setSubmitting(false);

    if (!result.ok) {
      toast({ title: tError("error"), description: result.messageKey ? tRoot(result.messageKey as never) : result.message, variant: "destructive" });
      return;
    }

    toast({ title: t("toasts.orderCreated") });
    router.push(`/${organizationSlug}/orders/${result.data.orderId}`);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t("heading")}</h1>
        <p className="text-muted-foreground">{t("subheading")}</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <div className="rounded-lg border p-4">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-semibold">{t("lines.title")}</h2>
              <Button type="button" variant="outline" size="sm" onClick={addLine}>
                <Plus className="mr-2 h-4 w-4" />
                {t("lines.addLine")}
              </Button>
            </div>
            <div className="space-y-4">
              {lines.map((line) => (
                <div key={line.key} className="space-y-3 rounded-md border p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 space-y-1">
                      <Label className="text-xs">{t("lines.product")}</Label>
                      <Select value={line.productId} onValueChange={(value) => updateLine(line.key, { productId: value })}>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder={t("lines.selectProduct")} />
                        </SelectTrigger>
                        <SelectContent>
                          {products.map((product) => (
                            <SelectItem key={product.id} value={product.id}>
                              {product.categoryName} · {product.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="mt-5"
                      onClick={() => removeLine(line.key)}
                      disabled={lines.length === 1}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>

                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <div className="space-y-1">
                      <Label className="text-xs">{t("lines.mode")}</Label>
                      <Select
                        value={line.mode}
                        onValueChange={(value) => updateLine(line.key, { mode: value as OrderItemMode })}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="piece">{t("lines.piece")}</SelectItem>
                          <SelectItem value="kg">{t("lines.kg")}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">{t("lines.quantity")}</Label>
                      <Input
                        type="number"
                        step={line.mode === "piece" ? 1 : 0.1}
                        min={line.mode === "piece" ? 1 : 0.1}
                        value={line.quantity}
                        onChange={(e) => updateLine(line.key, { quantity: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">{t("lines.sizeMin")}</Label>
                      <Input
                        type="number"
                        step={0.1}
                        min={0.1}
                        value={line.sizeMinKg}
                        onChange={(e) => updateLine(line.key, { sizeMinKg: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">{t("lines.sizeMax")}</Label>
                      <Input
                        type="number"
                        step={0.1}
                        min={0.1}
                        value={line.sizeMaxKg}
                        onChange={(e) => updateLine(line.key, { sizeMaxKg: e.target.value })}
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs">{t("lines.ifUnavailable")}</Label>
                    <Select
                      value={line.fallback}
                      onValueChange={(value) => updateLine(line.key, { fallback: value as OrderFallback })}
                    >
                      <SelectTrigger className="w-full sm:w-64">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {FALLBACKS.map((fallback) => (
                          <SelectItem key={fallback} value={fallback}>
                            {tFallback(fallback)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-4 rounded-lg border p-4">
            <h2 className="font-semibold">{t("delivery.title")}</h2>
            <div className="space-y-1">
              <Label className="text-xs">{t("delivery.zone")}</Label>
              <Select
                value={zoneId}
                onValueChange={(value) => {
                  // A manual zone pick must supersede any customer-driven
                  // resolveDeliveryZone still in flight -- bump the seq
                  // BEFORE calling handleZoneChange, the same way selecting
                  // another customer does, so a late response from
                  // applyCustomer can't clobber this choice. Bumping inside
                  // handleZoneChange itself would be wrong: applyCustomer
                  // calls that function too, and would end up invalidating
                  // its own in-flight work. Do not move this into
                  // handleZoneChange.
                  customerSeqRef.current += 1;
                  handleZoneChange(value);
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t("delivery.selectZone")} />
                </SelectTrigger>
                <SelectContent>
                  {zones.map((zone) => (
                    <SelectItem key={zone.id} value={zone.id}>
                      {zone.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {zoneId && (
              <div className="space-y-1">
                <Label className="text-xs">{t("delivery.dateSlot")}</Label>
                <Select value={selectedOptionKey} onValueChange={setSelectedOptionKey}>
                  <SelectTrigger className="w-full">
                    <SelectValue
                      placeholder={deliveryOptions.length === 0 ? t("delivery.noSlots") : t("delivery.selectDateSlot")}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {deliveryOptions.map((option) => (
                      <SelectItem key={`${option.slotId}-${option.date}`} value={`${option.slotId}-${option.date}`}>
                        {option.date} · {option.truckName} {option.startTime}–{option.endTime}
                        {option.remaining != null ? ` (${t("delivery.remaining", { count: option.remaining })})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-1">
              <Label className="text-xs">{t("delivery.address")}</Label>
              <Textarea value={address} onChange={(e) => setAddress(e.target.value)} placeholder={t("delivery.addressPlaceholder")} />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">{t("delivery.postcode")}</Label>
              <Input
                value={postcode}
                onChange={(e) => setPostcode(e.target.value.replace(/\D/g, "").slice(0, 5))}
                placeholder={t("delivery.postcodePlaceholder")}
                inputMode="numeric"
                maxLength={5}
                className="sm:w-40"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">{t("delivery.notes")}</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t("delivery.notesPlaceholder")} />
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-lg border p-4">
            <h2 className="mb-4 font-semibold">{t("customer.title")}</h2>
            {!newCustomerMode ? (
              <>
                <div className="relative mb-4">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder={t("customer.searchPlaceholder")}
                    value={customerSearch}
                    onChange={(e) => handleCustomerSearch(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        setCustomerSearch("");
                        setCustomerResults([]);
                        setCustomerSearching(false);
                      }
                    }}
                    className="pl-9"
                  />
                  {customerSearch.trim().length > 0 && (
                    <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-2xl border bg-background shadow-lg">
                      {customerResults.map((customer) => (
                        <button
                          key={customer.id}
                          type="button"
                          className="block w-full px-4 py-2.5 text-left transition-colors hover:bg-muted"
                          onClick={() => {
                            void applyCustomer(customer);
                            setCustomerSearch("");
                            setCustomerResults([]);
                          }}
                        >
                          <div className="font-medium">{customer.name}</div>
                          <div className="text-sm text-muted-foreground">{customer.phone}</div>
                        </button>
                      ))}
                      {customerResults.length === 0 && (
                        <div className="px-4 py-3 text-sm text-muted-foreground">
                          {customerSearching
                            ? t("customer.searching")
                            : t("customer.noResults", { query: customerSearch.trim() })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                {selectedCustomer && (
                  <div className="rounded-md bg-muted p-3">
                    <div className="font-medium">{selectedCustomer.name}</div>
                    <div className="text-sm text-muted-foreground">{selectedCustomer.phone}</div>
                    {selectedCustomer.address && (
                      <div className="text-sm text-muted-foreground">{selectedCustomer.address}</div>
                    )}
                    {selectedCustomer.postcode && (
                      <div className="text-sm text-muted-foreground">
                        {selectedCustomer.postcode}
                        {selectedCustomer.area ? ` · ${selectedCustomer.area}` : ""}
                      </div>
                    )}
                  </div>
                )}
                <Button variant="outline" className="mt-2 w-full" onClick={() => setNewCustomerMode(true)}>
                  <Plus className="mr-2 h-4 w-4" />
                  {t("customer.newCustomer")}
                </Button>
              </>
            ) : (
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label>{t("customer.name")}</Label>
                  <Input
                    value={newCustomer.name}
                    onChange={(e) => setNewCustomer({ ...newCustomer, name: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t("customer.phone")}</Label>
                  <Input
                    value={newCustomer.phone}
                    onChange={(e) => setNewCustomer({ ...newCustomer, phone: e.target.value })}
                  />
                </div>
                <AddressFields
                  idPrefix="customer-address"
                  value={{
                    addressLine: newCustomer.address,
                    postcode: newCustomer.postcode,
                    state: newCustomer.state,
                    area: newCustomer.area,
                  }}
                  onChange={(next) =>
                    setNewCustomer({
                      ...newCustomer,
                      address: next.addressLine,
                      postcode: next.postcode,
                      state: next.state,
                      area: next.area,
                    })
                  }
                  required={false}
                />
                <div className="space-y-2">
                  <Label>{t("customer.notes")}</Label>
                  <Textarea
                    value={newCustomer.notes}
                    onChange={(e) => setNewCustomer({ ...newCustomer, notes: e.target.value })}
                  />
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setNewCustomerMode(false)}>
                    {tCommon("cancel")}
                  </Button>
                  <Button onClick={handleAddNewCustomer}>{t("customer.saveCustomer")}</Button>
                </div>
              </div>
            )}
          </div>

          <Button className="w-full" size="lg" disabled={submitting} onClick={submitOrder}>
            {submitting ? t("submit.creating") : t("submit.createOrder")}
          </Button>
        </div>
      </div>
    </div>
  );
}
