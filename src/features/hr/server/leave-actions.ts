"use server";

/**
 * Member-facing leave Server Actions: apply for leave, request a
 * replacement-leave credit, cancel a pending request, and read everything
 * the My Leave page needs in one call. Every action guards first
 * (`requireMember` — any active member), then selects only the columns it
 * needs.
 *
 * Balance-changing decisions (approve/reject/cancel) live behind the
 * `security definer` RPCs in supabase/migrations/20260830000002_hr_leave_rpcs.sql
 * so concurrent approvers can't overspend a balance; `cancelMyLeaveRequest`
 * below is a thin RPC call for that reason. `applyLeave`/`requestLeaveCredit`
 * are plain inserts (RLS's own-insert-pending-only policy is the backstop),
 * but the day count and balance check are still recomputed here from the
 * DB, never trusted from the client — the client's number is advisory only.
 */

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/features/orders/types";
import { todayInTimeZone } from "@/lib/time/org-date";
import { requireMember, OrderPermissionError } from "./guards";
import { workdayCount, validateApplication, computeBalance } from "../lib/leave-model";
import type { LeaveTypeInfo, LedgerEntry, LeaveRequestSummary } from "../types";

type LeaveErrorCode = "forbidden" | "validation" | "not_found" | "conflict" | "internal";

function err<T = never>(code: LeaveErrorCode, message: string, messageKey?: string): ActionResult<T> {
  return { ok: false, code, message, ...(messageKey ? { messageKey } : {}) };
}

function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

/**
 * `OrderPermissionError.message` is shared prose from the order-pipeline
 * guards, reused here (see guards.ts) — mirrors `permissionMessageKey` in
 * order-actions.ts/driver-actions.ts, but under the `hr.errors.*` namespace
 * this feature's UI (Task 7/8) reads.
 */
function permissionMessageKey(message: string): string {
  if (message === "Not authenticated") return "hr.errors.unauthenticated";
  if (message === "Organization not found") return "hr.errors.orgNotFound";
  return "hr.errors.forbidden";
}

type GuardResult =
  | { ok: true; orgId: string; userId: string; role: string; timeZone: string }
  | { ok: false; code: "forbidden"; message: string; messageKey: string };

async function guardMember(organizationSlug: string): Promise<GuardResult> {
  try {
    const ctx = await requireMember(organizationSlug);
    return { ok: true, ...ctx };
  } catch (e) {
    if (e instanceof OrderPermissionError) {
      return {
        ok: false,
        code: "forbidden",
        message: e.message,
        messageKey: permissionMessageKey(e.message),
      };
    }
    throw e;
  }
}

/** `cancel_leave_request`'s P0001 message codes. */
function leaveRpcError(rawMessage: string): { code: LeaveErrorCode; message: string; messageKey: string } {
  switch (rawMessage) {
    case "not_found":
      return { code: "not_found", message: "That request was not found.", messageKey: "hr.errors.not_found" };
    case "forbidden":
      return {
        code: "forbidden",
        message: "You do not have permission to do that.",
        messageKey: "hr.errors.forbidden",
      };
    case "invalid_status":
      return {
        code: "conflict",
        message: "This request has already been decided.",
        messageKey: "hr.errors.invalid_status",
      };
    default:
      return {
        code: "internal",
        message: "Something went wrong. Please try again.",
        messageKey: "hr.errors.internal",
      };
  }
}

/** Same reasons `validateApplication` returns, in plain English. */
function validationMessage(
  reason: "invalid_range" | "zero_workdays" | "insufficient_balance" | "attachment_required",
): string {
  switch (reason) {
    case "invalid_range":
      return "End date must be on or after the start date.";
    case "zero_workdays":
      return "This date range has no working days to apply for.";
    case "insufficient_balance":
      return "There is not enough leave balance for this request.";
    case "attachment_required":
      return "This leave type requires a supporting attachment.";
  }
}

