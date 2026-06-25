# Shared - Platform, NFR, Testing, Migrations, CI/CD (Sections 30-34)

Source: `documentation/Chicken_Coop_Management_System_Complete_Module_Operations_Blueprint.md` (lines 3405-3768)

# 30. Storage, Realtime and background-work architecture

## 30.1 Storage controls

- Use private buckets for documents, reports, media, certificates and integration files.
- Use stable ownership paths beginning with `organization_id` and usually `site_id`.
- Store file metadata/status in PostgreSQL when files have ownership, processing state, labels, retention or business relationships.
- Upload large files directly from browser to Storage through a controlled path.
- Generate short-lived signed URLs only after access validation.
- Test Storage policy isolation for anonymous, member, site-scoped, cross-tenant and admin-job identities.
- Perform malware/content validation where risk requires it.

## 30.2 Realtime use cases

Use Realtime only when immediacy materially improves the workflow:

- Active alerts and acknowledgement state.
- Selected current house/device state.
- Job/export/import progress.
- On-call presence or narrow incident collaboration if implemented.

Rules:

- Subscribe to the narrowest table, row or private channel.
- Authorize private Broadcast/Presence channels.
- Unsubscribe on component cleanup and tenant/record change.
- Treat an event as a hint; reconnecting clients perform a normal read.
- Maintain idempotent client updates.
- Do not subscribe ordinary dashboards to raw high-frequency telemetry.

## 30.3 Background job catalog

| Job | Typical frequency/trigger | Recommended execution |
|---|---|---|
| Alert escalation and notification retry | Seconds/minutes | Database schedule + Edge Function/worker, depending provider. |
| Generate recurring tasks/PM | Hourly/daily/event | PostgreSQL function/scheduled job. |
| Withdrawal hold calculation/release review | Treatment event/daily | Transactional DB function + due-review job. |
| Inventory low stock/expiry | Daily/event | Database job. |
| Telemetry aggregation/retention | Minute/hour/day | Database function/worker; partition-aware. |
| Report generation/delivery | Scheduled/on demand | Background job; private Storage output. |
| Import/export processing | On request | Route/Edge accepts, worker processes. |
| Webhook retry/DLQ | Backoff schedule | Worker/Edge Function. |
| Data-quality/reconciliation checks | Daily/period close | Database functions and task creation. |
| Retention/disposal | Scheduled | Reviewed job honoring holds. |
| Model scoring | Scheduled/event, later phase | External worker when workload requires. |

## 30.4 Execution-tool selection

| Tool | Best fit |
|---|---|
| Next.js Server Action | Mutation initiated by the web interface. |
| Next.js Route Handler | Callback, webhook, download or API belonging to the web app. |
| Supabase Edge Function | Independent endpoint, device ingress or multiple client types. |
| PostgreSQL function | Atomic, data-intensive or reconciliation logic near the data. |
| External worker/queue | Long-running, CPU-heavy, retry-heavy or high-volume work. |

## 30.5 Webhook requirements

- Verify provider signature before business processing.
- Store provider event ID under a unique constraint.
- Return success only after durable acceptance.
- Keep retries safe and idempotent.
- Support out-of-order events where the provider permits them.
- Redact secrets and sensitive payload fields from logs/support UI.
- Monitor backlog, repeated failure and provider latency.

---

# 31. Non-functional requirements and service levels

The values below are a production baseline to confirm during discovery and load testing.

