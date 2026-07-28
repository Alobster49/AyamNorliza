import { describe, it, expect } from "vitest";
import {
  CAPABILITIES,
  can,
  ROLES,
  type Capability,
  type Role,
} from "@/lib/auth/permissions";
import { buildCapabilityMatrix } from "@/features/access-control/lib/capability-matrix";

describe("buildCapabilityMatrix", () => {
  it("orders rows by roleRank descending (owner first, support last)", () => {
    const matrix = buildCapabilityMatrix();
    const rowRoles = matrix.rows.map((r) => r.role);
    expect(rowRoles[0]).toBe("owner");
    expect(rowRoles[rowRoles.length - 1]).toBe("support");
    expect(rowRoles).toEqual([...ROLES].sort((a, b) => {
      // rank descending: owner has highest
      const ranks: Record<Role, number> = {
        owner: 100,
        org_admin: 80,
        seller: 60,
        farm_manager: 60,
        supervisor: 50,
        veterinarian: 50,
        biosecurity_qa: 50,
        maintenance: 40,
        inventory: 40,
        logistics: 40,
        caretaker: 30,
        auditor: 20,
        support: 10,
      };
      return ranks[b] - ranks[a];
    }));
  });

  it("every cell exposes hasCapability matching can(role, capability)", () => {
    const matrix = buildCapabilityMatrix();
    for (const row of matrix.rows) {
      for (const group of matrix.groups) {
        for (const cap of group.capabilities) {
          const cell = row.cells[cap];
          expect(cell, `missing cell for ${row.role}.${cap}`).toBeDefined();
          expect(cell.hasCapability).toBe(can(row.role, cap));
        }
      }
    }
  });

  it("every capability appears in exactly one group on the matrix", () => {
    const matrix = buildCapabilityMatrix();
    const flat = matrix.groups.flatMap((g) => g.capabilities);
    expect(flat.length).toBe(CAPABILITIES.length);
    expect(new Set(flat).size).toBe(CAPABILITIES.length);
    for (const cap of CAPABILITIES) {
      expect(flat).toContain(cap as Capability);
    }
  });
});
