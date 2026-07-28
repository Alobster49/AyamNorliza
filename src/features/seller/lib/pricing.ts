/**
 * Pure pricing/quantity formatting helpers for the catalog.
 * price_per_unit is RM per kg for per_kg variants, RM per piece otherwise.
 */

import type { UnitType } from "../types";

const myr = new Intl.NumberFormat("en-MY", {
  style: "currency",
  currency: "MYR",
});

export function formatPrice(amount: number): string {
  return myr.format(amount);
}

export function formatVariantPrice(pricePerUnit: number, unitType: UnitType): string {
  const suffix = unitType === "per_kg" ? "/kg" : "each";
  return `${formatPrice(pricePerUnit)} ${suffix}`;
}

export function formatQuantity(quantity: number, unitType: UnitType): string {
  if (unitType === "per_kg") {
    // Up to 3 decimals, trailing zeros trimmed by Number().
    return `${Number(quantity.toFixed(3))} kg`;
  }
  return `${quantity} ${quantity === 1 ? "pc" : "pcs"}`;
}

export function lineSubtotal(pricePerUnit: number, quantity: number): number {
  return Math.round(pricePerUnit * quantity * 100) / 100;
}

export function isValidQuantity(quantity: number, unitType: UnitType): boolean {
  if (!Number.isFinite(quantity) || quantity <= 0) return false;
  if (unitType === "per_piece") return Number.isInteger(quantity);
  return true;
}
