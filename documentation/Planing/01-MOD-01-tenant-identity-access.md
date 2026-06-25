# 01 - MOD-6: Tenant, identity and access management

Source: `documentation/Chicken_Coop_Management_System_Complete_Module_Operations_Blueprint.md` (lines 485-608)

# 6. MOD-01 - Tenant, identity and access management

## 6.1 Purpose

Provide secure multi-tenant identity, membership, role and scope management for a single farm or many independent organizations. This module is the foundation for every other module and must enforce least privilege in both application code and PostgreSQL RLS.

## 6.2 Primary users

Organization owner, system administrator, farm manager, security administrator, auditor and approved support personnel.

## 6.3 Capabilities

- Create and maintain organizations/tenants, organization settings and tenant status.
- Invite users and assign one or more roles with organization, site, zone and house scope.
- Support named user accounts, MFA, passwordless/email/OAuth where approved, and optional enterprise OIDC/SAML SSO.
- Support temporary contractors, auditors and vendor support with explicit sponsor, start/end time and limited scope.
- Deactivate users immediately and revoke active sessions where needed.
- Perform recurring access reviews and record reviewer, decision and evidence.
- Require stronger re-authentication for treatment approval, control commands, sensitive export and privileged administration.
- Maintain emergency/break-glass access with strict expiry, reason, notification and post-use review.
- Separate normal user operations from narrow server-only administrative jobs using the Supabase secret/admin client.

## 6.4 Recommended roles and permission domains

| Role | Typical scope | Examples of allowed actions |
|---|---|---|
| `owner` | Entire organization | Manage owners/admins, portfolio reports, policy approval, export and billing/contract settings. |
| `org_admin` | Entire organization | Users, sites, configuration, integrations and audit, excluding owner-only actions. |
| `farm_manager` | Assigned sites | Approve flocks, close periods, manage work, respond to incidents and export site reports. |
| `supervisor` | Assigned houses/sites | Review rounds, assign tasks, acknowledge alerts and approve ordinary corrections. |
| `caretaker` | Assigned houses | Perform rounds, observations, production entries, mortality and first-response tasks. |
| `veterinarian` | Assigned organization/sites | Health cases, diagnosis, treatment authorization, withdrawal and outbreak decisions. |
| `biosecurity_qa` | Assigned sites | Biosecurity, sanitation, audit, corrective action, release approval and assurance reports. |
| `maintenance` | Assigned sites/assets | Assets, work orders, calibration, critical tests and bounded control execution. |
| `inventory` | Assigned sites/stores | Receive, quarantine/release, issue, count and procure inventory. |
| `logistics` | Assigned sites | Harvest/collection plans, shipments, transfers and customer receipts. |
| `auditor` | Explicit read-only scope | Time-limited evidence, selected reports and trace packs. |
| `support` | Explicit time-limited scope | Diagnostics only; no farm data access unless sponsored and logged. |

Permissions should be capability-based, such as `flock.create`, `daily_round.submit`, `treatment.authorize`, `shipment.release`, `control_command.approve` and `audit.export`. A role is a managed collection of permissions; scope determines where the permission applies.

## 6.5 Core workflows

### User invitation and activation

1. Authorized administrator enters email/identity, role, site/house scope and expiry if temporary.
2. System validates that the inviter may assign that role and scope.
3. Invitation is issued with one-time token and expiration.
4. User completes authentication and required MFA/induction.
5. Membership becomes active and an immutable audit event is written.

### Role or scope change

1. Administrator submits requested change and reason.
2. High-risk changes may require a second approver.
3. Database updates membership/scope in one transaction.
4. Existing sessions are refreshed or revoked based on risk.
5. Change is written to the audit log with before/after values.

### Deactivation

1. User is marked inactive with effective time and reason.
2. Sessions and refresh tokens are revoked where supported.
3. Assigned open work is transferred or placed in an exception queue.
4. Ownership of documents, tasks and records remains attributable to the original user.

## 6.6 Key entities

| Entity/table | Important fields |
|---|---|
| `profiles` | `user_id`, display name, locale, time zone, status, contact preferences. |
| `organizations` | Name, slug, legal name, status, region, default units/time zone. |
| `organization_members` | `organization_id`, `user_id`, role, status, joined/expired timestamps. |
| `member_scopes` | Membership, site/zone/house scope, permission override and effective dates. |
| `invitations` | Email/identity, role, scope, token hash, inviter, expiry, accepted time. |
| `access_reviews` | Review period, reviewer, membership decision, evidence and completion. |
| `support_sessions` | Sponsor, technician, purpose, permitted scope, start/end, actions and recording reference. |
| `auth_security_events` | Sign-in, MFA, reset, lockout, revocation and suspicious event metadata. |

## 6.7 Business and security rules

- No shared accounts for accountable actions.
- At least one active owner must remain for an active organization.
- A user may never grant a role or scope broader than their own delegated authority.
- Temporary access expires automatically and cannot silently become permanent.
- Privileged role changes, data exports, treatment authorization and control commands are audited.
- Browser code uses only the Supabase publishable key. `SUPABASE_SECRET_KEY` remains server-only and must never appear in logs or client bundles.
- Middleware/proxy redirects improve navigation but do not replace identity verification in each protected Server Action or Route Handler.
- Every tenant-owned table is protected by RLS, even when normal application code already checks permissions.

## 6.8 UI and routes

- `/settings/organization`
- `/settings/users`
- `/settings/roles`
- `/settings/access-reviews`
- `/settings/support-sessions`
- `/profile/security`
- `/auth/mfa`

Server Components render membership and review lists. Server Actions handle invitations, role/scope changes and deactivation. Client Components are limited to interactive dialogs, tables and MFA browser flows.

## 6.9 Events and notifications

- `identity.user_invited`
- `identity.membership_activated`
- `identity.role_changed`
- `identity.scope_changed`
- `identity.user_deactivated`
- `identity.temporary_access_expiring`
- `identity.break_glass_used`

Notify the organization owner or security contact of privileged changes, break-glass use and suspicious authentication activity.

## 6.10 Module acceptance gate

- Cross-tenant users cannot select, insert, update, delete, subscribe to or download another tenant's data.
- A site-scoped worker cannot access an unassigned site by URL manipulation, direct Data API call or Storage path.
- Privileged actions require the configured role, scope and re-authentication.
- Deactivation prevents new authenticated operations and preserves attribution of historical records.
- All role/scope changes appear in the immutable audit log.

---


---

*Source: documentation/Chicken_Coop_Management_System_Complete_Module_Operations_Blueprint.md (lines 485-608)*
