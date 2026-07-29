# AyamNorliza Seller Dashboard Implementation

> Documentation created: Saturday, Jul 18, 2026

## Overview

This implementation adds a **Seller role** to the AyamNorliza chicken ordering system, enabling staff to manage the product catalog, create orders for customers, and manage the customer database.

---

## 1. Role & Permissions

### New Role: `seller`
- **Rank**: 60 (same as `farm_manager`)
- **Capabilities**:
  - `catalog.manage` - Create and edit categories, products, and variants
  - `orders.manage` - Create, view, and update order statuses
  - `customers.manage` - Add and edit customer records
  - `step_up.reauth` - Required for sensitive operations

### Files Modified

#### `src/lib/auth/permissions.ts`
```typescript
// Added 'seller' to ROLES array
export const ROLES = [
  "owner", "org_admin", "seller",  // <-- NEW
  "farm_manager", "supervisor", "caretaker", ...
];

// Added new capabilities
export const CAPABILITIES = [
  // ... existing capabilities ...
  "catalog.manage",      // NEW
  "orders.manage",       // NEW
  "customers.manage",     // NEW
];

// Seller role in matrix
const matrix: Record<Role, ReadonlySet<Capability>> = {
  // ...
  seller: new Set<Capability>([
    "catalog.manage",
    "orders.manage",
    "customers.manage",
    "step_up.reauth",
  ]),
};

// Seller rank
const roleRank: Record<Role, number> = {
  // ...
  seller: 60,  // NEW
};
```

---

## 2. Database Migration

### File: `supabase/migrations/20260718000001_seller_role_and_catalog.sql`

### Changes to Existing Tables
- Updated CHECK constraints on `organization_members`, `invitations`, and `role_capability_overrides` to include `seller`

### New Tables Created

| Table | Description |
|-------|-------------|
| `categories` | Product groupings (e.g., "Whole Chicken", "Frozen") |
| `products` | Individual products within categories |
| `product_variants` | Size/option variants with prices |
| `customers` | Customer records (name, phone, address, notes) |
| `orders` | Order header with status tracking |
| `order_items` | Line items linking orders to variants |

### Order Status Flow
```
new → preparing → ready → completed
                ↓
            cancelled
```

### Row Level Security (RLS)
- All tables have RLS enabled
- Organization members can SELECT all tables
- Only `owner`, `org_admin`, and `seller` roles can INSERT/UPDATE
- Orders are linked to the creating seller (`seller_id = auth.uid()`)

---

## 3. Database Types

### File: `src/types/database.generated.ts`

Added TypeScript types for:
- `categories`, `products`, `product_variants`
- `customers`, `orders`, `order_items`
- `order_status` enum: `"new" | "preparing" | "ready" | "completed" | "cancelled"`

---

## 4. Server Actions

### File: `src/features/seller/server/actions.ts`

Key functions:

#### Categories
- `getCategories(orgId)` - List all categories
- `createCategory(orgId, data)` - Create new category
- `updateCategory(id, data)` - Update category
- `deleteCategory(id)` - Delete category

#### Products
- `getProducts(orgId)` - List all products with variants
- `createProduct(orgId, data)` - Create product
- `updateProduct(id, data)` - Update product
- `deleteProduct(id)` - Delete product

#### Variants
- `createVariant(orgId, data)` - Add size/price option
- `updateVariant(id, data)` - Update variant
- `deleteVariant(id)` - Delete variant

#### Customers
- `getCustomers(orgId)` - List all customers
- `searchCustomers(orgId, query)` - Search by name or phone
- `createCustomer(orgId, data)` - Add customer
- `updateCustomer(id, data)` - Update customer
- `deleteCustomer(id)` - Delete customer

#### Orders
- `getOrders(orgId, status?)` - List orders with customer
- `getOrderWithItems(orderId)` - Get order with full details
- `createOrder(orgId, orderData, items)` - Create order with items
- `updateOrderStatus(orderId, status)` - Update order status
- `getCatalogForOrdering(orgId)` - Get full catalog for order creation

---

## 5. Seller Dashboard Pages

### Route Structure: `/[organizationSlug]/...`

| Path | Page | Description |
|------|------|-------------|
| `/products` | Products Page | Manage categories, products, and pricing |
| `/orders` | Orders List | View all orders, filter by status |
| `/orders/new` | New Order | Create order with customer search and cart |
| `/orders/[id]` | Order Detail | View order, update status |
| `/customers` | Customers | Manage customer database |

### Layout

**File: `src/app/(seller)/[organizationSlug]/layout.tsx`**
- Checks if user has `owner`, `org_admin`, or `seller` role
- Redirects non-sellers to main dashboard
- Uses `SellerSidebar` component

### Components

#### Seller Sidebar
**File: `src/features/seller/components/seller-sidebar.tsx`**
- Shows "Sales" navigation group
- Items: Products, Orders, Customers
- User profile dropdown with sign out

#### Products Page
**File: `src/app/(seller)/[organizationSlug]/products/products-client.tsx`**
- Expandable category tree view
- Create/Edit/Delete categories
- Create/Edit/Delete products
- Create/Edit/Delete variants with prices
- Dialog forms for all operations

#### Orders List
**File: `src/app/(seller)/[organizationSlug]/orders/orders-client.tsx`**
- Filter tabs by status
- Status badges with colors
- Quick actions to view/update status
- Format prices in MYR currency

#### New Order Page
**File: `src/app/(seller)/[organizationSlug]/orders/new/new-order-client.tsx`**
- Customer search (by name/phone) or create new
- Product catalog browser (categories → products → variants)
- Shopping cart with quantity controls
- Order summary with total calculation
- Create order action

