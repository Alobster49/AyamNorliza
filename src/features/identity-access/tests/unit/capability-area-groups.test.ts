/**
 * Guards the client-side `CAPABILITY_AREA_GROUPS` list against drifting from
 * the server-side `CAPABILITY_AREAS` source of truth. A missing id here means
 * every capability in that area silently disappears from the Roles &
 * Permissions settings UI (regression: catalog/sales were absent, hiding
 * catalog.manage, orders.manage, and customers.manage from owners).
 */

import { describe, expect, it, vi } from "vitest";

// The client component drags in next-intl's client navigation, which does not
// resolve under vitest's node environment. Only the exported constant matters
// here, so stub the runtime-only modules.
vi.mock("next-intl", () => ({ useTranslations: vi.fn(), useFormatter: vi.fn() }));
vi.mock("@/i18n/navigation", () => ({ useRouter: vi.fn() }));

import { CAPABILITY_AREAS } from "../../server/roles";
import { CAPABILITY_AREA_GROUPS } from "../../components/roles-page-client";
import en from "@/messages/en.json";
import ms from "@/messages/ms.json";

describe("CAPABILITY_AREA_GROUPS", () => {
  it("lists every server-side capability area, in the same order", () => {
    expect(CAPABILITY_AREA_GROUPS.map((g) => g.id)).toEqual(CAPABILITY_AREAS.map((a) => a.id));
  });

  it("has label/description message keys in both catalogs for every area", () => {
    for (const catalog of [en, ms]) {
      const areas = catalog.identity.rolesPage.areas as Record<
        string,
        { label?: string; description?: string }
      >;
      for (const { id } of CAPABILITY_AREAS) {
        expect(areas[id]?.label, `${id}.label`).toBeTruthy();
        expect(areas[id]?.description, `${id}.description`).toBeTruthy();
      }
    }
  });
});