| Quality | Baseline requirement | Priority |
|---|---|---|
| Cloud availability | 99.9% monthly excluding approved maintenance. Local farm controls/critical alarms remain independent. | Must |
| Web performance | Common signed-in views return usable content within 2 seconds on normal connectivity at agreed load. | Must |
| Local save | Offline/local form save confirms within 2 seconds on supported devices. | Must |
| Telemetry latency | Normal sensor-to-dashboard within 15 seconds under normal connectivity. | Must |
| Critical notification | Verified critical cloud event to first provider submission within 60 seconds, subject to network/channel. Local alarm is faster and independent. | Must |
| Offline | PWA supports at least seven days of assigned forms/tasks/SOPs; edge buffers at least 30 days at configured rate. | Must |
| Scalability | Load test to agreed tier; reference enterprise target may be up to 100 sites, 2,000 houses and 100,000 devices at 10-second sampling. | Should |
| Recovery | Cloud RPO <= 15 minutes and RTO <= 4 hours as a baseline; edge store-and-forward/local operation maintained. | Must |
| Security | MFA, least privilege, RLS, encryption, audit, secure device identity, vulnerability management and tested response. | Must |
| Data integrity | Transactions, idempotency, constraints, visible corrections and append-only audit. | Must |
| Usability | Daily round with minimal typing, clear exception handling and simple/advanced modes. | Must |
| Accessibility | WCAG 2.2 AA or applicable standard; keyboard, contrast, text scaling and non-color status. | Should |
| Localization | Language, time zone, units, currency and terminology. | Should |
| Maintainability | Feature modules, automated tests, migrations, generated types, observability and runbooks. | Must |
| Portability | Complete data/document export in documented formats and no essential vendor lock-in. | Must |
| Supportability | Safe remote diagnostics, severity process, connector/device health and escalation runbooks. | Must |

## 31.1 Service severity

| Severity | Example | Support acknowledgement target | Restoration/workaround target |
|---|---|---|---|
| P1 | Life-support monitoring/control risk, widespread outage, integrity or security incident. | 15 minutes for contracted 24x7 support. | Continuous effort; safe workaround as soon as possible. |
| P2 | Major workflow unavailable, multiple houses affected or significant integration failure. | 1 hour during support coverage. | 4 hours or agreed workaround. |
| P3 | Single module/house issue with workaround or report defect. | 1 business day. | Planned by impact. |
| P4 | Question, cosmetic issue or enhancement. | 2 business days. | Backlog/release planning. |

Farm operational alarm response is a farm responsibility and should be faster than software support acknowledgement.

## 31.2 Performance and capacity tests

- Concurrent dashboard and mobile users by site/shift.
- Largest expected flock/house history.
- Telemetry ingest rate, aggregation and retention.
- RLS policy query performance under realistic tenant/site membership.
- Trace/recall query across defined history.
- Report/export size and generation time.
- Offline sync batch size after prolonged outage.
- Notification burst and provider retry.
- Storage upload/download and signed URL behavior.

---

# 32. Testing, validation and acceptance strategy

## 32.1 Testing stack

| Tool/type | Coverage |
|---|---|
| Vitest | Business rules, calculations, schemas, utilities and server helpers. |
| React Testing Library | Component behavior, field errors and accessible interaction. |
| Playwright | Authentication, tenant isolation, critical workflows, offline/browser regressions and permissions. |
| pgTAP / SQL tests | RLS policies, constraints, functions, state transitions and database behavior. |
| Webhook/device fixtures | Signature, idempotency, retries, duplicates, out-of-order and malformed payloads. |
| Hardware-in-the-loop | Sensors, gateway, power loss, controller status, local alarm and replay. |
| Performance/soak | Telemetry, dashboards, RLS, queues, reports and long-running operation. |
| Security testing | Threat model, SAST/dependency scan, penetration test, secrets, device/firmware and restore exercise. |
| Domain acceptance | Farm staff, veterinarian, quality and maintenance execute realistic scenarios. |

## 32.2 Minimum identity/security matrix

| Identity | Expected access |
|---|---|
| Anonymous | Only explicitly public assets/pages. No farm data. |
| Authenticated owner/admin | Authorized organization data and privileged actions. |
| Farm manager | Assigned site data and manager actions. |
| Site/house-scoped worker | Only assigned scope and worker actions. |
| Veterinarian | Assigned health scope and qualified actions. |
| Auditor | Explicit read-only scope and limited time. |
| Cross-tenant user | No select, insert, update, delete, subscribe or Storage access. |
| Admin job | Only the narrow reviewed operation using secret client. |

## 32.3 Critical end-to-end acceptance scenarios