#### Order Detail Page
**File: `src/app/(seller)/[organizationSlug]/orders/[orderId]/order-detail-client.tsx`**
- Full order information display
- Order items list
- Status timeline
- Action buttons for status progression
- Cancel order option

#### Customers Page
**File: `src/app/(seller)/[organizationSlug]/customers/customers-client.tsx`**
- Searchable customer list
- Create/Edit customer dialog
- Fields: name, phone, address, notes
- Delete with confirmation

---

## 6. Supporting Files

### Seller Shell Model
**File: `src/features/seller/lib/seller-shell-model.ts`**
- `getSellerSidebarGroups()` - Generate sidebar navigation
- `getSellerPageContext()` - Get page section/title
- `getUserInitials()` - Generate user initials for avatar

### Types
**File: `src/features/seller/types.ts`**
- All TypeScript types for the seller feature
- `OrderStatus` type and labels
- Extended types with relations (e.g., `OrderWithCustomer`)

---

## 7. Access Control Updates

### Capability Groups
**File: `src/features/access-control/lib/group-capabilities.ts`**
```typescript
// Added new groups
{ id: "catalog", label: "Catalog", capabilities: ["catalog.manage"] },
{ id: "sales", label: "Sales", capabilities: ["orders.manage", "customers.manage"] },
```

### Role Labels
**File: `src/features/identity-access/server/roles.ts`**
- Added `seller` role label and description
- Added capability area mappings for `catalog`, `sales`
- Added capability descriptions for new capabilities

### Test Updates
**File: `src/features/access-control/tests/unit/capability-matrix.test.ts`**
- Updated ranks to include `seller: 60`

---

## 8. UI Components Added

### Toast System
- **File: `src/hooks/use-toast.ts`** - Toast hook and reducer
- **File: `src/components/ui/toast.tsx`** - Toast UI components
- **File: `src/components/ui/toaster.tsx`** - Toast container
- **File: `src/components/ui/textarea.tsx`** - Textarea input

---

## 9. How to Invite a Seller

1. Go to Settings → Users in the dashboard
2. Click "Invite User"
3. Enter email and select role: **Seller**
4. The invited user will receive an email to join the organization
5. Once accepted, they can access `/[org-slug]/products`

---

## 10. Key Design Decisions

### Customers Don't Have Login
- Customers are created by sellers for phone/text orders
- No authentication required for customers
- Sellers create orders ON BEHALF of customers

### Order Status Workflow
```
New Order → Preparing → Ready → Completed
                  ↓
              Cancelled (at any point before completed)
```

### Price Management
- Prices are stored per variant (size/option)
- Example: "Whole Chicken" has variants: Small (RM15), Medium (RM25), Large (RM35)
- Sellers can adjust prices anytime through the Products page

### Currency
- All prices displayed in Malaysian Ringgit (MYR)
- Format: `RM XX.XX`

---

## Summary

| Component | Files Changed/Created |
|-----------|---------------------|
| Database Schema | 1 migration file |
| Types | 1 file modified |
| Permissions | 2 files modified |
| Server Actions | 1 new file |
| UI Pages | 5 pages + components |
| Sidebar | 1 new component |
| Tests | 1 file modified |
| Toast UI | 4 new files |

---

## Next Steps

1. Apply the database migration to your Supabase project
2. Invite users with the "seller" role
3. Add sample categories and products
4. Test the order creation flow

---

*Generated by Cursor AI on July 18, 2026*

---

## Changelog — 2026-07-29: Units, images, and fixes

Migration: `supabase/migrations/20260729000001_catalog_units_images_fixes.sql`

**Catalog now models how chicken is actually sold**

- `product_variants.unit_type` is `per_kg` or `per_piece`; `price_per_unit` means
  RM per kg or RM per piece accordingly. Existing variants default to `per_piece`.
- `order_items.quantity` and `buyer_order_items.quantity` widened to
  `numeric(10,3)`, so a line can be 1.5 kg.
- Product photos upload to the public `product-images` Storage bucket at
  `{organization_id}/{uuid}.{ext}`.

**Bugs fixed**

- Add Category / Product / Variant did nothing. Two causes, both fixed: the
  dialogs used `<form action={fn}>`, which is a React 19 feature that silently
  no-ops on this project's React 18, so the handler never ran; and the client
  passed the organization *slug* where the server expected the organization
  *UUID*, which Postgres rejected. Forms now use `onSubmit`, and the page passes
  `org.id`.
- Delete buttons silently affected zero rows — the tables had no DELETE RLS
  policies. Added for categories, products, variants, and customers. Orders stay
  non-deletable by design; cancel is the workflow.
- `requireSellerRole` queried `organization_members` without filtering by user,
  so it read an arbitrary member's role. It now checks the current user.
- Mutations called `revalidatePath("/[organizationSlug]/...")` with the literal
  placeholder, which revalidated nothing. Actions now take the real slug.

**Structure**

- The Products page is a card grid with category filter chips. The 598-line
  `products-client.tsx` became a 204-line shell plus focused components under
  `src/features/seller/components/products/`.
- Pure helpers, unit-tested: `src/features/seller/lib/pricing.ts` (price and
  quantity formatting, subtotals) and `.../catalog-model.ts` (grid filtering,
  counting, sorting).

**Deploying this change**

The migration must be applied to whichever Supabase project the app points at
(`NEXT_PUBLIC_SUPABASE_URL` in `.env.local`) — `npx supabase db push` for the
hosted project. Until it is applied there, variant writes fail on the missing
`unit_type` column, deletes stay silently blocked, and image upload has no
bucket.
