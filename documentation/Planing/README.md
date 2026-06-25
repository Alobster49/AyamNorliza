# Chicken Coop Blueprint - Phase Plans Index

This folder breaks down the complete blueprint into individual phase-aligned markdown files so you can implement one piece at a time.

**Source:** `documentation/Chicken_Coop_Management_System_Complete_Module_Operations_Blueprint.md` (4510 lines, 40 top-level sections)

---

## How to use

1. Start with **00-foundation.md** and **operations-roadmap-workflows-screens-delivery.md** for context, scope, phases, and the final architecture recommendation.
2. Read both **shared/** files once before starting any module - they define the data model, security, UI, offline, NFR, testing and CI/CD rules every module must obey.
3. Implement modules in the **Recommended build order** below, one at a time, in the order shown for each phase.

---

## File index

### Foundation

- `00-foundation.md` - Sections 1-5: executive decisions, business outcomes, target operating model, solution architecture, module catalog with dependency graph.

### Shared / cross-cutting (read before any module)

- `shared-data-security-architecture.md` - Sections 26-29: cross-module data architecture, Supabase RLS/security, server/client UI/forms design, offline PWA and sync.
- `shared-platform-nfr-testing-cicd.md` - Sections 30-34: storage, Realtime, background work, NFR and SLAs, testing strategy, migrations, CI/CD and observability.

### Operations, roadmap and delivery

- `operations-roadmap-workflows-screens-delivery.md` - Sections 35-40: implementation phases 0-5, cross-module operational workflows, screen inventory, requirement traceability, appendices, final architecture recommendation.

### Modules (one per MOD-NN)

| File | Module | Source lines |
|---|---|---|
| `01-MOD-01-tenant-identity-access.md` | MOD-01 Tenant, identity and access management | 485-608 |
| `02-MOD-02-farm-structure-master-data.md` | MOD-02 Farm structure, houses and master data | 609-716 |
| `03-MOD-03-flock-planning-lifecycle.md` | MOD-03 Flock planning and lifecycle | 717-861 |
| `04-MOD-04-daily-operations-rounds.md` | MOD-04 Daily operations, rounds, shifts and period close | 862-991 |
| `05-MOD-05-environment-iot-control.md` | MOD-05 Environment, IoT monitoring and safe control | 992-1106 |
| `06-MOD-06-alerts-incidents-emergency.md` | MOD-06 Alerts, incidents and emergency management | 1107-1253 |
| `07-MOD-07-feed-water-nutrition.md` | MOD-07 Feed, water and nutrition operations | 1254-1371 |
| `08-MOD-08-production-management.md` | MOD-08 Production management | 1372-1509 |
| `09-MOD-09-health-welfare-veterinary.md` | MOD-09 Health, welfare, mortality and veterinary management | 1510-1648 |
| `10-MOD-10-biosecurity-visitors-vehicles.md` | MOD-10 Biosecurity, visitors, vehicles and outbreak control | 1649-1765 |
| `11-MOD-11-sanitation-litter-waste-pest.md` | MOD-11 Sanitation, litter, waste, mortality disposal and pest control | 1766-1866 |
| `12-MOD-12-inventory-procurement-suppliers.md` | MOD-12 Inventory, procurement and supplier management | 1867-1991 |
| `13-MOD-13-assets-maintenance-calibration.md` | MOD-13 Assets, maintenance, calibration and utilities | 1992-2125 |
| `14-MOD-14-workforce-tasks-training-sops.md` | MOD-14 Workforce, tasks, training, SOPs and communication | 2126-2242 |
| `15-MOD-15-traceability-logistics-recall.md` | MOD-15 Traceability, logistics, shipments and recall | 2243-2371 |
| `16-MOD-16-costing-sustainability-finance.md` | MOD-16 Operational costing, sustainability and finance integration | 2372-2450 |
| `17-MOD-17-dashboards-reporting-ai.md` | MOD-17 Dashboards, reporting, analytics and governed AI | 2451-2564 |
| `18-MOD-18-documents-media-signatures.md` | MOD-18 Documents, media, signatures and records management | 2565-2668 |
| `19-MOD-19-administration-configuration-governance.md` | MOD-19 Administration, configuration and data governance | 2669-2754 |
| `20-MOD-20-integrations-apis-events.md` | MOD-20 Integrations, APIs, events and connector operations | 2755-2914 |

---

## Recommended build order (from blueprint Phase 0-5 roadmap)

| Phase | Read | Build |
|---|---|---|
| Phase 0 - Discovery and operating-model approval | `00-foundation.md`, `operations-roadmap-workflows-screens-delivery.md` | - |
| Phase 1 - Platform foundation | both `shared/` files | `01-MOD-01`, `02-MOD-02` |
| Phase 2 - Operational MVP | both `shared/` files | `03-MOD-03`, `04-MOD-04`, `07-MOD-07`, `08-MOD-08`, `09-MOD-09`, `10-MOD-10`, `11-MOD-11`, `12-MOD-12`, `13-MOD-13`, `17-MOD-17` |
| Phase 3 - Connected pilot | both `shared/` files | `05-MOD-05`, `06-MOD-06`, `14-MOD-14`, `20-MOD-20` |
| Phase 4 - Production hardening | both `shared/` files | `15-MOD-15`, `16-MOD-16`, `18-MOD-18`, `19-MOD-19` |

---

## File footer convention

Every split file ends with:

```
---
*Source: documentation/Chicken_Coop_Management_System_Complete_Module_Operations_Blueprint.md (lines X-Y)*
```

Each file also opens with a header line and source-line reference so you can always trace content back to the original blueprint.
