/**
 * Unit tests for the landing-path resolvers. These lock the contract the
 * bare `/{organizationSlug}` route depends on: no resolver may ever return
 * `/{slug}` itself, or that route would redirect to itself forever.
 *
 * `resolvePermissionsForOrg` is mocked directly (no database required) —
 * landing.ts now resolves the member's grant set and runs it through the
 * same canonical nav order as the sidebar (`getDashboardSidebarGroups`)
 * rather than switching on a stored role string.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ROLE_GRANTS, type PermissionKey, type SystemRoleKey } from "@/lib/auth/rbac";

vi.mock("@/lib/auth/require-permission", () => ({
  resolvePermissionsForOrg: vi.fn(),
}));

vi.mock("../../server/queries", () => ({
  listOrganizationsForCurrentUser: vi.fn(),
}));

import { resolvePermissionsForOrg } from "@/lib/auth/require-permission";
import { listOrganizationsForCurrentUser } from "../../server/queries";
import {
  NO_ORGANIZATION_PATH,
  resolveLandingPath,
  resolveLandingPathForSlug,
} from "../../server/landing";

const ORG = { id: "org-1", slug: "ayam-norliza-pilot" };

function mockGrants(grants: ReadonlySet<PermissionKey> | null) {
  vi.mocked(resolvePermissionsForOrg).mockResolvedValue({
    context: grants
      ? {
          orgId: ORG.id,
          userId: "user-1",
          roleId: "role-1",
          roleKey: "custom",
          timeZone: "Asia/Kuala_Lumpur",
        }
      : null,
    grants: grants ?? new Set(),
  });
}

function mockRole(role: SystemRoleKey) {
  mockGrants(DEFAULT_ROLE_GRANTS[role]);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolveLandingPathForSlug", () => {
  it.each(["owner", "org_admin"] as const)(
    "sends %s to the dashboard",
    async (role) => {
      mockRole(role);
      await expect(resolveLandingPathForSlug(ORG.id, ORG.slug)).resolves.toBe(
        "/ayam-norliza-pilot/dashboard",
      );
    },
  );

  it("sends sellers to the org catalog", async () => {
    mockRole("seller");
    await expect(resolveLandingPathForSlug(ORG.id, ORG.slug)).resolves.toBe(
      "/ayam-norliza-pilot/products",
    );
  });

  it("sends supervisors to the org catalog too", async () => {
    mockRole("supervisor");
    await expect(resolveLandingPathForSlug(ORG.id, ORG.slug)).resolves.toBe(
      "/ayam-norliza-pilot/products",
    );
  });

  it("sends warehouse workers to the warehouse queue", async () => {
    mockRole("inventory");
    await expect(resolveLandingPathForSlug(ORG.id, ORG.slug)).resolves.toBe(
      "/ayam-norliza-pilot/tasks",
    );
  });

  it("sends hr to the first HR nav item (My Leave)", async () => {
    // The default hr grant set includes both `leave` and `leave_management`
    // crud, but My Leave sorts first in the canonical nav order, so that is
    // where a permission-driven landing sends them — Leave Management is
    // still one click away in the HR group.
    mockRole("hr");
    await expect(resolveLandingPathForSlug(ORG.id, ORG.slug)).resolves.toBe(
      "/ayam-norliza-pilot/leave",
    );
  });

  it("sends drivers to the driver deck", async () => {
    mockRole("driver");
    await expect(resolveLandingPathForSlug(ORG.id, ORG.slug)).resolves.toBe(
      "/drive/ayam-norliza-pilot",
    );
  });

  it("sends a grant-less custom role to a page every member can open", async () => {
    mockGrants(new Set<PermissionKey>());
    await expect(resolveLandingPathForSlug(ORG.id, ORG.slug)).resolves.toBe(
      "/ayam-norliza-pilot/settings/organization",
    );
  });

  it("returns null when the caller is not an active member", async () => {
    mockGrants(null);
    await expect(resolveLandingPathForSlug(ORG.id, ORG.slug)).resolves.toBeNull();
  });

  it("never returns the bare org path, which would loop", async () => {
    const roles: SystemRoleKey[] = [
      "owner",
      "org_admin",
      "seller",
      "supervisor",
      "inventory",
      "hr",
      "driver",
    ];
    for (const role of roles) {
      mockRole(role);
      const path = await resolveLandingPathForSlug(ORG.id, ORG.slug);
      expect(path).not.toBe(`/${ORG.slug}`);
    }
    mockGrants(new Set<PermissionKey>());
    const path = await resolveLandingPathForSlug(ORG.id, ORG.slug);
    expect(path).not.toBe(`/${ORG.slug}`);
  });
});

describe("resolveLandingPath", () => {
  it("falls back to signup when the user belongs to no organization", async () => {
    vi.mocked(listOrganizationsForCurrentUser).mockResolvedValue([]);
    await expect(resolveLandingPath()).resolves.toBe(NO_ORGANIZATION_PATH);
  });

  it("resolves the first organization by grants", async () => {
    mockRole("owner");
    vi.mocked(listOrganizationsForCurrentUser).mockResolvedValue([ORG as never]);
    await expect(resolveLandingPath()).resolves.toBe(
      "/ayam-norliza-pilot/dashboard",
    );
  });

  it("keeps a membership-less but visible org on settings, not the bare path", async () => {
    mockGrants(null);
    vi.mocked(listOrganizationsForCurrentUser).mockResolvedValue([ORG as never]);
    await expect(resolveLandingPath()).resolves.toBe(
      "/ayam-norliza-pilot/settings/organization",
    );
  });
});
