# Terus Segar — buyer portal buy-flow redesign

Date: 2026-08-23. Chosen from five panel concepts ("Lima Konsep AyamNorliza"
artifact); Terus Segar = merge of the "Terus" funnel skeleton and the
"Pasar Segar" pricing/auth organs. Winner because it is the only direction
grounded entirely in code that exists today: inline checkout signup on the
current Supabase email/password actions, light theme via a scoped token
class, no SMS vendor, no schema change.

## Problem

The buyer portal (`src/app/buyer_portal/[organizationSlug]/*`) is a generic
dark shell: empty gray hero, identical product cards each repeating the
"Indicative price" disclaimer, a bare cart page, and a hard login wall —
checkout `requireBuyerOrRedirect()` (`src/lib/auth/buyer-auth.ts:93`) bounces
an anonymous buyer to a dual-mode login card with `?next=`, the single worst
friction cliff in the funnel. Weighed pricing (final price set per kg after
the order is closed) is explained as repeated legal noise instead of once,
well. Poppins is declared in `--font-ui` (globals.css:40) with no webfont
behind it.

## Design direction

Warm butcher-paper light, buyer portal only. Seller dashboard untouched.

- **Theme scope, no next-themes change**: a `.buyer-theme` class on the buyer
  layout wrapper div redefines the shadcn tokens for the subtree (child
  custom-property definitions beat the inherited `.dark` values, so no
  ThemeProvider surgery). `color-scheme: light` inside it.
- **Tokens** (added to globals.css under `.buyer-theme`):
  `--background` cream `oklch(0.97 0.015 78)`; `--foreground` warm charcoal
  `oklch(0.24 0.02 55)`; `--primary` turmeric `oklch(0.74 0.16 76)` (ink
  foreground); chili `oklch(0.57 0.18 28)` as `--buyer-delta` — reserved for
  the estimate→final price delta and nothing else; kampung green
  `oklch(0.56 0.09 145)` as `--buyer-confirmed` — only for confirmed states
  (zone ✓, slot ✓, delivered). Card surfaces slightly lighter cream, borders
  warm alpha ink. 3% SVG feTurbulence grain on page background.
- **Type**: `next/font/google` in the buyer layout — Fraunces (variable,
  opsz axis, 400–700) for hero/section heads/product names; Schibsted
  Grotesk (400/500/700) for all UI; IBM Plex Mono (400/500,
  `font-variant-numeric: tabular-nums`) exclusively for weights and prices.
  Exposed as `--font-buyer-display / -ui / -mono` on the wrapper. Root
  layout, `--font-ui`, and DM Serif Display are untouched.
- **Motion contract** (all buyer components): springs damping 1.0
  (~300–400ms settle), press feedback on pointer-down (scale 0.97), sheets
  drag-dismissable and interruptible, `prefers-reduced-motion` swaps every
  spring/slide for a ≤200ms crossfade, no `backdrop-filter` anywhere —
  sheets use flat warm-white fill at ~94% opacity + grain. New dependency:
  `motion` (Motion One / Framer Motion successor) for springs; everything
  else CSS.

## Shared primitives (new, `src/features/buyer/components/`)