1. **Flock lifecycle:** plan, readiness, place, operate, move/harvest, close and preserve complete history.
2. **Offline daily round:** complete without internet, attach media, create linked workflows and sync without duplication.
3. **Critical environment event:** simulate abnormal condition plus cloud loss; local alarm works, cloud escalation works when connected and event is verified closed.
4. **Sensor failure:** stale/disagreement is flagged, manual/alternate value used and calibration task created.
5. **Treatment and withdrawal:** authorized order, product lot and administration recorded; restricted shipment is blocked until authorized release.
6. **Traceability:** shipment to flock/house/input/health/sanitation/destination within target time.
7. **Biosecurity:** visitor risk, zone access, entry/exit, PPE/disinfection and incident evidence.
8. **Inventory:** receive, quarantine/release, FEFO issue, count variance and expiry/disposal.
9. **Maintenance:** fault from alert, urgent work order, parts issue, repair and verification.
10. **Security:** URL tampering, direct Data API, Storage path and Realtime cross-tenant attempts fail.
11. **Recovery:** restore database and replay edge/offline queues without loss or duplicate transactions.
12. **Configuration:** publish a new target/rule version and prove historical records keep the prior version.

## 32.4 Domain-specific validation

- Poultry veterinarian approves health, medication, withdrawal and outbreak workflows.
- Farm operations approves daily rounds, timing and task burden.
- Biosecurity/quality approves visitor, sanitation, traceability and audit evidence.
- Maintenance approves critical asset, fail-safe, calibration and control-command behavior.
- Data/finance approves KPI formula, reconciliation and costing definitions.
- IT/security approves RLS, network/device security, logs, backup and incident response.

## 32.5 Go-live gates

- Named owners, support contacts and escalation matrix.
- Approved SOPs, target profiles, forms, rules and permissions.
- Training/competencies complete.
- Data migration reconciled and signed off.
- RLS/Storage/cross-tenant tests pass.
- Critical E2E and offline tests pass in staging.
- Local alarm/controller independence tested.
- Monitoring, backup, restore, rollback and incident runbooks proven.
- No open critical defect and accepted workaround for any remaining high defect.
- Pilot parallel-run criteria met and formal operational acceptance signed.

---

# 33. Database migrations, local development and schema contract

## 33.1 Environment strategy

| Environment | Supabase project | Purpose |
|---|---|---|
| Local | Supabase CLI stack | Fast iteration, seed data, migration reset and RLS tests. |
| Development/staging | Dedicated non-production project | Integration, preview acceptance, migrations, webhooks and E2E. |
| Production | Dedicated production project | Real users/data, restricted access, backup and monitored change. |

Never point preview deployments at the production database. Use separate provider credentials and webhook endpoints for staging and production.

## 33.2 Local workflow

```bash
npx supabase start
npx supabase migration new create_core_structure
npx supabase db reset
npx supabase gen types typescript --local > src/types/database.generated.ts
```

Process:

1. Create/modify reviewed migration instead of manually changing production.
2. Reset local database from empty to prove reproducibility.
3. Load deterministic seed fixtures.
4. Run database, RLS and function tests.
5. Regenerate TypeScript database types.
6. Type-check and build application.
7. Apply same migration to staging and run smoke/E2E tests.
8. Approve and promote same migration to production.

## 33.3 Schema contract

A pull request changing database schema is incomplete unless it also addresses:

- Migration.
- RLS policies and indexes.
- Constraints/functions/triggers.
- Generated TypeScript types.
- Seed/test fixtures.
- SQL/RLS tests.
- Affected Server Actions/queries.
- Data migration/backfill and rollback/forward-fix plan.
- Monitoring and operational impact.
- Documentation/data dictionary.

## 33.4 Migration safety

- Prefer backward-compatible expand/migrate/contract changes.
- Avoid long table locks during operating hours.
- Backfill in bounded batches with progress and retry.
- Add `NOT NULL`/constraints after data is valid where needed.
- Test RLS and query plans against realistic volumes.
- Production migration requires approval and an incident/rollback contact.
- Never edit a migration already applied to shared environments; add a new migration.

---

# 34. CI/CD, deployment, observability and operations

## 34.1 CI gates

