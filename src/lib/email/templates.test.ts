import { describe, it, expect, beforeAll } from "vitest";

beforeAll(() => {
  process.env.REAUTH_COOKIE_SECRET ??= "test-only-32-byte-secret-do-not-use-prod";
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test";
  process.env.SUPABASE_DB_URL ??= "postgresql://x:x@x/x";
  process.env.RESEND_API_KEY ??= "re_test";
  process.env.EMAIL_FROM ??= "t@t.com";
  process.env.INVITE_BASE_URL ??= "http://localhost:3000";
  process.env.SITE_URL ??= "http://localhost:3000";
  process.env.TOTP_ISSUER ??= "AyamNorliza";
  process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "dummy";
});
import { renderInvite } from "@/lib/email/render-invite";
import { renderBreakGlassUsed } from "@/lib/email/render-break-glass";
import { renderMfaEnrolled } from "@/lib/email/render-mfa-enrolled";
import { renderTemporaryAccessExpiring } from "@/lib/email/render-temporary-access-expiring";
import { renderSupportSessionOpened } from "@/lib/email/render-support-session-opened";

describe("email templates", () => {
  it("renderInvite interpolates fields", () => {
    const { subject, html } = renderInvite({
      organizationName: "AyamNorliza",
      inviterName: "Aiman",
      role: "caretaker",
      acceptUrl: "https://example.com/invite/abc",
      expiresAt: new Date("2026-12-31T00:00:00Z"),
    });
    expect(subject).toContain("AyamNorliza");
    expect(html).toContain("https://example.com/invite/abc");
    expect(html).toContain("caretaker");
  });

  it("renderBreakGlassUsed includes the reason", () => {
    const { html } = renderBreakGlassUsed({
      organizationName: "AyamNorliza",
      userEmail: "x@example.com",
      reason: "Production outage investigation",
      ticketReference: "OPS-1234",
      expiresAt: new Date(),
    });
    expect(html).toContain("Production outage investigation");
    expect(html).toContain("OPS-1234");
  });

  it("renderMfaEnrolled has a subject", () => {
    expect(renderMfaEnrolled({}).subject.length).toBeGreaterThan(0);
  });

  it("renderTemporaryAccessExpiring interpolates organization and expiry", () => {
    const { html } = renderTemporaryAccessExpiring({
      organizationName: "AyamNorliza",
      expiresAt: new Date("2026-12-31T00:00:00Z"),
    });
    expect(html).toContain("AyamNorliza");
  });

  it("renderSupportSessionOpened interpolates purpose", () => {
    const { html } = renderSupportSessionOpened({
      organizationName: "AyamNorliza",
      purpose: "DB migration",
      startsAt: new Date(),
      endsAt: new Date(Date.now() + 3600_000),
    });
    expect(html).toContain("DB migration");
  });

  describe("locale", () => {
    it("renderInvite renders English by default and explicitly", () => {
      const input = {
        organizationName: "AyamNorliza",
        inviterName: "Aiman",
        role: "caretaker",
        acceptUrl: "https://example.com/invite/abc",
        expiresAt: new Date("2026-12-31T00:00:00Z"),
      };
      expect(renderInvite(input).subject).toContain("You are invited to");
      expect(renderInvite({ ...input, locale: "en" }).subject).toContain("You are invited to");
    });

    it("renderInvite renders Bahasa Melayu when locale is ms", () => {
      const { subject, html } = renderInvite({
        organizationName: "AyamNorliza",
        inviterName: "Aiman",
        role: "caretaker",
        acceptUrl: "https://example.com/invite/abc",
        expiresAt: new Date("2026-12-31T00:00:00Z"),
        locale: "ms",
      });
      expect(subject).toContain("Anda dijemput ke");
      expect(html).toContain("Terima jemputan");
    });

    it("renderBreakGlassUsed renders English by default", () => {
      const { subject } = renderBreakGlassUsed({
        organizationName: "AyamNorliza",
        userEmail: "x@example.com",
        reason: "Production outage investigation",
        ticketReference: "OPS-1234",
        expiresAt: new Date(),
      });
      expect(subject).toContain("Break-glass access used");
    });

    it("renderBreakGlassUsed renders Bahasa Melayu when locale is ms", () => {
      const { subject, html } = renderBreakGlassUsed({
        organizationName: "AyamNorliza",
        userEmail: "x@example.com",
        reason: "Production outage investigation",
        ticketReference: "OPS-1234",
        expiresAt: new Date(),
        locale: "ms",
      });
      expect(subject).toContain("Akses break-glass digunakan");
      expect(html).toContain("Rujukan tiket");
    });

    it("renderMfaEnrolled renders English by default", () => {
      expect(renderMfaEnrolled({}).subject).toContain("Two-factor authentication enabled");
    });

    it("renderMfaEnrolled renders Bahasa Melayu when locale is ms", () => {
      expect(renderMfaEnrolled({ locale: "ms" }).subject).toContain("Pengesahan dua faktor diaktifkan");
    });

    it("renderTemporaryAccessExpiring renders English by default", () => {
      const { subject } = renderTemporaryAccessExpiring({
        organizationName: "AyamNorliza",
        expiresAt: new Date("2026-12-31T00:00:00Z"),
      });
      expect(subject).toContain("Temporary access expiring soon");
    });

    it("renderTemporaryAccessExpiring renders Bahasa Melayu when locale is ms", () => {
      const { subject, html } = renderTemporaryAccessExpiring({
        organizationName: "AyamNorliza",
        expiresAt: new Date("2026-12-31T00:00:00Z"),
        locale: "ms",
      });
      expect(subject).toContain("Akses sementara akan luput");
      expect(html).toContain("luput pada");
    });

    it("renderSupportSessionOpened renders English by default", () => {
      const { subject } = renderSupportSessionOpened({
        organizationName: "AyamNorliza",
        purpose: "DB migration",
        startsAt: new Date(),
        endsAt: new Date(Date.now() + 3600_000),
      });
      expect(subject).toContain("Support session opened in");
    });

    it("renderSupportSessionOpened renders Bahasa Melayu when locale is ms", () => {
      const { subject, html } = renderSupportSessionOpened({
        organizationName: "AyamNorliza",
        purpose: "DB migration",
        startsAt: new Date(),
        endsAt: new Date(Date.now() + 3600_000),
        locale: "ms",
      });
      expect(subject).toContain("Sesi sokongan dibuka dalam");
      expect(html).toContain("Tujuan");
    });
  });
});
