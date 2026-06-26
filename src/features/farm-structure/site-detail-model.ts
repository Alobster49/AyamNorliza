import type {
  BiosecurityZone,
  House,
  StorageLocation,
} from "./types";
import type { CompletenessResult } from "./domain";

export type ReadinessTone = {
  label: "Ready" | "Needs setup" | "Blocked";
  tone: "ready" | "warning" | "blocked";
};

export type SiteDetailSummary = {
  zones: { active: number; total: number };
  houses: { active: number; total: number };
  storage: { active: number; total: number };
};

export function getReadinessTone(readiness: CompletenessResult): ReadinessTone {
  if (readiness.ready) return { label: "Ready", tone: "ready" };
  if (readiness.score < 50) return { label: "Blocked", tone: "blocked" };
  return { label: "Needs setup", tone: "warning" };
}

export function buildSiteDetailSummary(input: {
  zones: BiosecurityZone[];
  houses: House[];
  storageLocations: StorageLocation[];
}): SiteDetailSummary {
  return {
    zones: {
      active: input.zones.filter((zone) => zone.status === "active").length,
      total: input.zones.length,
    },
    houses: {
      active: input.houses.filter((house) => house.operationalStatus === "active").length,
      total: input.houses.length,
    },
    storage: {
      active: input.storageLocations.filter((location) => location.status === "active").length,
      total: input.storageLocations.length,
    },
  };
}
