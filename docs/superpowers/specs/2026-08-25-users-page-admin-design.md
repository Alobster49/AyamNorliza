# Users Page Admin Overhaul — Design

Date: 2026-08-25
Status: Approved

## Problem

The access-control Users page (`/[locale]/(dashboard)/[organizationSlug]/settings/users`)
renders raw `user_id` UUIDs in the Members table because `listMembers()`
(`src/features/identity-access/server/queries.ts:69`) selects only membership
columns and never joins `profiles` or resolves the auth email. Admins cannot
identify who a row is, cannot edit a member's details, cannot trigger a
password reset, and cannot remove a member from the organization. The only
account-creation path is the email invitation flow.

## Goals

1. Members table shows real **display name + email** instead of UUIDs.
2. Admin can **edit a member's name and email**.
3. Admin can **send a password reset email** to a member.
4. Admin can **remove a member from the organization** (membership delete;
   the auth account survives — it may belong to other organizations).
5. Admin can **directly create an account** (name, email, role) in addition
   to the existing invite flow.
6. Existing role-change, deactivate, and invite flows are unchanged.

## Non-goals

- Viewing or setting a member's password. Passwords are never visible to
  anyone (bcrypt hashes only). Password handling is reset-link only.
- Full account deletion (auth user + profile). Out of scope; removal is
  org-membership only to preserve audit and order-history references.
- Editing locale, time zone, or contact preferences from this page.

## Approach (chosen: server-side merge)

Emails live in `auth.users`, which normal queries cannot read. Chosen
approach: the page is already a server component — merge on the server.

- `listMembers()` extended to join `profiles` for `display_name`.
- A server-only helper batch-fetches emails via the service-role
  `auth.admin` client (`getUserById` / `listUsers` keyed by the member
  `user_id`s) and merges them into the rows before render.
- No new migration, no denormalized email copy. Same admin-API pattern
  `actions.ts` already uses (e.g. `adminCreateInvitation`).

Rejected alternatives:
- SECURITY DEFINER SQL function joining `auth.users` — cleaner runtime but
  adds a migration + grant to an already pending prod-deploy backlog.
- Denormalizing email into `profiles` — permanent sync-bug surface.

## Data flow

```
page.tsx (server)
  listMembers(org)            -- membership + profiles.display_name
  fetchMemberEmails(userIds)  -- service-role auth.admin, server-only
  merge -> MemberRow { ..., displayName, email }
  render <UsersPageClient members={rows} ... />
```

The UUID is no longer a table column; it stays available in a row
tooltip/detail for support use.

## UI (`src/features/identity-access/components/users-page-client.tsx`)

- **User column**: display name (bold) with email underneath (muted).
- **Per-row actions**: existing role dropdown + Deactivate, plus an
  overflow menu with:
  - **Edit details** → dialog with name + email fields.
  - **Reset password** → ConfirmDialog ("Send a password reset email to X?").
  - **Remove from organization** → ConfirmDialog, destructive styling.
- **Header**: existing **Invite user** button, plus a new **Create user**
  button → dialog with name, email, role. Creates the account immediately
  and sends a set-password email; no invitation-accept step.

## Server actions (`src/features/identity-access/server/actions.ts`)

All follow the existing action pattern: zod validation → permission check →
reauth where peer actions require it → mutation → audit log → notification
dispatch where applicable.

| Action | What it does | Reauth |
|---|---|---|
| `updateMemberProfileAction` | Name via `profiles` update; email via `auth.admin.updateUserById`. | Yes |
| `sendPasswordResetAction` | Sends reset email (`resetPasswordForEmail` or admin generate-link). | No |
| `removeMemberAction` | Deletes the `organization_members` row and revokes the member's sessions. Guards: cannot remove self; cannot remove the last owner (same guard style as deactivate — verify exact mechanism during planning). | Yes |
| `createUserAction` | `auth.admin.createUser` (`email_confirm: true`), insert `profiles` row + `organization_members` row with the chosen role, send set-password email. | Yes |

## Error handling

- Duplicate email on create or edit → inline field error in the dialog.
- Admin API failures → toast with the error message.
- Partial create (auth user created, profile/membership insert fails) →
  rollback by deleting the created auth user, surface error.

## i18n

All new strings added to `src/messages/en.json` and `src/messages/ms.json`
per repo convention.

## Testing

- Unit tests for the new actions, focused on guards: self-removal blocked,
  last-owner removal blocked, duplicate email rejected, create rollback.
- E2E happy path: create user from the Create user dialog; edit a member's
  display name and see it in the table.
