export type ProductionType = "layer" | "broiler" | "breeder" | "smallholder";

export type FlockStatus =
  | "draft"
  | "planned"
  | "readiness_pending"
  | "ready"
  | "active"
  | "restricted"
  | "harvest_pending"
  | "depopulated"
  | "closing"
  | "closed";

export type CountTransactionType =
  | "placement"
  | "mortality"
  | "cull"
  | "transfer_in"
  | "transfer_out"
  | "harvest"
  | "depopulation"
  | "adjustment";

export type CountTransactionApprovalStatus = "pending" | "approved" | "rejected";

export type FlockCountTransaction = {
  type: CountTransactionType;
  quantity: number;
  approvalStatus: CountTransactionApprovalStatus;
};

export type BirdBalanceSummary = {
  openingLiveBirds: number;
  placements: number;
  transfersIn: number;
  mortality: number;
  culls: number;
  transfersOut: number;
  harvestDepopulation: number;
  adjustments: number;
  closingLiveBirds: number;
  pendingAdjustments: number;
};

export type Flock = {
  id: string;
  organizationId: string;
  siteId: string;
  houseId: string | null;
  productionProfileId: string;
  targetProfileVersionId: string | null;
  code: string;
  name: string;
  productionType: ProductionType;
  sourceName: string;
  breedStrain: string;
  sex: "mixed" | "female" | "male" | "unknown";
  hatchDate: string;
  plannedArrivalDate: string;
  expectedEndDate: string | null;
  plannedQuantity: number;
  currentLiveBirds: number;
  status: FlockStatus;
  createdAt: string;
  updatedAt: string;
};