/** Attachment upload lands at `{orgId}/{userId}/{uuid}.{ext}` — refuse a path claiming someone else's folder. */
function isOwnAttachmentPath(path: string, orgId: string, userId: string): boolean {
  return path.startsWith(`${orgId}/${userId}/`);
}

// ---------------------------------------------------------------------------
// Row mappers (snake_case DB -> camelCase TS)
// ---------------------------------------------------------------------------

type LeaveTypeRow = {
  id: string;
  code: string;
  name: string;
  entitlement_days: number | null;
  accrual: string;
  carry_forward_cap: number | null;
  requires_attachment: boolean;
  sort: number;
};

function rowToLeaveType(row: LeaveTypeRow): LeaveTypeInfo {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    entitlementDays: row.entitlement_days,
    accrual: row.accrual as LeaveTypeInfo["accrual"],
    carryForwardCap: row.carry_forward_cap,
    requiresAttachment: row.requires_attachment,
    sort: row.sort,
  };
}

function rowToBreakdown(json: unknown): { carryForwardUsed: number; baseUsed: number } | null {
  if (!json || typeof json !== "object") return null;
  const obj = json as Record<string, unknown>;
  const carryForwardUsed = obj.carry_forward_used;
  const baseUsed = obj.base_used;
  if (typeof carryForwardUsed !== "number" || typeof baseUsed !== "number") return null;
  return { carryForwardUsed, baseUsed };
}

type LeaveRequestRow = {
  id: string;
  leave_type_id: string;
  year: number;
  start_date: string;
  end_date: string;
  day_count: number;
  status: string;
  breakdown: unknown;
};

function rowToRequestSummary(row: LeaveRequestRow): LeaveRequestSummary {
  return {
    id: row.id,
    leaveTypeId: row.leave_type_id,
    year: row.year,
    startDate: row.start_date,
    endDate: row.end_date,
    dayCount: row.day_count,
    status: row.status as LeaveRequestSummary["status"],
    breakdown: rowToBreakdown(row.breakdown),
  };
}

/** Own-request row, extended with the display-only fields the history table needs. */
export type MyLeaveRequestRow = LeaveRequestSummary & {
  justification: string;
  decisionNote: string | null;
  attachmentPath: string | null;
  createdAt: string;
};

export type CreditRequestRow = {
  id: string;
  leaveTypeId: string;
  typeName: string;
  amount: number;
  referenceStart: string;
  referenceEnd: string;
  justification: string | null;
  attachmentPath: string | null;
  status: "pending" | "approved" | "rejected" | "cancelled";
  decisionNote: string | null;
  createdAt: string;
};

export type WhosAwayRow = { displayName: string; startDate: string; endDate: string; typeName: string };

export type MyLeaveData = {
  types: LeaveTypeInfo[];
  ledger: LedgerEntry[];
  requests: MyLeaveRequestRow[];
  creditRequests: CreditRequestRow[];
  holidays: { date: string; name: string }[];
  whosAway: WhosAwayRow[];
  viewer: { userId: string; role: string; displayName: string };
};

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * Everything the My Leave page shows for `year`: reference data (types,
 * holidays), the viewer's own ledger/requests/credit-requests (balance math
 * happens client-side via `computeBalance`, fed by these), and who's away —
 * which reads the safe-columns `leave_whos_away` view, never `leave_requests`
 * directly (that table's own RLS only exposes a row to its owner or an
 * approver, and carries justification/attachment/decision-note colleagues
 * must never see).
 */
