# 19 - MOD-24: Administration, configuration and data governance

Source: `documentation/Chicken_Coop_Management_System_Complete_Module_Operations_Blueprint.md` (lines 2669-2754)

# 24. MOD-19 - Administration, configuration and data governance

## 24.1 Purpose

Provide controlled administration of forms, target profiles, rules, notification policies, master data, retention, corrections and operational configuration without requiring code deployment for ordinary farm changes.

## 24.2 Primary users

Delegated administrators, data stewards, farm managers, veterinarian, quality/biosecurity, maintenance change board, IT/security and auditors.

## 24.3 Capabilities

- Configure production profiles, terminology, units, languages, time zones and operating-day boundaries.
- Configure inspection forms, task templates, schedules, target curves, alert rules, health/medicine catalogs, sanitation plans and report templates.
- Support draft, review, approval, effective date, superseded and retired states.
- Compare configuration versions and show affected sites/houses/flocks.
- Promote approved configuration from development/test to staging/production where appropriate.
- Require separation of duties for high-impact configurations such as medicine rules, withdrawal, control recipes and emergency alerts.
- Manage data retention, legal holds, correction policy, period close and export rights.
- Manage data-quality rules, reconciliation tolerances and exception ownership.
- Maintain audit log search and privileged activity review.
- Provide safe import/export of configuration with schema version and validation.

## 24.4 Configuration risk classes

| Class | Examples | Required control |
|---|---|---|
| Low | Label, display order, non-critical report preference. | Delegated admin and audit. |
| Medium | Routine checklist, task schedule, stock threshold. | Review/approval and effective date. |
| High | Health catalog, withdrawal rule, biosecurity restriction, critical alarm profile. | Qualified owner, independent approval, test case and change notice. |
| Safety-critical | Controller recipe, remote-command bounds, emergency alarm routing. | Formal change board, hazard review, staged test, rollback and drill. |

## 24.5 Versioned configuration lifecycle

```text
draft -> validation -> review -> approved -> scheduled/effective -> superseded -> archived
                \-> rejected / revised
```

An approved version is immutable. An emergency change still creates a new version, records the emergency authority and triggers post-change review.

## 24.6 Key entities

| Entity/table | Important fields |
|---|---|
| `configuration_items` | Type, key, owner, risk class and scope. |
| `configuration_versions` | Schema version, payload/reference, effective dates, status, approvers and hash. |
| `configuration_deployments` | Version, target environment/site, deployed by/time, result and rollback reference. |
| `approval_requests` | Target, risk class, required approvers, decisions and evidence. |
| `data_quality_rules` | Dataset/field, rule, severity, owner and effective date. |
| `reconciliation_rules` | Domain, tolerance, action and approval. |
| `retention_policies` | Record class, trigger, duration, hold handling and disposal. |
| `audit_log` | Actor, action, object, scope, before/after or diff, time, source and correlation ID. |
| `data_change_requests` | Record, proposed correction, reason, requester, reviewer and outcome. |

## 24.7 Business rules

- Configuration is relational where it must be queried, constrained or authorized; large unvalidated JSON is avoided for core state.
- Every high-impact version has owner, source, test evidence, approval and effective date.
- Active flocks keep assigned configuration versions unless a deliberate approved migration is applied.
- All configuration changes are audited; safety-critical changes additionally capture rollback and verification.
- Ordinary users cannot access raw audit payloads containing sensitive data outside their scope.
- A correction to a locked record creates a new version/event and does not change the original audit history.

## 24.8 UI and routes

- `/settings/configuration`
- `/settings/forms`
- `/settings/targets`
- `/settings/rules`
- `/settings/schedules`
- `/settings/notifications`
- `/settings/data-quality`
- `/settings/retention`
- `/settings/audit-log`
- `/settings/change-requests`

## 24.9 Module acceptance gate

- A qualified administrator can create, approve and schedule a rule/profile version without code changes.
- Historical records retain the version in force at event time.
- High/safety-critical changes cannot be self-approved where separation of duties is configured.
- Version comparison, deployment result and rollback are auditable.

---


---

*Source: documentation/Chicken_Coop_Management_System_Complete_Module_Operations_Blueprint.md (lines 2669-2754)*
