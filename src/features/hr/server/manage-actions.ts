"use server";

/**
 * Approver-facing leave Server Actions: the pending queue, staff balances,
 * holiday/leave-type settings, year close, and attachment preview links.
 * Every action guards first (`requireLeaveApprover` — owner/org_admin/hr),
 * then selects only the columns it needs. Decisions (approve/reject,
 * year-close) are RPC calls into the `security definer` functions in
 * supabase/migrations/20260830000002_hr_leave_rpcs.sql, which serialize
 * concurrent approvals so a balance can never be overspent — this file
 * only maps their P0001 error codes to a friendly `ActionResult`.
 */

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/features/orders/types";
import { todayInTimeZone } from "@/lib/time/org-date";
import { requireLeaveApprover, OrderPermissionError } from "./guards";
import { computeBalance } from "../lib/leave-model";
import type { LeaveTypeInfo, LedgerEntry, LeaveRequestSummary, BalanceSummary } from "../types";

type LeaveErrorCode = "forbidden" | "validation" | "not_found" | "conflict" | "internal";

function err<T = never>(code: LeaveErrorCode, message: string, messageKey?: string): ActionResult<T> {
  return { ok: false, code, message, ...(messageKey ? { messageKey } : {}) };
}

function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

/** See leave-actions.ts's `permissionMessageKey` — same rationale, `hr.errors.*` namespace. */
function permissionMessageKey(message: string): string {
  if (message === "Not authenticated") return "hr.errors.unauthenticated";
  if (message === "Organization not found") return "hr.errors.orgNotFound";
  return "hr.errors.forbidden";
}

type GuardResult =
  | { ok: true; orgId: string; userId: string; role: string; timeZone: string }
  | { ok: false; code: "forbidden"; message: string; messageKey: string };

async function guardApprover(organizationSlug: string): Promise<GuardResult> {
  try {
    const ctx = await requireLeaveApprover(organizationSlug);
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

/**
 * `approve_leave_request`/`reject_leave_request`/`approve_leave_credit`/
 * `reject_leave_credit`/`close_leave_year`'s shared P0001 message codes
 * (approve_leave_request is the only one that can raise `insufficient_balance`).
 */
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
    case "insufficient_balance":
      return {
        code: "conflict",
        message: "This member does not have enough leave balance for that.",
        messageKey: "hr.errors.insufficient_balance",
      };
    default:
      return {
        code: "internal",
        message: "Something went wrong. Please try again.",
        messageKey: "hr.errors.internal",
      };
  }
}

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

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
  user_id: string;
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

export type PendingLeaveRow = LeaveRequestSummary & {
  userId: string;
  displayName: string;
  typeName: string;
  justification: string;
  attachmentPath: string | null;
  createdAt: string;
};

export type PendingCreditRow = {
  id: string;
  userId: string;
  displayName: string;
  leaveTypeId: string;
  typeName: string;
  amount: number;
  referenceStart: string;
  referenceEnd: string;
  justification: string | null;
  attachmentPath: string | null;
  createdAt: string;
};

/**
 * `BalanceSummary.available` is `Infinity` for upon-request types — a
 * deliberate client-side convenience the model's own doc comment warns must
 * never cross a network boundary (`JSON.stringify` turns it into `null`
 * anyway, silently). Server Actions round-trip through Next's Flight
 * serialization, not plain JSON, but this action still normalizes it to an
 * explicit `null` before it leaves the server — `uponRequest` already tells
 * the caller this member's balance for that type is unlimited.
 */
export type SerializableBalance = Omit<BalanceSummary, "available"> & { available: number | null };

function toSerializableBalance(balance: BalanceSummary): SerializableBalance {
  return { ...balance, available: Number.isFinite(balance.available) ? balance.available : null };
}

export type StaffBalanceRow = {
  userId: string;
  displayName: string;
  /** Keyed by leaveTypeId. */
  balances: Record<string, SerializableBalance>;
};

