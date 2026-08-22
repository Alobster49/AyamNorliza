# AyamNorliza Ops — Improvement & Simplification Suggestions

*Internal companion to `system-overview.md`. Ranked by leverage: what makes daily life easiest for the office, the driver, and the customer, relative to build effort.*
*Last updated: 2026-08-22*

---

## Top 3 (do these first)

### 1. Failed-delivery inbox
**Problem:** `driver_fail_stop` records the failure and the driver's suggested next step (`retry_today` / `move_tomorrow` / `return_to_yard`), but nothing surfaces it. The office has to remember to hunt for failed stops; an order can silently sit "Ready, undelivered" forever.
**Suggestion:** A "Needs attention" strip on the Orders or Dispatch screen listing orders with a failed attempt and no resolution, with one-click actions: *re-dispatch tomorrow* (assign to tomorrow's run), *retry today*, *cancel with reason*. Data already exists in `delivery_attempts` — this is mostly a query plus a small UI.
**Why first:** it closes the only loop in the flow where an order can fall through the cracks, and it's cheap.

### 2. Buyer notifications (WhatsApp-first)
**Problem:** Buyers only learn anything by opening the portal. In this market the customer lives in WhatsApp — the driver deck already leans on `wa.me` links.
**Suggestion:** Start manual-but-assisted, not automated: pre-filled WhatsApp message templates at the three moments that matter — order confirmed (with applied fallbacks), truck departed ("your order is on the way"), order closed (final weight + price). One tap from the order/run screen opens WhatsApp with the message ready. Later, upgrade to the WhatsApp Business API for true automation.
**Why:** biggest perceived-quality jump for the customer per unit of effort; the manual version needs no external integration at all.

### 3. Payment status
**Problem:** `close_order` computes a total and drivers log `cash_collected`, but nothing marks an order paid or reconciles cash against totals. The business's money-side lives outside the system, so "Closed" doesn't mean "paid".
**Suggestion:** Minimal version: a `paid` flag + payment method + amount on the order, settable at close or afterwards, plus a daily "cash collected vs. cash expected per driver/run" summary from data that already exists. Not invoicing — just closing the cash loop.
**Why:** it's the question every owner asks first ("who still owes me?"), and the data is 80% captured already.

---

## Worth doing next

### 4. Order editing while Pending
Orders are fully immutable after creation — any change (address typo, +1 chicken, different date) forces cancel-and-recreate, and the office re-keys everything. Suggestion: allow managers to edit items/address/slot **while status is Pending only** (before confirmation nothing downstream depends on the order), or at minimum a "Duplicate order" button that pre-fills a new order from a cancelled one. The second option is UI-only — no new DB rules.

### 5. Show buyers an "Out for delivery" stage
The run already knows when it departs; buyers just aren't told. Mapping *run departed + order on run* to an "Out for delivery" badge on the buyer's order page is a read-only change (one query + one badge) and kills the most common "where is my order?" call.

### 6. Estimated price at checkout
Buyers see no price until settlement. Weight-based pricing makes exact prices impossible, but an estimate (price/kg × midpoint of the ordered size range × quantity, labelled clearly as an estimate) sets expectations and reduces disputes at the door. Business decision first, small feature second.

---

## Simplifications (remove or hide, don't build)

### 7. Hide the 8 unused roles
The role system declares 14 roles; only 6 (owner, org_admin, seller, logistics, inventory, driver) are wired to any screen or rule. The other 8 (farm_manager, supervisor, caretaker, veterinarian, biosecurity_qa, maintenance, auditor, support) are inert but appear in the Roles settings and invite UI — a client admin can assign someone "veterinarian" and nothing happens, which reads as broken. Hide them from the UI until their modules exist. Pure subtraction; keeps the client demo clean.

### 8. Merge Tasks (weighing) and Loading into one warehouse flow
Warehouse staff bounce between two screens for one physical sequence (weigh → load). A single per-truck checklist — "weigh these, then tick loaded" — matches how the work actually happens at the yard and drops one screen from training. Medium effort; validate with the pilot users first before building.

### 9. Structured cancellation reasons
Cancel reasons are appended into the free-text `notes` field, which makes "why do we lose orders?" unanswerable later. A small enum (customer changed mind / out of stock / address issue / other + note) in its own column costs little now and buys reporting later. Do it before real data accumulates — retrofitting free text is painful.

---

## Explicitly *not* recommended right now

- **Live GPS driver tracking** — high effort, low payoff at pilot scale; "Out for delivery" (#5) covers 80% of the value.
- **Online payment gateway** — this market is cash/transfer on delivery; build payment *status* (#3) first, gateway only if the client asks.
- **Building out the unused farm-ops modules** (health, biosecurity, feed…) before the order-to-delivery loop is fully closed with real users. The pipeline above is the business; finish its loose ends first.
