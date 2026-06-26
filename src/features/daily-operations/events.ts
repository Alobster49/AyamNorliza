export const DAILY_OPERATIONS_EVENTS = {
  shiftCreated: "daily_operations.shift_created",
  shiftAssigned: "daily_operations.shift_assigned",
  templateVersionCreated: "daily_operations.template_version_created",
  templateVersionApproved: "daily_operations.template_version_approved",
  inspectionStarted: "daily_operations.inspection_started",
  inspectionSubmitted: "daily_operations.inspection_submitted",
  observationCreated: "daily_operations.observation_created",
  handoverCreated: "daily_operations.handover_created",
  periodCloseCreated: "daily_operations.period_close_created",
  periodCloseApproved: "daily_operations.period_close_approved",
  correctionRequested: "daily_operations.correction_requested",
  correctionDecided: "daily_operations.correction_decided",
  syncOperationProcessed: "daily_operations.sync_operation_processed",
} as const;

export type DailyOperationsEvent =
  (typeof DAILY_OPERATIONS_EVENTS)[keyof typeof DAILY_OPERATIONS_EVENTS];