- `scale-chip.tsx` — the one reusable price object. Props:
  `{ unitType: "per_kg" | "per_piece", pricePerUnit, estMin?, estMax?,
  final?: { weightKg, pricePerKg, lineTotal } }`. Estimate state: mono
  `~RM 9.90/kg` + hairline gauge bar spanning the min–max estimate. Final
  state: solid amount, gauge collapsed to a point, delta line in
  `--buyer-delta` ("Ditimbang: 1.62kg → RM16.04, turun RM0.79 dari
  anggaran"). Never accompanied by disclaimer prose. Used on product card,
  cart line, checkout review, order card, order detail.
- `pricing-explainer-sheet.tsx` — taught once: three frames (Anda pilih ayam
  / Kami timbang bila sedia / Harga ikut berat sebenar) with an animated
  scale needle settling from range to number. Auto-opens on first shop visit
  (`localStorage` flag `buyer_pricing_explained_v1`), replayable from the
  single ⓘ on the first product card and the "?" beside the cart total.
- `add-to-cart-sheet.tsx` — bottom sheet opened by "+ Tambah": piece/kg
  segmented control (spring-sliding indicator), size range stepper snapping
  to 0.1 kg with the ScaleChip recalculating live, and the four existing
  fallbacks (`cancel | mix | upsize | downsize`, `src/features/orders/types.ts:47`)
  as icon-forward radio cards replacing the Select. Writes a `CartLine`
  through the existing `useCart()` (`cart-context.tsx:157`); cart storage
  schema unchanged (`buyer_cart_v2`).
- `peek-cart-bar.tsx` + `cart-sheet.tsx` — mini-bar docks above the safe
  area the instant a line is added ("2 item · ~RM38 · Lihat troli"); tap or
  drag expands to the full cart sheet; velocity dismiss. Desktop ≥1280px:
  the sheet is replaced by a persistent right-rail cart. The `/cart` route
  stays (deep links) and renders the same cart content as a page.

## Pages

### Shop (`shop/page.tsx`, `product-grid.tsx`, `product-card.tsx`)

Full-bleed warm hero (product/farm photo if `image_url` exists, else line-art
rooster-and-scale SVG on cream) with Fraunces headline; kills the gray box.
Sticky horizontal category chip row (from `getPublicCatalog` categories,
`display_order`), torn-edge clip-path pills, scroll-snap. Cards: photo, name
in Fraunces, ScaleChip, full-width "+ Tambah" pill. Exactly one ⓘ glyph on
the page (first card). Phone single column, tablet 2-up, desktop 3–4-up.
No product detail page in this arc.

### Cart

Expanded sheet/page: circular thumbnail rows, 44px steppers, per-line
ScaleChip, range total + "?" explainer trigger. Empty state: line-art
rooster, "Troli kosong — jom pilih ayam segar". Sticky "Teruskan" in the
thumb zone.

### Auth — inline account at checkout (no wall, no guests)

Decision (Hafiz, 2026-08-23): every order belongs to a real, reusable
account so buyers can sign in from any device, reuse saved addresses, and
the shipped customer–buyer sync (phone match trigger, ed3da10) auto-links
every buyer to a `customers` row — the CRM database builds itself. What
dies is the *redirect*, not the account.

- Checkout no longer calls `requireBuyerOrRedirect`; the page fetches
  `getBuyerFromSession()` and renders for anonymous buyers with an
  **Akaun anda** section as checkout step 1 — no navigation, cart never
  leaves the screen.
- Akaun anda has a segmented toggle: **Akaun baru** (name, +60 phone via
  existing `normalizeMalaysianMobile`, email, password ≥8) / **Sudah ada
  akaun** (email, password). Copy under phone: "Kami akan hantar kemas kini
  pesanan ke nombor ini."
- Submit runs the existing actions in sequence: `buyerSignUpAction` (or
  `buyerSignInAction`) → on success straight into `placeOrder` in the same
  handler. A `conflict` from signup ("already registered") flips the toggle
  to Sudah ada akaun with the email prefilled. Field errors render inline
  from `fieldErrors`. **No new auth actions.**
- Signed-in buyers never see the section; their saved addresses load as
  before.
- `/login` survives for returning buyers and old bookmarks, restyled to the
  Terus skin (segmented sign-in / create-account), actions unchanged.
- Deploy pre-checks (documented, not code): hosted Supabase must have
  signups enabled and email confirmation OFF so `signUp` returns a live
  session and `placeOrder` can run immediately after it.

### Checkout (`checkout-client.tsx` rebuilt on same actions)

One screen, sectioned (not paginated): Akaun anda (anonymous only) → address
(saved addresses as tappable stamps via `listMyAddresses`, or postcode-first
`AddressFields`) → zone (existing `idle/resolving/resolved/uncovered`
machine + `resolveZoneForPostcode`; resolved = green "Zon: X ✓" chip;
uncovered = warm waitlist card + WhatsApp link, no dead end) → slots
(`getDeliveryOptions` grouped by date; horizontal date pills → time-block
cards; picking triggers **Slot Snap**: the slot section contracts via spring
into a confirmed pill docked beside the total, tappable to reopen) →
collapsed "+ Tambah nota". Sticky bottom bar: running estimate + narrating
CTA ("Buat akaun" → "Pilih alamat" → "Pilih slot" → "Hantar pesanan"),
squish on pointer-down. Submit path: (anonymous? `buyerSignUpAction` /
`buyerSignInAction` →) `placeOrder` — `placeOrder` itself unchanged.

### Confirmation + orders

Confirmation upgrades from inline card (checkout-client.tsx:233) to a
full-width takeover: scale-settle animation, stamp check, order id, and a
3-step tracker (Ditempah → Ditimbang & harga disahkan → Dalam penghantaran)
mapped from order status (pending/confirmed/ready → 1, delivered → 2,
closed → 3). Orders list (`getMyOrders`): each card carries its ScaleChip —
estimate state while open, final state once closed (`final_weight_kg`,
`price_per_kg`, `line_total`, `total_amount` already buyer-visible). Order
detail runs the delta reveal; weighing framed as good news.

## Data

No table changes and no new server actions. One migration was required
during implementation (20260823000008): the wall-free checkout means an
anonymous buyer must check zone coverage and slot availability BEFORE the
inline account exists, so `resolve_zone_for_postcode` and
`get_delivery_options` are granted EXECUTE to `anon`, and
`get_delivery_options` drops its in-function buyer/member guard (slot
availability is storefront data any free buyer signup could already read).
`requireBuyer()` was removed from those two read actions only; every write
path stays authenticated. Covered by pgTAP `22_anon_zone_slot_lookup.sql`.
Everything else reuses `buyerSignUpAction`, `buyerSignInAction`,
`getPublicCatalog`, `listMyAddresses`, `createAddress`,
`resolveZoneForPostcode`, `getDeliveryOptions`, `placeOrder`, `getMyOrders`,
`getMyOrder`, `cancelMyOrder`.

## Testing

- Vitest: ScaleChip formatting (estimate range, final + delta sign/copy),
  tracker step mapping per status, explainer flag logic, checkout CTA
  narration state machine, cart line schema still accepts stored v2 lines
  after the optional price fields land.
- pgTAP: unchanged (no schema change) — `npm run db:test` must stay green.
- Playwright e2e: first-order path (shop → add via sheet → checkout →
  inline account creation → order placed, never seeing /login), returning
  signed-in path, uncovered postcode path. Existing buyer e2e updated for
  the new copy/controls; the rest stays green.

## Verification

`npm run typecheck`, `npm run lint`, `npx vitest run`, `npm run test:e2e`;
dev-server visual pass at 375px / 768px / 1280px, light + `.dark` root (buyer
pages must stay cream under both), and `prefers-reduced-motion` spot check.

## Out of scope

Phone OTP / SMS vendor, product detail page, seller dashboard styling,
schema changes, WhatsApp deep-link number sourcing (config), Selasar/Pantas
grafts (tick tracking, Smart Bar).
