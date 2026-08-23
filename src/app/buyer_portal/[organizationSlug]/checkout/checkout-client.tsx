"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { Loader2, MapPin, CheckCircle2 } from "lucide-react";
import { useCart } from "@/features/buyer/components/cart-context";
import {
  getActiveZones,
  getDeliveryOptions,
  placeOrder,
  resolveZoneForPostcode,
} from "@/features/orders/server/portal-actions";
import type { DeliveryOption } from "@/features/orders/types";
import { listMyAddresses, createAddress } from "@/features/buyer/server/address-actions";
import type { BuyerAddress } from "@/features/buyer/types";
import { AddressFields, type AddressValue } from "@/features/buyer/components/address-fields";
import { buyerSignInAction, buyerSignUpAction } from "@/features/buyer-auth/server/auth-actions";
import { AccountSection, type AccountValue } from "./account-section";
import { checkoutStage, STAGE_CTA } from "@/features/buyer/lib/checkout-cta";
import { cartEstimate, formatEstimate } from "@/features/buyer/lib/price-estimate";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

type CheckoutClientProps = {
  organizationSlug: string;
  initialBuyer: { displayName: string; phone: string | null } | null;
};

function optionKey(option: DeliveryOption) {
  return `${option.date}-${option.slotId}`;
}

