import { describe, expect, it } from "vitest";
import {
  getDashboardPageContext,
  getDashboardSidebarGroups,
  getUserInitials,
} from "../../components/dashboard-shell-model";

describe("dashboard shell model", () => {
  it("marks overview as the active sidebar group", () => {
    const groups = getDashboardSidebarGroups({
      organizationSlug: "ayam-norliza-pilot",
      pathname: "/ayam-norliza-pilot/overview",
    });

    expect(groups[0]).toMatchObject({
      title: "Overview",
      isActive: true,
      items: [
        expect.objectContaining({
          title: "Overview",
          href: "/ayam-norliza-pilot/overview",
          isActive: true,
        }),
      ],
    });
    expect(groups[1]).toMatchObject({
      title: "Alerts",
      isActive: false,
    });
    expect(groups[2]).toMatchObject({
      title: "Access control",
      isActive: false,
    });
  });

  it("marks alerts as the active sidebar group", () => {
    const groups = getDashboardSidebarGroups({
      organizationSlug: "ayam-norliza-pilot",
      pathname: "/ayam-norliza-pilot/alerts",
    });

    expect(groups[0]).toMatchObject({ title: "Overview", isActive: false });
    expect(groups[1]).toMatchObject({ title: "Alerts", isActive: true });
    expect(groups[2]).toMatchObject({ title: "Access control", isActive: false });
  });

  it("returns page context for nested access control routes", () => {
    expect(
      getDashboardPageContext({
        organizationSlug: "ayam-norliza-pilot",
        pathname: "/ayam-norliza-pilot/settings/support-sessions/active",
      }),
    ).toEqual({
      section: "Access control",
      title: "Support sessions",
    });
  });

  it("returns overview as default page context for unknown routes", () => {
    expect(
      getDashboardPageContext({
        organizationSlug: "ayam-norliza-pilot",
        pathname: "/ayam-norliza-pilot/unknown",
      }),
    ).toEqual({
      section: "Overview",
      title: "Overview",
    });
  });

  it("formats fallback user initials from display name or email", () => {
    expect(getUserInitials("Ayam Norliza", "owner@example.com")).toBe("AN");
    expect(getUserInitials("", "owner@example.com")).toBe("O");
  });
});
