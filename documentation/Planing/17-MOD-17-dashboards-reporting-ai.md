# 17 - MOD-22: Dashboards, reporting, analytics and governed AI

Source: `documentation/Chicken_Coop_Management_System_Complete_Module_Operations_Blueprint.md` (lines 2451-2564)

# 22. MOD-17 - Dashboards, reporting, analytics and governed AI

## 22.1 Purpose

Provide role-specific operational awareness, governed KPI definitions, scheduled reports, comparative analysis and carefully controlled advanced analytics.

## 22.2 Primary users

All roles, with content scoped to permission and operational responsibility.

## 22.3 Dashboard hierarchy

| Dashboard | Audience | Primary content |
|---|---|---|
| My work | Worker/supervisor | Assigned rounds/tasks, active alerts, restrictions, training and sync state. |
| House | Worker/supervisor/manager | Current flock, environment, feed/water, production, health, work, devices and data freshness. |
| Site | Farm manager and functional leads | House status cards, exceptions, staffing, inventory, maintenance, biosecurity and trends. |
| Flock | Manager/vet/data | Lifecycle, performance vs target, mortality, intake, production, costs and events. |
| Portfolio | Owner/executive | Site comparison, risk, production, cost, assurance and trend. |
| Functional | Vet, quality, maintenance, inventory, logistics | Domain queue, exceptions, KPIs and compliance. |

Signed-in dashboards should normally use dynamic user-specific Server Component rendering. Do not share user-specific cache entries unless isolation is proven.

## 22.4 Capabilities

- Maintain a KPI catalog with formula, source fields, unit, grain, exclusions, owner, version and effective date.
- Provide current status, target variance, trends, comparison and drill-down.
- Display data freshness, missing values, corrections, sensor quality and confidence alongside results.
- Produce daily, weekly, flock-cycle, veterinary, biosecurity, inventory, maintenance, traceability and management reports.
- Schedule reports to authorized recipients and generate private exports.
- Export PDF, CSV/spreadsheet and API data within permission scope.
- Compare against assigned target, previous flock, site average and approved peer group.
- Provide governed self-service filters/templates without ordinary users accessing raw database tables.
- Support anomaly detection, forecasting and advisory recommendations only after data quality and validation gates.
- Maintain model registry, version, intended use, training/evaluation data, performance, limitations, drift and rollback.

## 22.5 KPI definitions

| KPI | Example formula / rule |
|---|---|
| Daily mortality % | Mortality for period / opening or approved average live birds x 100. Formula variant must be named. |
| Cumulative mortality % | Cumulative mortality / birds placed or approved denominator x 100. |
| Livability % | 100 - cumulative mortality/cull percentage according to approved rule. |
| Hen-day production % | Eggs produced / average live hens for period x 100. |
| Egg mass | Number of eggs x average egg weight, using consistent unit. |
| Feed conversion ratio | Feed consumed / live-weight gain using the approved flock formula and correction rules. |
| Uniformity | Percentage of sampled birds within the approved range around average/target. |
| Coefficient of variation | Standard deviation / mean x 100 for a defined valid sample. |
| Water-to-feed ratio | Water consumed / feed consumed for matching period and scope. |
| Time in environmental target | Valid interval duration in approved band / valid monitored duration. |
| MTTA | Time from alert opening to first valid acknowledgement. |
| MTTR | Time from alert opening to verified closure or approved definition. |
| PM compliance | Completed on time / due preventive-maintenance work. |
| Trace completeness | Required trace links/documents present / required links/documents. |

No KPI formula should be implemented only in UI code. Governed database views/functions or well-tested server modules should be the source.

## 22.6 Analytics maturity and controls

| Stage | Capability | Required control |
|---|---|---|
| Descriptive | Status, trends, target variance and historical comparison. | Defined KPIs, quality flags and permissions. |
| Diagnostic | Correlate environment, intake, equipment, health and production. | Show evidence and alternative explanations; avoid unsupported causal claims. |
| Predictive | Forecast feed depletion, output, harvest weight, anomaly or failure risk. | Back-testing, error/confidence, drift monitoring and human review. |
| Prescriptive advisory | Recommend inspection, maintenance or set-point review. | Bounded recommendations, approver and outcome feedback. |
| Computer vision/AI | Distribution, behavior, mortality candidates, egg count/quality or equipment state. | Farm-specific validation, privacy, false-positive handling, model version and non-AI fallback. |

The system must not autonomously diagnose disease, prescribe medicine or directly control critical equipment based solely on an AI model.

## 22.7 Key entities

| Entity/table | Important fields |
|---|---|
| `kpi_definitions` / `kpi_definition_versions` | Formula, grain, unit, sources, owner, approval and effective date. |
| `report_definitions` / `report_versions` | Layout, filters, data sources, permissions and status. |
| `report_schedules` | Report, recipients, cadence, site/time zone, format and status. |
| `report_runs` | Parameters, result, file, row count, status, duration and error. |
| `dashboard_preferences` | User/role, layout and selected filters; never authorization. |
| `analytics_models` / `model_versions` | Purpose, owner, artifact/reference, evaluation, limitations and status. |
| `model_predictions` | Model version, scope/time, result, confidence, evidence and disposition. |
| `model_feedback` | User decision, correction, outcome and reason. |
| `data_quality_scores` | Dataset/scope/period, dimensions, issues and confidence. |

## 22.8 Reporting implementation

- Use server-side queries, views or materialized views for complex dashboards.
- Use route/tag revalidation after mutations where applicable.
- Schedule heavy exports in a background job; show progress through narrow Realtime.
- Store export files in a private bucket and issue short-lived signed URLs after rechecking access.
- Log export request, filters, recipient, download and expiration.
- Aggregate high-frequency telemetry before long-range visualization.

## 22.9 UI and routes

- `/overview`
- `/sites/[siteId]/overview`
- `/houses/[houseId]/overview`
- `/flocks/[flockId]/performance`
- `/reports`
- `/reports/[reportId]`
- `/analytics`
- `/data-quality`
- `/settings/kpis`
- `/settings/models`

## 22.10 Module acceptance gate

- Every displayed KPI exposes definition/version, source scope and data-quality status.
- Users cannot obtain report/export data outside RLS scope.
- Scheduled private reports do not create permanent public links.
- A predictive/advisory feature includes evaluation, confidence, human disposition and rollback before production use.

---


---

*Source: documentation/Chicken_Coop_Management_System_Complete_Module_Operations_Blueprint.md (lines 2451-2564)*
