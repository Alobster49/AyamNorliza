/**
 * Shared HR leave types — the binding interfaces later tasks (RPC callers,
 * views) import by these exact names/shapes. Mirrors the DB shapes in
 * supabase/migrations/20260830000001_hr_leave_schema.sql and the balance
 * math in supabase/migrations/20260830000002_hr_leave_rpcs.sql.
 */

export type LeaveTypeInfo = {
  id: string;
  code: string;
  name: string;
  entitlementDays: number | null; // null = upon-request
  accrual: "pro_rata" | "full";
  carryForwardCap: number | null;
  requiresAttachment: boolean;
  sort: number;
};

export type LedgerEntry = {
  leaveTypeId: string;
  year: number;
  kind: "carry_forward" | "credit" | "adjustment";
  days: number;
  expiresOn: string | null; // ISO date
};

export type LeaveRequestSummary = {
  id: string;
  leaveTypeId: string;
  year: number;
  startDate: string;
  endDate: string;
  dayCount: number;
  status: "pending" | "approved" | "rejected" | "cancelled";
  breakdown: { carryForwardUsed: number; baseUsed: number } | null;
};

export type BalanceSummary = {
  uponRequest: boolean;
  entitlement: number; // 0 when uponRequest
  accrued: number;
  carryForward: number; // granted, unexpired as of asOf
  carryForwardExpiresOn: string | null;
  credits: number;
  takenBase: number;
  takenCarryForward: number;
  pendingHeld: number;
  available: number; // Infinity when uponRequest
};
