import { describe, expect, it } from "vitest";
import { filterLabelsForDisplay } from "@/features/farm-structure/labels-list-model";
import type { QrIdentifier } from "@/features/farm-structure/types";

const organizationId = "11111111-1111-1111-1111-111111111111";

function identifier(overrides: Partial<QrIdentifier>): QrIdentifier {
  return {
    id: "label-1",
    organizationId,
    entityType: "house",
    entityId: "22222222-2222-2222-2222-222222222222",
    printableCode: "ANP-HOUSE-H01-ABC123",
    symbology: "qr",
    status: "active",
    replacedBy: null,
    replacementReason: null,
    generatedAt: "2026-06-25T00:00:00.000Z",
    generatedBy: null,
    retiredAt: null,
    ...overrides,
  };
}

describe("filterLabelsForDisplay", () => {
  it("searches identifiers and combines type, symbology, and status filters", () => {
    const labels = [
      identifier({ id: "label-1", entityType: "house", printableCode: "ANP-HOUSE-H01-ABC123", symbology: "qr", status: "active" }),
      identifier({ id: "label-2", entityType: "storage_location", printableCode: "ANP-STORAGE-S01-XYZ789", symbology: "code128", status: "retired" }),
    ];

    expect(filterLabelsForDisplay(labels, { search: "storage", entityType: "all", symbology: "all", status: "all" })).toEqual([labels[1]]);
    expect(filterLabelsForDisplay(labels, { search: "", entityType: "house", symbology: "qr", status: "active" })).toEqual([labels[0]]);
  });
});
