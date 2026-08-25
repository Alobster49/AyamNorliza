/**
 * Pure merge of membership rows with identity lookups (display name from
 * profiles, email from auth.users via the admin API). Kept dependency-free
 * so it is unit-testable and usable from server components.
 */

import type { OrganizationMember } from "./types";

export type MemberIdentity = {
  displayName: string | null;
  email: string | null;
};

export type MemberDirectoryRow = OrganizationMember & MemberIdentity;

export function mergeMemberDirectory(
  members: OrganizationMember[],
  displayNames: Map<string, string | null>,
  emails: Map<string, string | null>,
): MemberDirectoryRow[] {
  return members.map((m) => ({
    ...m,
    displayName: displayNames.get(m.userId) ?? null,
    email: emails.get(m.userId) ?? null,
  }));
}