export default function CheckoutClient({ organizationSlug, initialBuyer }: CheckoutClientProps) {
  const router = useRouter();
  const { items, clearCart } = useCart();
  const { toast } = useToast();

  // --- account (anonymous only) ---
  const [buyer, setBuyer] = useState(initialBuyer);
  const [accountMode, setAccountMode] = useState<"signup" | "signin">("signup");
  const [account, setAccount] = useState<AccountValue>({ displayName: "", phone: "", email: "", password: "" });
  const [accountErrors, setAccountErrors] = useState<Record<string, string[]>>({});

  // --- address + zone (same machine as before) ---
  const [savedAddresses, setSavedAddresses] = useState<BuyerAddress[]>([]);
  const [addressesLoading, setAddressesLoading] = useState(initialBuyer !== null);
  const [selectedAddressId, setSelectedAddressId] = useState<string>("new");
  const [newAddress, setNewAddress] = useState<AddressValue>({ addressLine: "", postcode: "", state: "", area: "" });
  const [zoneId, setZoneId] = useState<string | null>(null);
  const [zoneState, setZoneState] = useState<"idle" | "resolving" | "resolved" | "uncovered">("idle");
  const [zoneNames, setZoneNames] = useState<Record<string, string>>({});

  // --- slots / notes / submit ---
  const [options, setOptions] = useState<DeliveryOption[]>([]);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string>("");
  const [notesOpen, setNotesOpen] = useState(false);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [orderComplete, setOrderComplete] = useState(false);
  const [orderId, setOrderId] = useState<string>("");

  // Saved addresses only exist for signed-in buyers.
  useEffect(() => {
    if (!buyer) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAddressesLoading(true);
    listMyAddresses()
      .then((result) => {
        if (cancelled) return;
        if (result.ok) {
          setSavedAddresses(result.data);
          const preferred = result.data.find((a) => a.isDefault) ?? result.data[0];
          if (preferred) setSelectedAddressId(preferred.id);
        }
        setAddressesLoading(false);
      })
      .catch(() => !cancelled && setAddressesLoading(false));
    return () => { cancelled = true; };
  }, [buyer]);

  // Zone names for the confirmed chip.
  useEffect(() => {
    let cancelled = false;
    getActiveZones(organizationSlug).then((result) => {
      if (cancelled || !result.ok) return;
      setZoneNames(Object.fromEntries(result.data.map((z) => [z.id, z.name])));
    });
    return () => { cancelled = true; };
  }, [organizationSlug]);

  const activeAddress: AddressValue | null = useMemo(() => {
    if (selectedAddressId !== "new") {
      const saved = savedAddresses.find((a) => a.id === selectedAddressId);
      return saved
        ? { addressLine: saved.addressLine, postcode: saved.postcode, state: saved.state, area: saved.area }
        : null;
    }
    return newAddress;
  }, [selectedAddressId, savedAddresses, newAddress]);

  useEffect(() => {
    const postcode = activeAddress?.postcode ?? "";
    if (!/^[0-9]{5}$/.test(postcode)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setZoneId(null);
      setZoneState("idle");
      return;
    }
    let cancelled = false;
    setZoneState("resolving");
    resolveZoneForPostcode(organizationSlug, postcode)
      .then((result) => {
        if (cancelled) return;
        if (result.ok && result.data.zoneId) {
          setZoneId(result.data.zoneId);
          setZoneState("resolved");
        } else {
          setZoneId(null);
          setZoneState("uncovered");
        }
      })
      .catch(() => {
        if (cancelled) return;
        // A rejected lookup collapses to "uncovered" rather than a distinct
        // error state — surfacing lookup failures separately is a filed
        // follow-up; for now this just keeps checkout from hanging forever.
        setZoneId(null);
        setZoneState("uncovered");
      });
    return () => {
      cancelled = true;
    };
  }, [organizationSlug, activeAddress?.postcode]);

  useEffect(() => {
    if (!organizationSlug || !zoneId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOptions([]);
      setSelectedKey("");
      return;
    }
    let cancelled = false;
    setOptionsLoading(true);
    setSelectedKey("");
    getDeliveryOptions(organizationSlug, zoneId).then((result) => {
      if (cancelled) return;
      setOptions(result.ok ? result.data : []);
      setOptionsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [organizationSlug, zoneId]);

  const groupedOptions = useMemo(() => {
    const groups = new Map<string, DeliveryOption[]>();
    for (const option of options) {
      const list = groups.get(option.date) ?? [];
      list.push(option);
      groups.set(option.date, list);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [options]);

  const selectedOption = options.find((o) => optionKey(o) === selectedKey) ?? null;
  const estimate = cartEstimate(items);

  const accountValid =
    accountMode === "signup"
      ? account.displayName.trim().length > 0 && account.phone.trim().length > 0 &&
        /\S+@\S+\.\S+/.test(account.email) && account.password.length >= 8
      : /\S+@\S+\.\S+/.test(account.email) && account.password.length > 0;

  const addressValid =
    activeAddress !== null &&
    activeAddress.addressLine.trim().length > 0 &&
    /^[0-9]{5}$/.test(activeAddress.postcode) &&
    activeAddress.state !== "" &&
    activeAddress.area !== "";

  const stage = checkoutStage({
    isAuthed: buyer !== null,
    accountValid,
    addressValid,
    zoneResolved: zoneState === "resolved" && zoneId !== null,
    slotSelected: selectedOption !== null,
  });
  const canSubmit = items.length > 0 && stage === "ready" && !submitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || !selectedOption || !activeAddress || zoneId === null) return;
    setSubmitting(true);
    setAccountErrors({});

    // 1. Inline account, only when anonymous. The session cookie from the
    //    auth action carries into placeOrder's requireBuyer.
    if (!buyer) {
      const auth =
        accountMode === "signup"
          ? await buyerSignUpAction({
              email: account.email,
              password: account.password,
              displayName: account.displayName,
              phone: account.phone,
              organizationSlug,
            })
          : await buyerSignInAction({
              email: account.email,
              password: account.password,
              organizationSlug,
            });
      if (!auth.ok) {
        setSubmitting(false);
        setAccountErrors(auth.fieldErrors ?? {});
        if (auth.code === "conflict") {
          setAccountMode("signin");
          toast({ title: "Email sudah didaftar", description: "Masukkan kata laluan anda untuk teruskan." });
        } else {
          toast({ title: "Akaun gagal", description: auth.message, variant: "destructive" });
        }
        return;
      }
      setBuyer({ displayName: account.displayName || "Buyer", phone: account.phone || null });
    }

    // 2. Place the order (unchanged action).
    const composedAddress = `${activeAddress.addressLine.trim()}, ${activeAddress.postcode} ${activeAddress.area}, ${activeAddress.state}`;
    const result = await placeOrder({
      organizationSlug,
      zoneId,
      slotId: selectedOption.slotId,
      deliveryDate: selectedOption.date,
      address: composedAddress,
      postcode: activeAddress.postcode,
      notes: notes.trim() || undefined,
      items: items.map((item) => ({
        productId: item.productId,
        mode: item.mode,
        quantity: item.quantity,
        sizeMinKg: item.sizeMinKg,
        sizeMaxKg: item.sizeMaxKg,
        fallback: item.fallback,
      })),
    });
    setSubmitting(false);

    if (!result.ok) {
      toast({ title: "Pesanan gagal", description: result.message, variant: "destructive" });
      return;
    }

    if (selectedAddressId === "new") {
      createAddress({
        addressLine: newAddress.addressLine.trim(),
        postcode: newAddress.postcode,
        state: newAddress.state,
        area: newAddress.area,
      }).catch(() => {});
    }

    setOrderId(result.data.orderId);
    setOrderComplete(true);
    clearCart();
  };

  if (orderComplete) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="mx-auto max-w-md rounded-2xl border bg-card p-8 text-center">
          <CheckCircle2 className="mx-auto mb-4 h-12 w-12" style={{ color: "var(--buyer-confirmed)" }} />
          <p className="font-buyer-display text-2xl font-semibold">Pesanan diterima!</p>
          <p className="mt-2 text-sm text-muted-foreground">#{orderId.slice(0, 8)}</p>
          <button
            type="button"
            className="mt-6 w-full rounded-full bg-primary py-3 font-medium text-primary-foreground transition-transform active:scale-[0.97]"
            onClick={() => router.push(`/buyer_portal/${organizationSlug}/orders`)}
          >
            Lihat pesanan saya
          </button>
        </div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center text-center">
        <p className="font-buyer-display text-xl font-semibold">Troli kosong — jom pilih ayam segar</p>
        <button
          type="button"
          className="mt-6 rounded-full bg-primary px-6 py-2.5 font-medium text-primary-foreground transition-transform active:scale-[0.97]"
          onClick={() => router.push(`/buyer_portal/${organizationSlug}/shop`)}
        >
          Lihat produk
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mx-auto max-w-2xl space-y-6 pb-32">
      <h1 className="font-buyer-display text-3xl font-bold">Checkout</h1>

      {/* Akaun anda */}
      {buyer === null ? (
        <div className="rounded-2xl border bg-card p-5">
          <h2 className="font-buyer-display text-xl font-semibold">Akaun anda</h2>
          <div className="mt-4">
            <AccountSection
              mode={accountMode}
              onModeChange={setAccountMode}
              value={account}
              onChange={setAccount}
              fieldErrors={accountErrors}
              disabled={submitting}
            />
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Log masuk sebagai {buyer.displayName}</p>
      )}

      {/* Alamat penghantaran */}
      <div className="rounded-2xl border bg-card p-5">
        <h2 className="font-buyer-display text-xl font-semibold">Alamat penghantaran</h2>
        <div className="mt-4 space-y-4">
          {addressesLoading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Memuatkan alamat anda...
            </div>
          )}

          {!addressesLoading && savedAddresses.length > 0 && (
            <div className="space-y-2" role="radiogroup" aria-label="Alamat penghantaran">
              {savedAddresses.map((addr) => {
                const isSelected = selectedAddressId === addr.id;
                return (
                  <button
                    key={addr.id}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    onClick={() => setSelectedAddressId(addr.id)}
                    className={`w-full rounded-2xl border p-3 text-left text-sm transition-colors ${
                      isSelected ? "border-primary bg-primary/5" : "border-border hover:bg-muted"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <p className="font-medium">{addr.addressLine}</p>
                      {addr.isDefault && (
                        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                          Default
                        </span>
                      )}
                    </div>
                    <p className="text-muted-foreground">
                      {addr.area}, {addr.postcode} {addr.state}
                    </p>
                  </button>
                );
              })}
              <button
                type="button"
                role="radio"
                aria-checked={selectedAddressId === "new"}
                onClick={() => setSelectedAddressId("new")}
                className={`w-full rounded-2xl border p-3 text-left text-sm transition-colors ${
                  selectedAddressId === "new" ? "border-primary bg-primary/5" : "border-border hover:bg-muted"
                }`}
              >
                <p className="font-medium">+ Alamat baru</p>
              </button>
            </div>
          )}

          {!addressesLoading && selectedAddressId === "new" && (
            <AddressFields value={newAddress} onChange={setNewAddress} disabled={submitting} />
          )}

          {zoneState === "resolving" && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Menyemak kawasan…
            </div>
          )}
          {zoneState === "resolved" && (
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium"
              style={{ backgroundColor: "color-mix(in oklab, var(--buyer-confirmed) 15%, transparent)", color: "var(--buyer-confirmed)" }}
            >
              <MapPin className="h-3.5 w-3.5" />
              Zon: {zoneNames[zoneId ?? ""] ?? "Disahkan"} ✓
            </span>
          )}
          {zoneState === "uncovered" && (
            <div className="rounded-2xl bg-secondary p-4 text-sm">
              Belum sampai kawasan ini lagi — cuba poskod lain atau hubungi kami.
            </div>
          )}
        </div>
      </div>

      {/* Slot penghantaran */}
      <div className="rounded-2xl border bg-card p-5">
        <h2 className="font-buyer-display text-xl font-semibold">Slot penghantaran</h2>
        <div className="mt-4">
          {zoneId !== null && optionsLoading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Memuatkan slot penghantaran...
            </div>
          )}
          {zoneId !== null && !optionsLoading && groupedOptions.length === 0 && (
            <p className="text-sm text-muted-foreground">Tiada slot penghantaran untuk kawasan ini lagi.</p>
          )}
          {zoneId === null && (
            <p className="text-sm text-muted-foreground">Isi alamat yang disampaikan untuk lihat slot penghantaran.</p>
          )}
          {!optionsLoading && groupedOptions.length > 0 && (
            <div className="space-y-4" role="radiogroup" aria-label="Slot penghantaran">
              {groupedOptions.map(([date, dateOptions]) => (
                <div key={date}>
                  <p className="mb-2 text-sm font-medium">
                    {format(new Date(`${date}T00:00:00`), "EEEE, d MMM")}
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {dateOptions.map((option) => {
                      const key = optionKey(option);
                      const isSelected = key === selectedKey;
                      return (
                        <button
                          key={key}
                          type="button"
                          role="radio"
                          aria-checked={isSelected}
                          onClick={() => setSelectedKey(key)}
                          className={`rounded-2xl border p-3 text-left text-sm transition-colors ${
                            isSelected ? "border-primary bg-primary/5" : "border-border hover:bg-muted"
                          }`}
                        >
                          <p className="font-medium">{option.truckName}</p>
                          <p className="text-muted-foreground">
                            {option.startTime.slice(0, 5)}–{option.endTime.slice(0, 5)}
                          </p>
                          {option.remaining !== null && (
                            <p className="mt-1 text-xs text-muted-foreground">{option.remaining} slot tersisa</p>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Nota */}
      <div>
        <button
          type="button"
          onClick={() => setNotesOpen(!notesOpen)}
          className="text-sm text-muted-foreground underline decoration-dotted"
        >
          + Tambah nota
        </button>
        {notesOpen && (
          <Textarea
            className="mt-2"
            placeholder="Sebarang arahan khas untuk pesanan anda?"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
          />
        )}
      </div>

      {/* Submit row */}
      <div className="space-y-2">
        <p className="font-buyer-mono text-sm text-muted-foreground">
          Anggaran: {estimate ? formatEstimate(estimate) : "—"}
        </p>
        <button
          type="submit"
          disabled={!canSubmit}
          className="w-full rounded-full bg-primary py-4 text-lg font-medium text-primary-foreground transition-transform active:scale-[0.97] disabled:opacity-50"
        >
          {submitting ? "Menghantar…" : STAGE_CTA[stage]}
        </button>
      </div>
    </form>
  );
}
