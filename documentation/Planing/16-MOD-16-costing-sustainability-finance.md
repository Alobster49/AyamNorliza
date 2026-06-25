# 16 - MOD-21: Operational costing, sustainability and finance integration

Source: `documentation/Chicken_Coop_Management_System_Complete_Module_Operations_Blueprint.md` (lines 2372-2450)

# 21. MOD-16 - Operational costing, sustainability and finance integration

## 21.1 Purpose

Allocate operational inputs and losses to houses/flocks, provide actionable cost and resource-intensity reporting, and exchange reconciled financial references with ERP/accounting without recreating a full general ledger.

## 21.2 Primary users

Farm manager, owner/executive, finance/procurement, inventory, maintenance, sustainability/data analysts and auditors.

## 21.3 Capabilities

- Maintain cost categories for birds/chicks/pullets, feed, medicine/vaccine, labor, energy, water, maintenance, sanitation, transport, loss and other configured categories.
- Create cost entries from inventory issue, purchase receipt, work order, utility reading, labor/task time, mortality/loss and external ERP import.
- Allocate cost by flock, house, site, period, production lot or output using transparent methods.
- Store external invoice, purchase order, cost-center and ledger references for reconciliation.
- Calculate operational cost per bird placed, live bird, kg live weight, dozen eggs, egg mass or other selected output.
- Report water, feed, energy, fuel, waste and mortality intensity by flock/site/output.
- Maintain budget/target profiles and compare actual, committed and forecast values.
- Export approved journals or cost summaries to ERP and reconcile import/export status.
- Preserve source detail and never present operational estimates as audited financial statements unless reconciled and approved.

## 21.4 Cost source hierarchy

| Source | Example | Reliability label |
|---|---|---|
| Direct transaction | Inventory lot issued to a treatment or work order. | Direct actual |
| Metered consumption | Electricity/water/fuel meter assigned to house/flock period. | Metered actual |
| Time capture | Worker or contractor time recorded against task/work order. | Recorded actual |
| Allocated shared cost | Site utility or labor distributed by bird-days, area, output or approved driver. | Allocated actual |
| External finance import | Approved invoice/journal from ERP. | Reconciled actual |
| Plan/forecast | Expected feed, output, utility or maintenance. | Forecast |

Reports must show source and allocation method.

## 21.5 Key entities

| Entity/table | Important fields |
|---|---|
| `cost_categories` | Code, description, unit/type, direct/allocated and status. |
| `cost_entries` | Source module/entity, amount in minor units, currency, quantity, event/accounting date and status. |
| `cost_allocations` | Cost entry, target flock/house/site/lot, method, driver, share and result. |
| `allocation_rules` / `allocation_rule_versions` | Applicability, driver, priority, owner, approval and effective dates. |
| `budgets` / `budget_lines` | Scope, period, category, amount/quantity and version. |
| `resource_metrics` | Feed/water/energy/fuel/waste quantity, scope, period, source and quality. |
| `finance_sync_records` | Direction, external system/reference, payload hash, result and reconciliation. |

## 21.6 Business rules

- Currency values use integer minor units or explicitly precise numeric; floating point is prohibited.
- Every cost entry has one source and an immutable source reference.
- Allocations must total 100 percent or the source amount, subject to rounding rule.
- Shared-cost methods are versioned and visible in reports.
- A changed allocation creates a new version/reversal, not a silent overwrite.
- Operational cost reports label unreconciled estimates and missing sources.
- ERP webhooks/imports are signature-verified and idempotent.

## 21.7 UI and routes

- `/costing/overview`
- `/costing/flocks/[flockId]`
- `/costing/allocations`
- `/sustainability`
- `/budgets`
- `/integrations/finance`

## 21.8 KPIs

Cost per kg/dozen/egg mass, feed cost share, medicine cost, maintenance cost, mortality/loss cost, labor per output, water/energy per bird/output, budget variance and unreconciled finance transactions.

## 21.9 Module acceptance gate

- A flock cost statement can be traced to source inventory, work-order, utility, labor or ERP records.
- Allocation method and version are visible.
- Operational and reconciled financial values are clearly distinguished.
- Corrections preserve reversals/version history.

---


---

*Source: documentation/Chicken_Coop_Management_System_Complete_Module_Operations_Blueprint.md (lines 2372-2450)*
