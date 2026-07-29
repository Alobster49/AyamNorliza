/**
 * Buyer feature types and schemas.
 */

import { z } from "zod";

export const OrderStatusEnum = z.enum([
  "new",
  "preparing",
  "ready",
  "completed",
  "cancelled",
]);
export type OrderStatus = z.infer<typeof OrderStatusEnum>;

export const orderStatusLabels: Record<OrderStatus, string> = {
  new: "New",
  preparing: "Preparing",
  ready: "Ready",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const orderStatusColors: Record<OrderStatus, string> = {
  new: "bg-blue-100 text-blue-800",
  preparing: "bg-yellow-100 text-yellow-800",
  ready: "bg-green-100 text-green-800",
  completed: "bg-gray-100 text-gray-800",
  cancelled: "bg-red-100 text-red-800",
};

// Database types
export type Buyer = {
  id: string;
  organization_id: string;
  display_name: string;
  address: string | null;
  phone: string | null;
  created_at: string;
  updated_at: string;
};

export type BuyerOrder = {
  id: string;
  organization_id: string;
  buyer_id: string;
  status: OrderStatus;
  total_amount: number;
  delivery_address: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type BuyerOrderItem = {
  id: string;
  order_id: string;
  variant_id: string;
  quantity: number;
  unit_price: number;
  subtotal: number;
  created_at: string;
};

export type Category = {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  display_order: number;
  is_active: boolean;
};

export type Product = {
  id: string;
  organization_id: string;
  category_id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  is_active: boolean;
};

export type ProductVariant = {
  id: string;
  organization_id: string;
  product_id: string;
  name: string;
  price_per_unit: number;
  unit_type: "per_kg" | "per_piece";
  is_available: boolean;
};

export type CatalogCategory = Category & {
  products: (Product & { variants: ProductVariant[] })[];
};

export type CatalogWithProducts = Category & {
  products: (Product & { variants?: ProductVariant[] })[];
};

export type BuyerOrderListItem = BuyerOrder & {
  items?: { id: string }[];
};

export type OrderWithItems = BuyerOrder & {
  items: (BuyerOrderItem & { variant?: ProductVariant & { product?: Product } })[];
};

export const CartItemSchema = z.object({
  variantId: z.string().uuid(),
  quantity: z.number().positive(),
});

export type CartItem = z.infer<typeof CartItemSchema>;

export const CheckoutInputSchema = z.object({
  items: z.array(CartItemSchema).min(1),
  deliveryAddress: z.string().min(1).max(500).optional(),
  notes: z.string().max(1000).optional(),
});

export type CheckoutInput = z.infer<typeof CheckoutInputSchema>;