export async function getMyLeaveData(
  organizationSlug: string,
  year: number,
): Promise<ActionResult<MyLeaveData>> {
  const guard = await guardMember(organizationSlug);
  if (!guard.ok) return err(guard.code, guard.message, guard.messageKey);
  const { orgId, userId, role } = guard;

  const supabase = await createSupabaseServerClient();

  const [
    { data: typeRows, error: typeErr },
    { data: ledgerRows, error: ledgerErr },
    { data: requestRows, error: reqErr },
    { data: creditRows, error: creditErr },
    { data: holidayRows, error: holErr },
    { data: profileRow },
    { data: awayRows, error: awayErr },
  ] = await Promise.all([
    supabase
      .from("leave_types")
      .select("id, code, name, entitlement_days, accrual, carry_forward_cap, requires_attachment, sort")
      .eq("organization_id", orgId)
      .order("sort", { ascending: true }),
    supabase
      .from("leave_ledger")
      .select("leave_type_id, year, kind, days, expires_on")
      .eq("organization_id", orgId)
      .eq("user_id", userId)
      .eq("year", year),
    supabase
      .from("leave_requests")
      .select(
        "id, leave_type_id, year, start_date, end_date, day_count, status, breakdown, justification, decision_note, attachment_path, created_at",
      )
      .eq("organization_id", orgId)
      .eq("user_id", userId)
      .eq("year", year)
      .order("created_at", { ascending: false }),
    supabase
      .from("leave_credit_requests")
      .select(
        "id, leave_type_id, amount, reference_start, reference_end, justification, attachment_path, status, decision_note, created_at",
      )
      .eq("organization_id", orgId)
      .eq("user_id", userId)
      .order("created_at", { ascending: false }),
    supabase
      .from("public_holidays")
      .select("holiday_date, name")
      .eq("organization_id", orgId)
      .gte("holiday_date", `${year}-01-01`)
      .lte("holiday_date", `${year}-12-31`)
      .order("holiday_date", { ascending: true }),
    supabase.from("profiles").select("display_name").eq("user_id", userId).maybeSingle(),
    supabase
      .from("leave_whos_away")
      .select("user_id, leave_type_id, start_date, end_date")
      .eq("organization_id", orgId),
  ]);

  if (typeErr || ledgerErr || reqErr || creditErr || holErr || awayErr) {
    return err("internal", "Failed to load your leave data.", "hr.errors.internal");
  }

  const types = (typeRows ?? []).map(rowToLeaveType);
  const typeNameById = new Map(types.map((t) => [t.id, t.name]));

  const ledger: LedgerEntry[] = (ledgerRows ?? []).map((r) => ({
    leaveTypeId: r.leave_type_id,
    year: r.year,
    kind: r.kind as LedgerEntry["kind"],
    days: r.days,
    expiresOn: r.expires_on,
  }));

  const requests: MyLeaveRequestRow[] = (requestRows ?? []).map((r) => ({
    ...rowToRequestSummary(r),
    justification: r.justification,
    decisionNote: r.decision_note,
    attachmentPath: r.attachment_path,
    createdAt: r.created_at,
  }));

  const creditRequests: CreditRequestRow[] = (creditRows ?? []).map((r) => ({
    id: r.id,
    leaveTypeId: r.leave_type_id,
    typeName: typeNameById.get(r.leave_type_id) ?? "",
    amount: r.amount,
    referenceStart: r.reference_start,
    referenceEnd: r.reference_end,
    justification: r.justification,
    attachmentPath: r.attachment_path,
    status: r.status as CreditRequestRow["status"],
    decisionNote: r.decision_note,
    createdAt: r.created_at,
  }));

  const holidays = (holidayRows ?? []).map((h) => ({ date: h.holiday_date, name: h.name }));

  const validAwayRows = (awayRows ?? []).filter(
    (r): r is { user_id: string; leave_type_id: string; start_date: string; end_date: string } =>
      !!r.user_id && !!r.leave_type_id && !!r.start_date && !!r.end_date,
  );
  const awayUserIds = Array.from(new Set(validAwayRows.map((r) => r.user_id)));
  const people: Record<string, string> = {};
  if (awayUserIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("user_id, display_name")
      .in("user_id", awayUserIds);
    for (const p of profiles ?? []) {
      if (p.display_name) people[p.user_id] = p.display_name;
    }
  }
  const whosAway: WhosAwayRow[] = validAwayRows.map((r) => ({
    displayName: people[r.user_id] ?? "Unknown",
    startDate: r.start_date,
    endDate: r.end_date,
    typeName: typeNameById.get(r.leave_type_id) ?? "",
  }));

  return ok({
    types,
    ledger,
    requests,
    creditRequests,
    holidays,
    whosAway,
    viewer: { userId, role, displayName: profileRow?.display_name ?? "" },
  });
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export type ApplyLeaveInput = {
  leaveTypeId: string;
  startDate: string;
  endDate: string;
  justification: string;
  attachmentPath?: string | null;
};

/**
 * Inserts a pending leave request. `day_count` is never trusted from the
 * client — recomputed here via `workdayCount` + this org's holidays, and
 * `validateApplication` re-checks the range/attachment/balance rules
 * against a fresh read of the member's own ledger and requests.
 */
export async function applyLeave(
  organizationSlug: string,
  input: ApplyLeaveInput,
): Promise<ActionResult<{ id: string }>> {
  const guard = await guardMember(organizationSlug);
  if (!guard.ok) return err(guard.code, guard.message, guard.messageKey);
  const { orgId, userId, timeZone } = guard;

  if (!input.leaveTypeId) return err("validation", "Choose a leave type.", "hr.errors.validation");
  if (!input.justification || input.justification.trim().length === 0) {
    return err("validation", "Justification is required.", "hr.errors.validation");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(input.endDate)) {
    return err("validation", "Pick valid dates.", "hr.errors.validation");
  }
  if (input.attachmentPath && !isOwnAttachmentPath(input.attachmentPath, orgId, userId)) {
    return err("validation", "That attachment is not yours.", "hr.errors.validation");
  }

  const supabase = await createSupabaseServerClient();

  const { data: typeRow, error: typeErr } = await supabase
    .from("leave_types")
    .select("id, code, name, entitlement_days, accrual, carry_forward_cap, requires_attachment, sort")
    .eq("id", input.leaveTypeId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (typeErr) return err("internal", "Failed to load the leave type.", "hr.errors.internal");
  if (!typeRow) return err("not_found", "That leave type was not found.", "hr.errors.not_found");
  const type = rowToLeaveType(typeRow);

  const { data: holidayRows, error: holErr } = await supabase
    .from("public_holidays")
    .select("holiday_date")
    .eq("organization_id", orgId)
    .gte("holiday_date", input.startDate)
    .lte("holiday_date", input.endDate);
  if (holErr) return err("internal", "Failed to load holidays.", "hr.errors.internal");
  const holidays = (holidayRows ?? []).map((h) => h.holiday_date);

  const dayCount = workdayCount(input.startDate, input.endDate, holidays);
  const year = Number(input.startDate.slice(0, 4));
  const asOf = todayInTimeZone(timeZone);

  const [{ data: ledgerRows, error: ledgerErr }, { data: requestRows, error: reqErr }] = await Promise.all([
    supabase
      .from("leave_ledger")
      .select("leave_type_id, year, kind, days, expires_on")
      .eq("organization_id", orgId)
      .eq("user_id", userId)
      .eq("leave_type_id", type.id)
      .eq("year", year),
    supabase
      .from("leave_requests")
      .select("id, leave_type_id, year, start_date, end_date, day_count, status, breakdown")
      .eq("organization_id", orgId)
      .eq("user_id", userId)
      .eq("leave_type_id", type.id)
      .eq("year", year)
      .in("status", ["pending", "approved"]),
  ]);
  if (ledgerErr || reqErr) return err("internal", "Failed to load your leave balance.", "hr.errors.internal");

  const ledger: LedgerEntry[] = (ledgerRows ?? []).map((r) => ({
    leaveTypeId: r.leave_type_id,
    year: r.year,
    kind: r.kind as LedgerEntry["kind"],
    days: r.days,
    expiresOn: r.expires_on,
  }));
  const requests: LeaveRequestSummary[] = (requestRows ?? []).map(rowToRequestSummary);

  const balance = computeBalance(type, ledger, requests, year, asOf);

  const validation = validateApplication({
    type,
    startDate: input.startDate,
    endDate: input.endDate,
    dayCount,
    balance,
    attachmentProvided: !!input.attachmentPath,
  });
  if (!validation.ok) {
    return err("validation", validationMessage(validation.reason), `hr.errors.${validation.reason}`);
  }

  const { data: inserted, error: insertErr } = await supabase
    .from("leave_requests")
    .insert({
      organization_id: orgId,
      user_id: userId,
      leave_type_id: type.id,
      year,
      start_date: input.startDate,
      end_date: input.endDate,
      day_count: dayCount,
      justification: input.justification,
      attachment_path: input.attachmentPath ?? null,
    })
    .select("id")
    .single();
  if (insertErr || !inserted) {
    return err("internal", "Failed to submit your leave request.", "hr.errors.internal");
  }

  revalidatePath(`/${organizationSlug}/leave`);
  revalidatePath(`/${organizationSlug}/leave/manage`);
  return ok({ id: inserted.id });
}

export type RequestLeaveCreditInput = {
  leaveTypeId: string;
  amount: number;
  referenceStart: string;
  referenceEnd: string;
  justification?: string;
  attachmentPath?: string | null;
};

export async function requestLeaveCredit(
  organizationSlug: string,
  input: RequestLeaveCreditInput,
): Promise<ActionResult<{ id: string }>> {
  const guard = await guardMember(organizationSlug);
  if (!guard.ok) return err(guard.code, guard.message, guard.messageKey);
  const { orgId, userId } = guard;

  if (!input.leaveTypeId) return err("validation", "Choose a leave type.", "hr.errors.validation");
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    return err("validation", "Amount must be greater than zero.", "hr.errors.invalid_amount");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.referenceStart) || !/^\d{4}-\d{2}-\d{2}$/.test(input.referenceEnd)) {
    return err("validation", "Pick valid dates.", "hr.errors.validation");
  }
  if (input.referenceEnd < input.referenceStart) {
    return err(
      "validation",
      "Reference end date must be on or after the start date.",
      "hr.errors.invalid_range",
    );
  }
  if (input.attachmentPath && !isOwnAttachmentPath(input.attachmentPath, orgId, userId)) {
    return err("validation", "That attachment is not yours.", "hr.errors.validation");
  }

  const supabase = await createSupabaseServerClient();
  const { data: typeRow, error: typeErr } = await supabase
    .from("leave_types")
    .select("id")
    .eq("id", input.leaveTypeId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (typeErr) return err("internal", "Failed to load the leave type.", "hr.errors.internal");
  if (!typeRow) return err("not_found", "That leave type was not found.", "hr.errors.not_found");

  const { data: inserted, error } = await supabase
    .from("leave_credit_requests")
    .insert({
      organization_id: orgId,
      user_id: userId,
      leave_type_id: input.leaveTypeId,
      amount: input.amount,
      reference_start: input.referenceStart,
      reference_end: input.referenceEnd,
      justification: input.justification ?? null,
      attachment_path: input.attachmentPath ?? null,
    })
    .select("id")
    .single();
  if (error || !inserted) {
    return err("internal", "Failed to submit your credit request.", "hr.errors.internal");
  }

  revalidatePath(`/${organizationSlug}/leave`);
  revalidatePath(`/${organizationSlug}/leave/manage`);
  return ok({ id: inserted.id });
}

export async function cancelMyLeaveRequest(
  organizationSlug: string,
  requestId: string,
): Promise<ActionResult> {
  const guard = await guardMember(organizationSlug);
  if (!guard.ok) return err(guard.code, guard.message, guard.messageKey);

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("cancel_leave_request", { p_request: requestId });
  if (error) {
    const mapped = leaveRpcError(error.message);
    return err(mapped.code, mapped.message, mapped.messageKey);
  }

  revalidatePath(`/${organizationSlug}/leave`);
  revalidatePath(`/${organizationSlug}/leave/manage`);
  return ok(undefined);
}
