import type {
  BirdBalanceSummary,
  FlockCountTransaction,
  FlockStatus,
  ProductionType,
} from "./types";

const lifecycleTransitions: Record<FlockStatus, FlockStatus[]> = {
  draft: ["planned"],
  planned: ["readiness_pending"],
  readiness_pending: ["ready"],
  ready: ["active"],
  active: ["restricted", "harvest_pending", "depopulated"],
  restricted: ["active"],
  harvest_pending: ["depopulated"],
  depopulated: ["closing"],
  closing: ["closed"],
  closed: [],
};

const openHouseStatuses = new Set<FlockStatus>([
  "planned",
  "readiness_pending",
  "ready",
  "active",
  "restricted",
  "harvest_pending",
]);

export function getAllowedNextFlockStatuses(status: FlockStatus): FlockStatus[] {
  return lifecycleTransitions[status];
}

export function canTransitionFlockStatus(from: FlockStatus, to: FlockStatus): boolean {
  return getAllowedNextFlockStatuses(from).includes(to);
}

export function calculateBirdBalance(input: {
  openingLiveBirds: number;
  transactions: FlockCountTransaction[];
}): BirdBalanceSummary {
  const summary: BirdBalanceSummary = {
    openingLiveBirds: input.openingLiveBirds,
    placements: 0,
    transfersIn: 0,
    mortality: 0,
    culls: 0,
    transfersOut: 0,
    harvestDepopulation: 0,
    adjustments: 0,
    closingLiveBirds: input.openingLiveBirds,
    pendingAdjustments: 0,
  };

  for (const transaction of input.transactions) {
    if (transaction.type === "adjustment" && transaction.approvalStatus === "pending") {
      summary.pendingAdjustments += transaction.quantity;
      continue;
    }
    if (transaction.approvalStatus !== "approved") continue;

    switch (transaction.type) {
      case "placement":
        summary.placements += transaction.quantity;
        break;
      case "transfer_in":
        summary.transfersIn += transaction.quantity;
        break;
      case "mortality":
        summary.mortality += transaction.quantity;
        break;
      case "cull":
        summary.culls += transaction.quantity;
        break;
      case "transfer_out":
        summary.transfersOut += transaction.quantity;
        break;
      case "harvest":
      case "depopulation":
        summary.harvestDepopulation += transaction.quantity;
        break;
      case "adjustment":
        summary.adjustments += transaction.quantity;
        break;
    }
  }

  summary.closingLiveBirds =
    summary.openingLiveBirds +
    summary.placements +
    summary.transfersIn -
    summary.mortality -
    summary.culls -
    summary.transfersOut -
    summary.harvestDepopulation +
    summary.adjustments;

  return summary;
}

export function getCurrentFlockStage(input: {
  hatchDate: string;
  asOfDate: string;
  curvePoints: Array<{ stage: string | null; ageStartDay: number; ageEndDay: number }>;
}): { ageDays: number; stage: string | null } {
  const ageDays = differenceInUtcDays(input.hatchDate, input.asOfDate);
  const point = input.curvePoints.find(
    (curvePoint) => ageDays >= curvePoint.ageStartDay && ageDays <= curvePoint.ageEndDay,
  );
  return { ageDays, stage: point?.stage ?? null };
}

export function canAssignHouseToFlock(input: {
  plannedQuantity: number;
  productionType: ProductionType;
  house: {
    capacityBirds: number;
    productionPurpose: ProductionType;
    operationalStatus: string;
  };
  existingFlocks: Array<{ status: FlockStatus }>;
}): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];

  if (input.house.operationalStatus !== "active") {
    reasons.push("house is not active");
  }
  if (input.house.productionPurpose !== input.productionType) {
    reasons.push("house production purpose does not match flock production type");
  }
  if (input.plannedQuantity > input.house.capacityBirds) {
    reasons.push("planned quantity exceeds house capacity");
  }
  if (input.existingFlocks.some((flock) => openHouseStatuses.has(flock.status))) {
    reasons.push("house already has an open flock");
  }

  return { ok: reasons.length === 0, reasons };
}

function differenceInUtcDays(startDate: string, endDate: string): number {
  const start = new Date(`${startDate.slice(0, 10)}T00:00:00.000Z`);
  const end = new Date(endDate);
  const startUtc = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  const endUtc = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  return Math.max(0, Math.floor((endUtc - startUtc) / 86_400_000));
}
