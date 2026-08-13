/**
 * Logistics feature types and schemas: facility/bay config, postcode
 * coverage ranges, and the dispatch board composites. Row types mirror the
 * DB in snake_case (same convention as @/features/orders/types).
 */

import { z } from "zod";
import type {
  DeliveryRun,
  DeliverySlot,
  DeliveryZone,
  Order,
  ScheduleBlock,
  Truck,
  TruckZone,
} from "@/features/orders/types";

export const POSTCODE_REGEX = /^\d{5}$/;

export type AssignmentSource = "none" | "auto" | "manual";

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

export type Facility = {
  id: string;
  organization_id: string;
  name: string;
  address_line: string;
  postcode: string;
  state: string;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  version: number;
};

export type Bay = {
  id: string;
  organization_id: string;
  facility_id: string;
  name: string;
  position: number;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  version: number;
};

export type ZonePostcodeRange = {
  id: string;
  organization_id: string;
  zone_id: string;
  postcode_start: string;
  postcode_end: string;
  created_by: string | null;
  created_at: string;
};

// ---------------------------------------------------------------------------
// Composites
// ---------------------------------------------------------------------------

/** Truck now carries bay_id natively (see @/features/orders/types); kept as
 *  an alias so existing logistics call sites don't need to change. */
export type DispatchTruck = Truck;

export type DispatchTicket = Order & {
  customer?: { name: string };
  zone?: { name: string };
  item_count?: number;
};

export type DispatchBoardData = {
  facility: Facility | null;
  bays: Bay[];
  trucks: DispatchTruck[];
  zones: DeliveryZone[];
  ranges: ZonePostcodeRange[];
  truckZones: TruckZone[];
  slots: DeliverySlot[];
  blocks: ScheduleBlock[];
  runs: DeliveryRun[];
  orders: DispatchTicket[];
};

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

export const FacilityInputSchema = z.object({
  name: z.string().min(1).max(100),
  addressLine: z.string().min(1).max(500),
  postcode: z.string().regex(POSTCODE_REGEX, "Postcode must be 5 digits"),
  state: z.string().min(1).max(100),
});
export type FacilityInput = z.infer<typeof FacilityInputSchema>;

export const BayInputSchema = z.object({
  facilityId: z.string().uuid(),
  name: z.string().min(1).max(100),
  position: z.number().int().default(0),
  isActive: z.boolean().default(true),
});
export type BayInput = z.infer<typeof BayInputSchema>;

export const PostcodeRangeInputSchema = z
  .object({
    zoneId: z.string().uuid(),
    postcodeStart: z.string().regex(POSTCODE_REGEX, "Postcode must be 5 digits"),
    postcodeEnd: z.string().regex(POSTCODE_REGEX, "Postcode must be 5 digits"),
  })
  .refine((v) => v.postcodeEnd >= v.postcodeStart, {
    message: "End postcode must be greater than or equal to start postcode",
    path: ["postcodeEnd"],
  });
export type PostcodeRangeInput = z.infer<typeof PostcodeRangeInputSchema>;
