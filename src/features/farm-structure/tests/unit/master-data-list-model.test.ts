import { describe, expect, it } from "vitest";
import { filterCodeSetsForDisplay } from "@/features/farm-structure/master-data-list-model";
import type { CodeSet, CodeValue } from "@/features/farm-structure/types";

const organizationId = "11111111-1111-1111-1111-111111111111";

function value(overrides: Partial<CodeValue>): CodeValue {
  return {
    id: "value-1",
    organizationId,
    codeSetId: "set-1",
    code: "ROSS308",
    label: "Ross 308",
    translations: {},
    sortOrder: 0,
    status: "active",
    effectiveFrom: null,
    effectiveTo: null,
    metadata: {},
    ...overrides,
  };
}

function set(overrides: Partial<CodeSet>): CodeSet {
  return {
    id: "set-1",
    organizationId,
    key: "breeds",
    name: "Breeds",
    description: null,
    status: "active",
    values: [value({})],
    ...overrides,
  };
}

describe("filterCodeSetsForDisplay", () => {
  it("searches across set and value text and filters set/value status", () => {
    const sets = [
      set({ id: "set-1", key: "breeds", name: "Breeds", status: "active", values: [value({ id: "value-1", codeSetId: "set-1", code: "ROSS308", label: "Ross 308", status: "active" })] }),
      set({ id: "set-2", key: "egg_grades", name: "Egg grades", status: "draft", values: [value({ id: "value-2", codeSetId: "set-2", code: "REJECT", label: "Reject", status: "inactive" })] }),
    ];

    expect(filterCodeSetsForDisplay(sets, { search: "reject", setStatus: "all", valueStatus: "all" })).toEqual([sets[1]]);
    expect(filterCodeSetsForDisplay(sets, { search: "", setStatus: "draft", valueStatus: "inactive" })).toEqual([sets[1]]);
  });
});
