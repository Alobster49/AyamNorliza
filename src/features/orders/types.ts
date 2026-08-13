/**
 * Orders feature types and schemas: the unified pipeline shared by the
 * buyer portal (portal-actions), the seller ops screens (order-actions),
 * and delivery schedule admin (schedule-actions).
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Order status
// ---------------------------------------------------------------------------

export const ORDER_STATUSES = [
  "pending",
  "confirmed",
  "ready",
  "delivered",
  "closed",
  "cancelled",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending: "Pending",
  confirmed: "Confirmed",
  ready: "Ready",
  delivered: "Delivered",
  closed: "Closed",
  cancelled: "Cancelled",
};

export const ORDER_STATUS_COLORS: Record<OrderStatus, string> = {
  pending: "bg-blue-100 text-blue-800",
  confirmed: "bg-yellow-100 text-yellow-800",
  ready: "bg-green-100 text-green-800",
  delivered: "bg-purple-100 text-purple-800",
  closed: "bg-gray-100 text-gray-800",
  cancelled: "bg-red-100 text-red-800",
};

// ---------------------------------------------------------------------------
// Order item mode + fallback
// ---------------------------------------------------------------------------

export type OrderItemMode = "piece" | "kg";

export const FALLBACKS = ["cancel", "mix", "upsize", "downsize"] as const;
export type OrderFallback = (typeof FALLBACKS)[number];

export const FALLBACK_LABELS: Record<OrderFallback, string> = {
  cancel: "Cancel my order",
  mix: "Mix sizes",
  upsize: "Bigger is ok",
  downsize: "Smaller is ok",
};

export type RunStatus = "planned" | "departed" | "completed";

// ---------------------------------------------------------------------------
// ActionResult
// ---------------------------------------------------------------------------

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; code: string; message: string; fieldErrors?: Record<string, string[]> };

// ---------------------------------------------------------------------------
// Row types (snake_case fields mirroring the DB)
// ---------------------------------------------------------------------------

export type DeliveryZone = {
  id: string;
  organization_id: string;
  name: string;
  display_order: number;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  version: number;
};

export type Truck = {
  id: string;
  organization_id: string;
  name: string;
  code: string;
  is_active: boolean;
  bay_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  version: number;
};

export type TruckZone = {
  truck_id: string;
  zone_id: string;
  organization_id: string;
};

export type DeliverySlot = {
  id: string;
  organization_id: string;
  truck_id: string;
  weekday: number;
  start_time: string;
  end_time: string;
  max_orders: number | null;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  version: number;
};

export type ScheduleBlock = {
  id: string;
  organization_id: string;
  block_date: string;
  truck_id: string | null;
  reason: string | null;
  created_by: string | null;
  created_at: string;
};

export type DeliveryRun = {
  id: string;
  organization_id: string;
  truck_id: string;
  run_date: string;
  status: RunStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
  version: number;
};

export type Order = {
  id: string;
  organization_id: string;
  customer_id: string;
  created_by: string | null;
  source: "portal" | "manual";
  status: OrderStatus;
  zone_id: string;
  delivery_address: string;
  delivery_date: string;
  slot_id: string;
  truck_id: string;
  run_id: string | null;
  postcode: string | null;
  assignment_source: "none" | "auto" | "manual";
  notes: string | null;
  total_amount: number;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
  version: number;
};

export type OrderItem = {
  id: string;
  order_id: string;
  product_id: string;
  mode: OrderItemMode;
  quantity: number;
  size_min_kg: number;
  size_max_kg: number;
  fallback: OrderFallback;
  fallback_applied: OrderFallback | null;
  is_cancelled: boolean;
  warehouse_weight_kg: number | null;
  warehouse_pieces: number | null;
  final_weight_kg: number | null;
  final_pieces: number | null;
  price_per_kg: number | null;
  line_total: number | null;
  created_at: string;
  updated_at: string;
  version: number;
};

export type OrderTask = {
  id: string;
  organization_id: string;
  order_id: string;
  type: "allocate_weigh";
  assigned_to: string | null;
  status: "pending" | "done";
  done_by: string | null;
  done_at: string | null;
  created_at: string;
  updated_at: string;
  version: number;
};

export type OrderWeightLog = {
  id: string;
  organization_id: string;
  order_item_id: string;
  kind: "warehouse" | "final";
  weight_kg: number;
  pieces: number | null;
  recorded_by: string;
  recorded_at: string;
};

// ---------------------------------------------------------------------------
// Composites
// ---------------------------------------------------------------------------

export type DeliveryOption = {
  date: string;
  slotId: string;
  truckId: string;
  truckName: string;
  startTime: string;
  endTime: string;
  remaining: number | null;
};

export type OrderItemWithProduct = OrderItem & {
  product?: { id: string; name: string; image_url: string | null };
};

export type OrderWithItems = Order & {
  items: OrderItemWithProduct[];
  zone?: DeliveryZone;
  slot?: DeliverySlot;
  truck?: Truck;
  customer?: { id: string; name: string; phone: string };
  tasks?: OrderTask[];
  weight_log?: OrderWeightLog[];
};

export type OrderListItem = Order & {
  customer?: { name: string };
  zone?: { name: string };
};

export type TaskWithOrder = OrderTask & { order: OrderWithItems };

export type RunWithOrders = DeliveryRun & { truck?: Truck; orders: OrderWithItems[] };

export type DeliverySetup = {
  zones: DeliveryZone[];
  trucks: Truck[];
  truckZones: TruckZone[];
  slots: DeliverySlot[];
  blocks: ScheduleBlock[];
};

// ---------------------------------------------------------------------------
// Zod schemas (all inputs are `unknown` -> safeParse in server actions)
// ---------------------------------------------------------------------------

export const OrderItemInputSchema = z
  .object({
    productId: z.string().uuid(),
    mode: z.enum(["piece", "kg"]),
    quantity: z.number().positive(),
    sizeMinKg: z.number().min(0.1).max(50),
    sizeMaxKg: z.number().min(0.1).max(50),
    fallback: z.enum(FALLBACKS),
  })
  .refine((v) => v.mode !== "piece" || Number.isInteger(v.quantity), {
    message: "Quantity must be a whole number for piece orders",
    path: ["quantity"],
  })
  .refine((v) => v.sizeMaxKg >= v.sizeMinKg, {
    message: "Maximum size must be greater than or equal to minimum size",
    path: ["sizeMaxKg"],
  });
export type OrderItemInput = z.infer<typeof OrderItemInputSchema>;

export const PlaceOrderSchema = z.object({
  organizationSlug: z.string().min(1),
  zoneId: z.string().uuid(),
  slotId: z.string().uuid(),
  deliveryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  address: z.string().min(1).max(500),
  postcode: z.string().regex(/^\d{5}$/).optional(),
  notes: z.string().max(2000).optional(),
  items: z.array(OrderItemInputSchema).min(1),
  customerId: z.string().uuid().optional(),
});
export type PlaceOrderInput = z.infer<typeof PlaceOrderSchema>;

export const ConfirmOrderSchema = z.object({
  organizationSlug: z.string().min(1),
  orderId: z.string().uuid(),
  decisions: z
    .array(
      z.object({
        itemId: z.string().uuid(),
        available: z.boolean(),
      }),
    )
    .min(1),
});
export type ConfirmOrderInput = z.infer<typeof ConfirmOrderSchema>;

export const CompleteTaskSchema = z.object({
  organizationSlug: z.string().min(1),
  taskId: z.string().uuid(),
  weights: z
    .array(
      z.object({
        itemId: z.string().uuid(),
        weightKg: z.number().positive().max(1000),
        pieces: z.number().int().positive().optional(),
      }),
    )
    .min(1),
});
export type CompleteTaskInput = z.infer<typeof CompleteTaskSchema>;

export const CloseOrderSchema = z.object({
  organizationSlug: z.string().min(1),
  orderId: z.string().uuid(),
  lines: z
    .array(
      z.object({
        itemId: z.string().uuid(),
        finalWeightKg: z.number().positive().max(10000),
        finalPieces: z.number().int().positive().optional(),
        pricePerKg: z.number().nonnegative().max(10000),
      }),
    )
    .min(1),
});
export type CloseOrderInput = z.infer<typeof CloseOrderSchema>;

export const ZoneInputSchema = z.object({
  name: z.string().min(1).max(100),
  displayOrder: z.number().int().default(0),
  isActive: z.boolean().default(true),
});
export type ZoneInput = z.infer<typeof ZoneInputSchema>;

export const TruckInputSchema = z.object({
  name: z.string().min(1).max(100),
  code: z.string().min(1).max(20),
  isActive: z.boolean().default(true),
});
export type TruckInput = z.infer<typeof TruckInputSchema>;

export const SlotInputSchema = z
  .object({
    truckId: z.string().uuid(),
    weekday: z.number().int().min(0).max(6),
    startTime: z.string().regex(/^\d{2}:\d{2}$/),
    endTime: z.string().regex(/^\d{2}:\d{2}$/),
    maxOrders: z.number().int().positive().nullable(),
    isActive: z.boolean().default(true),
  })
  .refine((v) => v.endTime > v.startTime, {
    message: "End time must be after start time",
    path: ["endTime"],
  });
export type SlotInput = z.infer<typeof SlotInputSchema>;

export const BlockInputSchema = z.object({
  blockDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  truckId: z.string().uuid().nullable(),
  reason: z.string().max(200).optional(),
});
export type BlockInput = z.infer<typeof BlockInputSchema>;
