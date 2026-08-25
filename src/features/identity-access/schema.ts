/**
 * Zod schemas for the identity-access Server Actions.
 *
 * Each schema is the single source of truth for what a Server Action
 * accepts. The same schema is reused by the form components in the UI
 * (and by Vitest in the unit tests) so the same input validation runs
 * client-side and server-side.
 *
 * All durations, identifiers, and free-text lengths are sourced from the
 * plan and the MOD-01 spec; tightening or relaxing them here is a code
 * change, not a docs change.
 */

import { z } from "zod";
import { ROLES } from "@/lib/auth/permissions";

const slugSchema = z
  .string()
  .min(2)
  .max(40)
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/, "invalid slug");

const nameSchema = z.string().min(2).max(150);
const reasonSchema = z.string().min(10).max(1000);

const optionalUuid = z.string().uuid().nullable().optional();
const uuid = z.string().uuid();
const isoTimestamp = z.string().datetime({ offset: true });

const scopeRow = z
  .object({
    siteId: optionalUuid,
    zoneId: optionalUuid,
    houseId: optionalUuid,
    permission: z.string().min(1).max(100).nullable().optional(),
    expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
  })
  .refine(
    (v) =>
      [Boolean(v.siteId), Boolean(v.zoneId), Boolean(v.houseId)].filter(Boolean).length <= 1,
    { message: "scope rows must set at most one of siteId, zoneId, houseId" },
  );

// ---------------------------------------------------------------------------
// Organization
// ---------------------------------------------------------------------------
export const CreateOrganizationInput = z.object({
  slug: slugSchema,
  name: nameSchema,
  legalName: z.string().max(200).nullable().optional(),
  region: z.string().max(50).nullable().optional(),
  defaultTimeZone: z
    .string()
    .regex(/^[A-Za-z]+\/[A-Za-z_]+$|^UTC$/, "invalid IANA time zone")
    .default("UTC"),
  defaultLocale: z.string().min(2).max(10).default("en"),
});
export type CreateOrganizationInput = z.infer<typeof CreateOrganizationInput>;

export const UpdateOrganizationInput = z.object({
  organizationId: uuid,
  name: nameSchema.optional(),
  legalName: z.string().max(200).nullable().optional(),
  region: z.string().max(50).nullable().optional(),
  defaultTimeZone: z
    .string()
    .regex(/^[A-Za-z]+\/[A-Za-z_]+$|^UTC$/)
    .optional(),
  defaultLocale: z.string().min(2).max(10).optional(),
});
export type UpdateOrganizationInput = z.infer<typeof UpdateOrganizationInput>;

// ---------------------------------------------------------------------------
// Membership / invitations
// ---------------------------------------------------------------------------
export const InviteUserInput = z.object({
  organizationId: uuid,
  email: z.string().email().max(254),
  role: z.enum(ROLES),
  scopes: z.array(scopeRow).max(50).default([]),
  expiresAt: z.string().datetime({ offset: true }).optional(),
  clientOperationId: uuid.optional(),
});
export type InviteUserInput = z.infer<typeof InviteUserInput>;

export const ResendInvitationInput = z.object({
  invitationId: uuid,
});
export type ResendInvitationInput = z.infer<typeof ResendInvitationInput>;

export const RevokeInvitationInput = z.object({
  invitationId: uuid,
});
export type RevokeInvitationInput = z.infer<typeof RevokeInvitationInput>;

export const AcceptInvitationInput = z.object({
  token: z.string().min(20).max(200),
  displayName: z.string().min(1).max(150).optional(),
  clientOperationId: uuid.optional(),
});
export type AcceptInvitationInput = z.infer<typeof AcceptInvitationInput>;

export const ChangeRoleInput = z.object({
  memberId: uuid,
  newRole: z.enum(ROLES),
  reason: reasonSchema,
  approverUserId: uuid.optional(),
});
export type ChangeRoleInput = z.infer<typeof ChangeRoleInput>;

export const ChangeScopeInput = z.object({
  memberId: uuid,
  scopes: z.array(scopeRow).max(50),
  reason: reasonSchema,
});
export type ChangeScopeInput = z.infer<typeof ChangeScopeInput>;

export const DeactivateUserInput = z.object({
  memberId: uuid,
  reason: reasonSchema,
  transferToMemberId: uuid.optional(),
});
export type DeactivateUserInput = z.infer<typeof DeactivateUserInput>;

export const UpdateMemberProfileInput = z
  .object({
    memberId: uuid,
    displayName: z.string().min(1).max(150).optional(),
    email: z.string().email().max(254).optional(),
    reason: reasonSchema,
  })
  .refine((v) => v.displayName !== undefined || v.email !== undefined, {
    message: "Provide a display name or an email to update",
  });
export type UpdateMemberProfileInput = z.infer<typeof UpdateMemberProfileInput>;

export const SendPasswordResetInput = z.object({
  memberId: uuid,
});
export type SendPasswordResetInput = z.infer<typeof SendPasswordResetInput>;