export type ManageData = {
  pending: PendingLeaveRow[];
  pendingCredits: PendingCreditRow[];
  staff: StaffBalanceRow[];
  types: LeaveTypeInfo[];
  holidays: { id: string; date: string; name: string }[];
};

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getManageData(
  organizationSlug: string,
  year: number,
): Promise<ActionResult<ManageData>> {
  const guard = await guardApprover(organizationSlug);
  if (!guard.ok) return err(guard.code, guard.message, guard.messageKey);
  const { orgId, timeZone } = guard;

  const supabase = await createSupabaseServerClient();

  const [
    { data: typeRows, error: typeErr },
    { data: pendingRows, error: pendErr },
    { data: pendingCreditRows, error: pcErr },
    { data: holidayRows, error: holErr },
    { data: memberRows, error: memErr },
  ] = await Promise.all([
    supabase
      .from("leave_types")
      .select("id, code, name, entitlement_days, accrual, carry_forward_cap, requires_attachment, sort")
      .eq("organization_id", orgId)
      .order("sort", { ascending: true }),
    supabase
      .from("leave_requests")
      .select(
        "id, user_id, leave_type_id, year, start_date, end_date, day_count, status, breakdown, justification, attachment_path, created_at",
      )
      .eq("organization_id", orgId)
      .eq("status", "pending")
      .order("created_at", { ascending: true }),
    supabase
      .from("leave_credit_requests")
      .select(
        "id, user_id, leave_type_id, amount, reference_start, reference_end, justification, attachment_path, created_at",
      )
      .eq("organization_id", orgId)
      .eq("status", "pending")
      .order("created_at", { ascending: true }),
    supabase
      .from("public_holidays")
      .select("id, holiday_date, name")
      .eq("organization_id", orgId)
      .gte("holiday_date", `${year}-01-01`)
      .lte("holiday_date", `${year}-12-31`)
      .order("holiday_date", { ascending: true }),
    supabase.from("organization_members").select("user_id, role").eq("organization_id", orgId).eq("status", "active"),
  ]);

  if (typeErr || pendErr || pcErr || holErr || memErr) {
    return err("internal", "Failed to load leave management data.", "hr.errors.internal");
  }

  const types = (typeRows ?? []).map(rowToLeaveType);
  const typeNameById = new Map(types.map((t) => [t.id, t.name]));
  const members = memberRows ?? [];
  const memberIds = members.map((m) => m.user_id);

  // Names for requesters, credit requesters, and staff — one query, same
  // idiom as `getTodayTasks`'s `people` map in order-actions.ts.
  const personIds = Array.from(
    new Set([...(pendingRows ?? []).map((r) => r.user_id), ...(pendingCreditRows ?? []).map((r) => r.user_id), ...memberIds]),
  );
  const people: Record<string, string> = {};
  if (personIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("user_id, display_name")
      .in("user_id", personIds);
    for (const p of profiles ?? []) {
      if (p.display_name) people[p.user_id] = p.display_name;
    }
  }

  const pending: PendingLeaveRow[] = (pendingRows ?? []).map((r) => ({
    ...rowToRequestSummary(r),
    userId: r.user_id,
    displayName: people[r.user_id] ?? "Unknown",
    typeName: typeNameById.get(r.leave_type_id) ?? "",
    justification: r.justification,
    attachmentPath: r.attachment_path,
    createdAt: r.created_at,
  }));

  const pendingCredits: PendingCreditRow[] = (pendingCreditRows ?? []).map((r) => ({
    id: r.id,
    userId: r.user_id,
    displayName: people[r.user_id] ?? "Unknown",
    leaveTypeId: r.leave_type_id,
    typeName: typeNameById.get(r.leave_type_id) ?? "",
    amount: r.amount,
    referenceStart: r.reference_start,
    referenceEnd: r.reference_end,
    justification: r.justification,
    attachmentPath: r.attachment_path,
    createdAt: r.created_at,
  }));

  const holidays = (holidayRows ?? []).map((h) => ({ id: h.id, date: h.holiday_date, name: h.name }));

  // Staff balances: computeBalance per member x type, from each member's
  // own ledger + (pending/approved) requests for `year`.
  let staff: StaffBalanceRow[] = [];
  if (memberIds.length > 0 && types.length > 0) {
    const [{ data: ledgerRows, error: ledErr }, { data: allRequestRows, error: allReqErr }] = await Promise.all([
      supabase
        .from("leave_ledger")
        .select("user_id, leave_type_id, year, kind, days, expires_on")
        .eq("organization_id", orgId)
        .eq("year", year)
        .in("user_id", memberIds),
      supabase
        .from("leave_requests")
        .select("id, user_id, leave_type_id, year, start_date, end_date, day_count, status, breakdown")
        .eq("organization_id", orgId)
        .eq("year", year)
        .in("user_id", memberIds)
        .in("status", ["pending", "approved"]),
    ]);
    if (ledErr || allReqErr) return err("internal", "Failed to load staff balances.", "hr.errors.internal");

    const ledgerByUser = new Map<string, LedgerEntry[]>();
    for (const r of ledgerRows ?? []) {
      const entry: LedgerEntry = {
        leaveTypeId: r.leave_type_id,
        year: r.year,
        kind: r.kind as LedgerEntry["kind"],
        days: r.days,
        expiresOn: r.expires_on,
      };
      const list = ledgerByUser.get(r.user_id) ?? [];
      list.push(entry);
      ledgerByUser.set(r.user_id, list);
    }
    const requestsByUser = new Map<string, LeaveRequestSummary[]>();
    for (const r of allRequestRows ?? []) {
      const list = requestsByUser.get(r.user_id) ?? [];
      list.push(rowToRequestSummary(r));
      requestsByUser.set(r.user_id, list);
    }

    // Deliberately "today", not per-request start date: this table answers
    // "what does this member's balance look like right now", the same
    // question an HR user is asking when they open the tab — unlike
    // applyLeave's per-request as-of (see leave-actions.ts), there is no
    // single request date to anchor this view to.
    const asOf = todayInTimeZone(timeZone);
    staff = members.map((m) => {
      const memberLedger = ledgerByUser.get(m.user_id) ?? [];
      const memberRequests = requestsByUser.get(m.user_id) ?? [];
      const balances: Record<string, SerializableBalance> = {};
      for (const type of types) {
        balances[type.id] = toSerializableBalance(
          computeBalance(type, memberLedger, memberRequests, year, asOf),
        );
      }
      return { userId: m.user_id, displayName: people[m.user_id] ?? "Unknown", balances };
    });
  }

  return ok({ pending, pendingCredits, staff, types, holidays });
}

