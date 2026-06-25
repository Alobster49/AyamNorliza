# 12 - MOD-17: Inventory, procurement and supplier management

Source: `documentation/Chicken_Coop_Management_System_Complete_Module_Operations_Blueprint.md` (lines 1867-1991)

# 17. MOD-12 - Inventory, procurement and supplier management

## 17.1 Purpose

Maintain accurate, lot-controlled stock for feed, medicines, vaccines, chemicals, PPE, spare parts and general supplies, with receiving, quarantine/release, FEFO issue, counting, expiry and supplier assurance.

## 17.2 Primary users

Inventory/store personnel, procurement, farm manager, veterinarian/quality, maintenance, supervisors and finance integration.

## 17.3 Capabilities

- Maintain item catalog, category, canonical unit, storage requirements, controlled-item status and approved substitutes.
- Maintain suppliers, approval status, certificates, product scope and review dates.
- Create purchase requisitions, approvals and purchase orders where included.
- Receive goods against order or approved ad hoc receipt with supplier, lot/batch, expiry, quantity, certificate and inspection.
- Assign disposition: `quarantine`, `released`, `blocked`, `rejected` or `returned`.
- Move stock between controlled locations and record every stock transaction.
- Issue stock by FEFO, scan lot/barcode and link use to flock, treatment, sanitation, maintenance or task.
- Maintain reserved stock for scheduled vaccination, treatment, maintenance or emergency needs.
- Perform cycle counts/full counts, investigate variance and approve adjustments.
- Identify low stock, reorder point, upcoming expiry, cold-chain/storage exception and recalled lots.
- Record disposal/return with reason, method, authorization and evidence.
- Exchange purchase/invoice/payment data with ERP rather than recreating full accounting.

## 17.4 Stock state and transaction model

```text
Inventory lot status:
quarantine -> released -> blocked -> released
quarantine -> rejected/returned
released -> depleted
released/blocked -> expired -> disposed/returned
```

Stock quantity is derived from immutable transactions:

```text
Opening quantity
+ receipt
+ transfer in
+ positive adjustment
- issue/use
- transfer out
- return/disposal
- negative adjustment
= available physical quantity
```

Reservations are tracked separately from physical quantity.

## 17.5 Receiving workflow

1. Select supplier/order and capture delivery details.
2. Scan/create product lot, expiry and quantity.
3. Attach certificate, temperature/log or quality evidence when required.
4. Inspect and choose disposition.
5. Create stock transaction and storage assignment.
6. Notify responsible roles of rejected/quarantined/short delivery.
7. Update replenishment and scheduled-work availability.

## 17.6 Key entities

| Entity/table | Important fields |
|---|---|
| `inventory_items` | Code, category, description, base unit, controlled flag, storage and status. |
| `item_suppliers` | Item, supplier, approved status, lead time, supplier product code and documents. |
| `inventory_lots` | Item, lot/batch, supplier, manufacture/expiry, disposition, location and quality status. |
| `stock_transactions` | Lot, location, type, quantity, source/destination entity, user and event time. |
| `stock_reservations` | Lot/item, planned use, quantity, start/end and status. |
| `purchase_requisitions` | Requester, site, items, need date, justification, status and approvals. |
| `purchase_orders` | Supplier, order lines, currency/minor units, status and external ERP reference. |
| `goods_receipts` | PO/delivery, vehicle, receiver, result and documents. |
| `inventory_counts` / `inventory_count_lines` | Scope, counted quantity, expected quantity, variance and approval. |
| `supplier_approvals` | Scope, certificates, audit, risk, approval and next review. |
| `inventory_disposals` | Lot, quantity, reason, method, approver and evidence. |

## 17.7 Business rules

- Quantity, unit and money fields use canonical database representation; money is integer minor units or explicitly precise numeric.
- Expired, blocked, rejected, depleted or quarantined lots cannot be issued.
- Controlled medicine/vaccine/chemical issue requires the applicable role and source workflow.
- FEFO is the default suggestion; override requires reason and may require approval.
- A negative physical balance is prohibited unless a controlled correction process temporarily permits investigation.
- The same supplier/item lot receipt is protected by idempotency and duplicate detection.
- Inventory adjustments require a reason; large or controlled-item variance requires independent approval.

## 17.8 UI and routes

- `/inventory/overview`
- `/inventory/items`
- `/inventory/lots`
- `/inventory/receiving`
- `/inventory/issues`
- `/inventory/transfers`
- `/inventory/counts`
- `/inventory/expiry`
- `/procurement/requisitions`
- `/procurement/purchase-orders`
- `/suppliers`

## 17.9 Events and alerts

- `inventory.receipt_created`
- `inventory.lot_quarantined`
- `inventory.lot_released`
- `inventory.low_stock`
- `inventory.expiry_approaching`
- `inventory.storage_exception`
- `inventory.count_variance`
- `supplier.approval_expiring`

## 17.10 KPIs

Stock accuracy, count variance, stockout events, expiry loss, FEFO compliance, order lead time, supplier rejection rate, emergency purchase rate and inventory value by category/site.

## 17.11 Module acceptance gate

- Every issue can be traced to an item lot, location, user, purpose and flock/task where applicable.
- Blocked/quarantined/expired stock cannot be selected by normal workflows.
- Physical quantity reconciles from transactions and count adjustments are audited.
- Medicine, vaccine, feed and chemical lots link to downstream operational records.

---


---

*Source: documentation/Chicken_Coop_Management_System_Complete_Module_Operations_Blueprint.md (lines 1867-1991)*
