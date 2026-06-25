# 02 - MOD-7: Farm structure, houses and master data

Source: `documentation/Chicken_Coop_Management_System_Complete_Module_Operations_Blueprint.md` (lines 609-716)

# 7. MOD-02 - Farm structure, houses and master data

## 7.1 Purpose

Maintain the shared operational hierarchy and controlled master data used by every transaction, rule, report and integration.

## 7.2 Primary users

Organization administrator, farm manager, biosecurity/quality lead, veterinarian, maintenance lead and data steward.

## 7.3 Capabilities

- Maintain organization, site/farm, biosecurity zone, house/coop, room/area and storage-location hierarchy.
- Store house capacity, dimensions, housing system, production purpose, floor plan, coordinates, equipment, operational status and criticality.
- Maintain production profiles for layer, broiler, breeder and simplified smallholder workflows.
- Maintain versioned target profiles and curves by breed/strain, age/stage, season, house type and source.
- Maintain controlled lists for breeds, feed products, units, egg grades, mortality causes, observation codes, sanitation chemicals, medicine catalogs, suppliers and report categories.
- Support local terminology, multiple languages, time zones, currencies and display units while storing canonical units.
- Generate durable QR/barcode labels for houses, assets, flocks, lots, samples and shipments.
- Track master-data approval, effective dates, superseded status and impact on active operations.

## 7.4 Structure model

| Entity | Definition |
|---|---|
| Organization | Tenant and data-ownership boundary. |
| Site/farm | Operational location containing houses, stores and support areas. |
| Biosecurity zone | Access-controlled area with entry requirements and movement restrictions. |
| House/coop | Main bird housing unit and environmental/equipment context. |
| House area | Optional room, pen, tier, section or sensor zone within a house. |
| Storage location | Feed, medicine, chemical, egg, spare-part or general inventory location. |
| Production profile | Configuration selecting workflows, fields, KPIs and state rules for a production type. |
| Target profile version | Approved age/stage curves, bands, schedules and alerts effective for defined flocks/houses. |

## 7.5 Key workflows

### Create a site and house

1. Administrator creates the site with time zone, units, contacts and biosecurity layout.
2. Houses are created with capacity, production purpose and operating characteristics.
3. Biosecurity zones, stores, access points and waste/mortality areas are linked.
4. Assets, devices, inspection templates and applicable SOPs are assigned.
5. Manager/quality reviews readiness of master data before the site is activated.

### Publish a target profile version

1. Qualified owner creates or clones a draft profile.
2. Curves, bands, schedules, formulas and source documents are entered.
3. Validation checks for gaps, overlaps, unit consistency and unsupported production stages.
4. Veterinary/operations/quality approval is captured as configured.
5. Version receives an effective date; active flocks retain their assigned version unless an approved change is applied.

## 7.6 Key entities

| Entity/table | Important fields |
|---|---|
| `sites` | Organization, name, code, address/coordinates, time zone, status and contacts. |
| `biosecurity_zones` | Site, name, risk class, parent zone, entry rules and status. |
| `houses` | Site/zone, code, capacity, dimensions, housing system, purpose, status and geometry. |
| `house_areas` | House, area type, capacity, sequence and geometry. |
| `storage_locations` | Site/zone, location type, conditions, restricted flag and status. |
| `production_profiles` | Type, supported workflow options, owner and status. |
| `target_profiles` | Profile family, breed/strain, housing, region and owner. |
| `target_profile_versions` | Version, effective dates, approval, source, status and immutable definition hash. |
| `target_curve_points` | Metric, age/stage, target/min/max, unit and interpolation method. |
| `code_sets` / `code_values` | Versioned controlled vocabularies and translations. |
| `qr_identifiers` | Entity type/id, printable code, status and replacement history. |

## 7.7 Business rules

- Active houses have a unique code within a site.
- Capacity and dimensions must be non-negative and use canonical units.
- A house status transition is controlled: `draft -> active -> maintenance/restricted -> inactive/retired`.
- A target-profile version is immutable after approval; a change creates a new version.
- Historical records retain the exact profile/version applied when the event occurred.
- Deactivating a master-data value does not remove it from historical records.
- A production profile determines which production-specific screens, fields, reports and constraints are available.
- Site time zone controls display and operating-day boundaries; timestamps are stored as `timestamptz` in UTC.

## 7.8 UI and routes

- `/settings/sites`
- `/settings/sites/[siteId]`
- `/settings/houses/[houseId]`
- `/settings/zones`
- `/settings/storage-locations`
- `/settings/production-profiles`
- `/settings/target-profiles/[profileId]/versions/[versionId]`
- `/settings/master-data`
- `/settings/labels`

## 7.9 Reports and controls

- Site/house master-data completeness.
- Active/inactive/restricted houses.
- Target-profile version usage by flock.
- Master-data values with upcoming expiry or review.
- QR/barcode label inventory and replacement history.

## 7.10 Module acceptance gate

- A complete farm hierarchy can be created and used to scope users, flocks, assets, inventory and reports.
- Historical transactions continue to resolve after a master-data value is superseded.
- Target-profile versions are approved, immutable and visible on every calculation using them.
- Invalid unit, date or hierarchy combinations are blocked by database constraints and server validation.

---


---

*Source: documentation/Chicken_Coop_Management_System_Complete_Module_Operations_Blueprint.md (lines 609-716)*