/** Approver-facing signed URL to preview an applicant's attachment (Task 8's pending queue). */
export async function getAttachmentUrl(
  organizationSlug: string,
  path: string,
): Promise<ActionResult<{ url: string }>> {
  const guard = await guardApprover(organizationSlug);
  if (!guard.ok) return err(guard.code, guard.message, guard.messageKey);
  const { orgId } = guard;

  // Path convention is `{orgId}/{userId}/{uuid}.{ext}` — the storage RLS
  // policy already scopes an approver to their own orgs, but this also
  // refuses a path for a *different* org this approver happens to belong
  // to, keeping the signed URL scoped to the org named by `organizationSlug`.
  if (!path.startsWith(`${orgId}/`)) {
    return err("forbidden", "You do not have access to that attachment.", "hr.errors.forbidden");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.storage.from("leave-attachments").createSignedUrl(path, 300);
  if (error || !data) {
    return err("internal", "Failed to generate a link for that attachment.", "hr.errors.internal");
  }

  return ok({ url: data.signedUrl });
}

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

export async function decideLeave(
  organizationSlug: string,
  requestId: string,
  action: "approve" | "reject",
  note?: string,
): Promise<ActionResult> {
  const guard = await guardApprover(organizationSlug);
  if (!guard.ok) return err(guard.code, guard.message, guard.messageKey);

  const supabase = await createSupabaseServerClient();
  const fn = action === "approve" ? "approve_leave_request" : "reject_leave_request";
  const { error } = await supabase.rpc(fn, { p_request: requestId, p_note: note ?? null });
  if (error) {
    const mapped = leaveRpcError(error.message);
    return err(mapped.code, mapped.message, mapped.messageKey);
  }

  revalidatePath(`/${organizationSlug}/leave`);
  revalidatePath(`/${organizationSlug}/leave/manage`);
  return ok(undefined);
}

export async function decideCredit(
  organizationSlug: string,
  requestId: string,
  action: "approve" | "reject",
  note?: string,
): Promise<ActionResult> {
  const guard = await guardApprover(organizationSlug);
  if (!guard.ok) return err(guard.code, guard.message, guard.messageKey);

  const supabase = await createSupabaseServerClient();
  const fn = action === "approve" ? "approve_leave_credit" : "reject_leave_credit";
  const { error } = await supabase.rpc(fn, { p_request: requestId, p_note: note ?? null });
  if (error) {
    const mapped = leaveRpcError(error.message);
    return err(mapped.code, mapped.message, mapped.messageKey);
  }

  revalidatePath(`/${organizationSlug}/leave`);
  revalidatePath(`/${organizationSlug}/leave/manage`);
  return ok(undefined);
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export async function saveHoliday(
  organizationSlug: string,
  input: { date: string; name: string },
): Promise<ActionResult<{ id: string }>> {
  const guard = await guardApprover(organizationSlug);
  if (!guard.ok) return err(guard.code, guard.message, guard.messageKey);
  const { orgId } = guard;

  if (!DATE_REGEX.test(input.date)) return err("validation", "Pick a valid date.", "hr.errors.validation");
  if (!input.name || input.name.trim().length === 0) {
    return err("validation", "Name is required.", "hr.errors.validation");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("public_holidays")
    .insert({ organization_id: orgId, holiday_date: input.date, name: input.name.trim() })
    .select("id")
    .single();
  if (error || !data) return err("internal", "Failed to save the holiday.", "hr.errors.internal");

  revalidatePath(`/${organizationSlug}/leave`);
  revalidatePath(`/${organizationSlug}/leave/manage`);
  return ok({ id: data.id });
}

export async function deleteHoliday(organizationSlug: string, id: string): Promise<ActionResult> {
  const guard = await guardApprover(organizationSlug);
  if (!guard.ok) return err(guard.code, guard.message, guard.messageKey);
  const { orgId } = guard;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("public_holidays")
    .delete()
    .eq("id", id)
    .eq("organization_id", orgId)
    .select("id");
  if (error) return err("internal", "Failed to delete the holiday.", "hr.errors.internal");
  if ((data ?? []).length === 0) return err("not_found", "That holiday was not found.", "hr.errors.not_found");

  revalidatePath(`/${organizationSlug}/leave`);
  revalidatePath(`/${organizationSlug}/leave/manage`);
  return ok(undefined);
}

export type UpdateLeaveTypeInput = {
  entitlementDays: number | null;
  carryForwardCap: number | null;
  requiresAttachment: boolean;
};

export async function updateLeaveType(
  organizationSlug: string,
  id: string,
  input: UpdateLeaveTypeInput,
): Promise<ActionResult> {
  const guard = await guardApprover(organizationSlug);
  if (!guard.ok) return err(guard.code, guard.message, guard.messageKey);
  const { orgId } = guard;

  if (input.entitlementDays !== null && (!Number.isFinite(input.entitlementDays) || input.entitlementDays < 0)) {
    return err("validation", "Entitlement days must be zero or greater.", "hr.errors.validation");
  }
  if (
    input.carryForwardCap !== null &&
    (!Number.isFinite(input.carryForwardCap) || input.carryForwardCap < 0)
  ) {
    return err("validation", "Carry-forward cap must be zero or greater.", "hr.errors.validation");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("leave_types")
    .update({
      entitlement_days: input.entitlementDays,
      carry_forward_cap: input.carryForwardCap,
      requires_attachment: input.requiresAttachment,
    })
    .eq("id", id)
    .eq("organization_id", orgId)
    .select("id");
  if (error) return err("internal", "Failed to update the leave type.", "hr.errors.internal");
  if ((data ?? []).length === 0) return err("not_found", "That leave type was not found.", "hr.errors.not_found");

  revalidatePath(`/${organizationSlug}/leave`);
  revalidatePath(`/${organizationSlug}/leave/manage`);
  return ok(undefined);
}

export async function closeYear(
  organizationSlug: string,
  year: number,
): Promise<ActionResult<{ inserted: number }>> {
  const guard = await guardApprover(organizationSlug);
  if (!guard.ok) return err(guard.code, guard.message, guard.messageKey);
  const { orgId } = guard;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("close_leave_year", { p_org: orgId, p_year: year });
  if (error) {
    const mapped = leaveRpcError(error.message);
    return err(mapped.code, mapped.message, mapped.messageKey);
  }

  revalidatePath(`/${organizationSlug}/leave`);
  revalidatePath(`/${organizationSlug}/leave/manage`);
  return ok({ inserted: (data as number) ?? 0 });
}