export const RemoveMemberInput = z.object({
  memberId: uuid,
  reason: reasonSchema,
});
export type RemoveMemberInput = z.infer<typeof RemoveMemberInput>;

export const CreateUserInput = z.object({
  organizationId: uuid,
  email: z.string().email().max(254),
  displayName: z.string().min(1).max(150),
  role: z.enum(ROLES),
  clientOperationId: uuid.optional(),
});
export type CreateUserInput = z.infer<typeof CreateUserInput>;

// ---------------------------------------------------------------------------
// Access reviews
// ---------------------------------------------------------------------------
export const StartAccessReviewInput = z.object({
  organizationId: uuid,
  periodStart: isoTimestamp,
  periodEnd: isoTimestamp,
  dueAt: isoTimestamp,
  reviewerId: uuid,
});
export type StartAccessReviewInput = z.infer<typeof StartAccessReviewInput>;

export const DecideReviewItemInput = z.object({
  itemId: uuid,
  decision: z.enum(["keep", "modify", "revoke"]),
  decisionReason: z.string().max(1000).optional(),
  evidence: z.record(z.string(), z.unknown()).default({}),
});
export type DecideReviewItemInput = z.infer<typeof DecideReviewItemInput>;

// ---------------------------------------------------------------------------
// Support sessions
// ---------------------------------------------------------------------------
export const OpenSupportSessionInput = z
  .object({
    organizationId: uuid,
    sponsorId: uuid,
    technicianId: uuid,
    purpose: z.string().min(5).max(500),
    permittedScopes: z
      .array(z.object({ permission: z.string().min(1).max(100), resource: z.string().min(1).max(200) }))
      .max(20)
      .default([]),
    startsAt: isoTimestamp,
    endsAt: isoTimestamp,
    recordingReference: z.string().max(200).nullable().optional(),
  })
  .refine((v) => new Date(v.endsAt).getTime() > new Date(v.startsAt).getTime(), {
    message: "endsAt must be after startsAt",
    path: ["endsAt"],
  })
  .refine(
    (v) =>
      new Date(v.endsAt).getTime() - new Date(v.startsAt).getTime() <=
      24 * 60 * 60 * 1000,
    { message: "support session cannot exceed 24 hours", path: ["endsAt"] },
  );
export type OpenSupportSessionInput = z.infer<typeof OpenSupportSessionInput>;

export const EndSupportSessionInput = z.object({
  sessionId: uuid,
  reason: reasonSchema.optional(),
  revokeMembership: z.boolean().default(false),
});
export type EndSupportSessionInput = z.infer<typeof EndSupportSessionInput>;

// ---------------------------------------------------------------------------
// Break-glass
// ---------------------------------------------------------------------------
export const OpenBreakGlassInput = z
  .object({
    organizationId: uuid,
    reason: z.string().min(10).max(500),
    ticketReference: z.string().max(100).nullable().optional(),
    approvedBy: uuid.nullable().optional(),
    durationMinutes: z.number().int().min(1).max(60).default(30),
  })
  .refine(
    (v) => !(v.approvedBy && v.approvedBy.length > 0 && v.approvedBy !== ""),
    { message: "approvedBy must be omitted or a valid uuid" },
  );
export type OpenBreakGlassInput = z.infer<typeof OpenBreakGlassInput>;

export const EndBreakGlassInput = z.object({
  eventId: uuid,
});
export type EndBreakGlassInput = z.infer<typeof EndBreakGlassInput>;

export const FinalizeBreakGlassReviewInput = z.object({
  eventId: uuid,
  postUseReview: z.object({
    summary: z.string().min(10).max(2000),
    actionsTaken: z.array(z.string().min(1).max(500)).min(1).max(50),
    followUp: z.string().max(2000).optional(),
  }),
});
export type FinalizeBreakGlassReviewInput = z.infer<typeof FinalizeBreakGlassReviewInput>;

// ---------------------------------------------------------------------------
// Re-auth
// ---------------------------------------------------------------------------
export const ReauthInput = z.object({
  password: z.string().min(1).max(200),
  totpCode: z
    .string()
    .regex(/^\d{6}$/u, "TOTP code must be 6 digits")
    .optional(),
});
export type ReauthInput = z.infer<typeof ReauthInput>;

// ---------------------------------------------------------------------------
// Auth (login / MFA enroll / MFA verify)
// ---------------------------------------------------------------------------
export const LoginInput = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(200),
});
export type LoginInput = z.infer<typeof LoginInput>;

export const MfaEnrollInput = z.object({});
export type MfaEnrollInput = z.infer<typeof MfaEnrollInput>;

export const MfaChallengeInput = z.object({
  factorId: uuid,
  code: z.string().regex(/^\d{6}$/u, "TOTP code must be 6 digits"),
});
export type MfaChallengeInput = z.infer<typeof MfaChallengeInput>;