- Install from lockfile.
- Type-check TypeScript.
- Lint source.
- Run unit/component tests.
- Start/reset local Supabase.
- Run migration and seed from empty state.
- Run pgTAP/SQL/RLS tests.
- Verify generated database types are current.
- Build Next.js production bundle.
- Run critical Playwright flows.
- Scan dependencies/secrets and relevant containers/functions.
- Apply migration to staging.
- Run post-deploy smoke and tenant-isolation tests.
- Require approval for production migration/deployment.

## 34.2 Production build order

1. Initialize local Supabase and commit configuration.
2. Configure browser/server/admin clients and auth refresh proxy.
3. Build tenancy/membership schema, enable RLS and write policy tests.
4. Generate types.
5. Build protected dashboard shell and one complete vertical module slice.
6. Add offline sync for daily operations.
7. Add Storage and only the required Realtime use cases.
8. Add device ingestion/read-only IoT pilot.
9. Create staging integrations and validate cross-tenant isolation.
10. Add production secrets, monitoring, backup and migration approval.

## 34.3 Observability

### Application

- Structured server/client errors with correlation ID.
- Route/Server Action latency and error rates.
- Authentication failures and session anomalies.
- Offline sync success/conflict/rejection.
- Export/import/job duration and backlog.

### Database

- Connection usage.
- Slow and policy-heavy queries.
- Lock/deadlock/migration errors.
- Table/index growth, partition and retention health.
- RLS policy performance.

### Storage/Realtime

- Bucket usage, failed uploads and signed-download errors.
- Active subscriptions, channel errors and unexpected broad subscriptions.

### Integration/device

- Webhook verification/failure/retry.
- Connector reconciliation/backlog/DLQ.
- Gateway/device last seen, buffer depth, firmware and clock drift.
- Telemetry ingest latency, rejection and duplicate rate.

### Audit

- Privileged role/configuration changes.
- Treatment/withdrawal/ship release actions.
- Bulk export and support access.
- Controller commands and recipe changes.

Logs must scrub tokens, cookies, keys and unnecessary personal data.

## 34.4 Backup and disaster recovery

- Enable appropriate Supabase backups/PITR for production tier.
- Document RPO/RTO and restore authority.
- Test restore to an isolated environment on a defined schedule.
- Verify files/Storage recovery strategy and export inventory.
- Preserve edge/offline queues and replay idempotently after recovery.
- Maintain configuration, migrations and infrastructure settings in version control.
- Keep emergency farm procedures independent of cloud recovery.
- Record every restore drill, result, gap and corrective action.

## 34.5 Incident response

Runbooks should cover:

- Authentication/credential compromise.
- Cross-tenant or unauthorized access.
- Data corruption/migration failure.
- Ransomware or malicious file.
- Device/gateway compromise or unexpected control change.
- Cloud/application outage.
- Notification provider failure.
- Telemetry backlog or false-alert storm.
- Backup/restore failure.

Each runbook defines detection, owner, containment, communication, evidence, recovery, validation and lessons learned.

## 34.6 Production-readiness checklist

- [ ] RLS enabled on every exposed table.
- [ ] Separate policies exist for required operations.
- [ ] RLS/membership columns are indexed.
- [ ] Server Actions validate all input.
- [ ] Protected actions/endpoints verify identity.
- [ ] Secret/admin key is server-only.
- [ ] Preview deployments never use production data.
- [ ] Private Storage policies and signed URL expiry are tested.
- [ ] Realtime subscriptions are narrow and private where required.
- [ ] Webhook signatures and idempotency are tested.
- [ ] Migrations reproduce from empty state.
- [ ] Generated database types are committed/current.
- [ ] Cross-tenant and site-scope tests pass.
- [ ] Critical E2E/offline workflows pass in staging.
- [ ] Errors are monitored without leaking secrets.
- [ ] Backup/restore and incident procedures are documented/tested.
- [ ] Administrative and control operations are audited.
- [ ] Local life-support and alarm independence is proven.
- [ ] Any service extraction is justified by measured need.

---

---

*Source: documentation/Chicken_Coop_Management_System_Complete_Module_Operations_Blueprint.md (lines 3405-3768)*
