export type InspectionStatus = "draft" | "in_progress" | "submitted" | "reviewed" | "locked" | "void";
export type InspectionResponseStatus = "ok" | "abnormal" | "skipped" | "corrected";
export type ObservationSeverity = "info" | "low" | "medium" | "high" | "critical";
export type SyncOperationResult = "accepted" | "duplicate" | "conflict" | "rejected" | "retry_later";

export type TemplateQuestion = {
  key: string;
  label: string;
  responseType: "boolean" | "number" | "text" | "select";
  required: boolean;
  critical: boolean;
  unit?: string | null;
  minValue?: number | null;
  maxValue?: number | null;
  options?: string[];
};

export type InspectionTemplateVersion = {
  id: string;
  organizationId: string;
  templateId: string;
  version: string;
  productionTypes: string[];
  riskClasses: string[];
  status: "draft" | "pending_approval" | "approved" | "retired";
  definition: {
    sections: Array<{
      key: string;
      title: string;
      questions: TemplateQuestion[];
    }>;
  };
  effectiveFrom: string | null;
  effectiveTo: string | null;
};

export type DueRound = {
  houseId: string;
  houseCode: string;
  houseName: string;
  siteId: string;
  siteCode: string;
  flockId: string | null;
  flockCode: string | null;
  productionType: string;
  riskClass: string;
  templateVersionId: string | null;
  templateVersion: string | null;
  status: "due" | "in_progress" | "submitted" | "missing_template";
  inspectionId: string | null;
  dueAt: string;
};

export type Inspection = {
  id: string;
  organizationId: string;
  siteId: string;
  houseId: string;
  flockId: string | null;
  shiftId: string | null;
  templateVersionId: string;
  status: InspectionStatus;
  startedAt: string;
  completedAt: string | null;
  startedBy: string | null;
  completedBy: string | null;
  qualityScore: number | null;
  syncStatus: "server" | "synced" | "unsynced" | "conflicted" | "rejected";
};

export type Observation = {
  id: string;
  organizationId: string;
  inspectionId: string | null;
  siteId: string;
  houseId: string;
  flockId: string | null;
  category: string;
  severity: ObservationSeverity;
  description: string;
  immediateAction: string | null;
  status: "open" | "in_progress" | "resolved" | "dismissed";
  createdAt: string;
};

export type PeriodClose = {
  id: string;
  organizationId: string;
  siteId: string;
  houseId: string | null;
  periodType: "daily" | "weekly";
  periodStart: string;
  periodEnd: string;
  status: "open" | "ready" | "approved" | "locked" | "rejected";
  completeness: Record<string, unknown>;
  approvedAt: string | null;
};
