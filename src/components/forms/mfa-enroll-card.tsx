"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { startMfaEnrollAction, verifyMfaChallengeAction, unenrollMfaAction } from "@/features/identity-access/server/auth-actions";
import { stripLocalePrefix } from "@/lib/auth/next-path";

export interface EnrolledFactor {
  factorId: string;
  qrCode: string | null;
  secret: string | null;
  uri: string | null;
}

interface MfaEnrollCardProps {
  /** When true, shows a "Skip for now" button instead of "Remove" */
  isOptional?: boolean;
  /** Destination after successful enrollment / skip (defaults to "/") */
  nextPath?: string;
}

export function MfaEnrollCard({ isOptional = false, nextPath = "/" }: MfaEnrollCardProps) {
  const t = useTranslations("auth.mfa");
  const router = useRouter();
  const [enrolled, setEnrolled] = useState<EnrolledFactor | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function enroll() {
    setError(null);
    setPending(true);
    const result = await startMfaEnrollAction();
    setPending(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setEnrolled(result.data);
  }

  async function verify() {
    if (!enrolled) return;
    setError(null);
    setPending(true);
    const result = await verifyMfaChallengeAction({ factorId: enrolled.factorId, code });
    setPending(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    // `nextPath` comes in already sanitized (locale prefix intact) from the
    // server page. This router is the i18n one, which adds its own prefix
    // unconditionally - strip the existing one first so it isn't doubled.
    router.push(stripLocalePrefix(nextPath));
  }

  async function skip() {
    // `nextPath` comes in already sanitized (locale prefix intact) from the
    // server page. This router is the i18n one, which adds its own prefix
    // unconditionally - strip the existing one first so it isn't doubled.
    router.push(stripLocalePrefix(nextPath));
  }

  async function remove(factorId: string) {
    if (!confirm("Are you sure you want to remove two-factor authentication? Your account will be less secure.")) {
      return;
    }
    setError(null);
    setPending(true);
    const result = await unenrollMfaAction({ factorId });
    setPending(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setEnrolled(null);
  }

  return (
    <section className="mfa-enroll">
      <h2>{t("title")}</h2>
      {enrolled ? (
        <div>
          <p>{t("qrInstructions")}</p>
          {enrolled.qrCode ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img alt={t("qrAlt")} src={enrolled.qrCode} width={180} height={180} />
          ) : null}
          {enrolled.secret ? <code>{enrolled.secret}</code> : null}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              verify();
            }}
          >
            <label>
              {t("codeLabel")}
              <input
                inputMode="numeric"
                pattern="\d{6}"
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
                maxLength={6}
              />
            </label>
            {error ? <p role="alert">{error}</p> : null}
            <button type="submit" disabled={pending || code.length !== 6}>
              {pending ? t("submitting") : t("submit")}
            </button>
            {isOptional && (
              <button
                type="button"
                className="btn-secondary"
                onClick={skip}
                disabled={pending}
              >
                {t("cancel")}
              </button>
            )}
          </form>
        </div>
      ) : (
        <div>
          <p>
            {isOptional
              ? t("notEnrolledOptional")
              : t("notEnrolledRequired")}
          </p>
          {error ? <p role="alert">{error}</p> : null}
          <div className="mfa-enroll__actions">
            <button type="button" onClick={enroll} disabled={pending}>
              {pending ? t("setupPending") : t("setup")}
            </button>
            {isOptional && (
              <button
                type="button"
                className="btn-secondary"
                onClick={skip}
                disabled={pending}
              >
                {t("skip")}
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

/** Compact card for the security settings page — shows enrolled factor with a remove option. */
export function MfaStatusCard({
  factors,
  nextPath,
}: {
  factors: { id: string; friendly_name: string | null; created_at: string }[];
  nextPath?: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [removed, setRemoved] = useState(false);
  const totp = factors.find((f) => f.friendly_name);
  const router = useRouter();

  async function remove() {
    if (!totp) return;
    if (!confirm("Are you sure you want to remove two-factor authentication? Your account will be less secure.")) {
      return;
    }
    setError(null);
    setPending(true);
    const result = await unenrollMfaAction({ factorId: totp.id });
    setPending(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setRemoved(true);
  }

  if (removed) {
    return (
      <div className="mfa-status">
        <h3>Two-factor authentication</h3>
        <p className="mfa-status__off">
          Two-factor authentication is currently <strong>disabled</strong>.
        </p>
        <button
          type="button"
          onClick={() => router.push("/mfa")}
        >
          Enable two-factor authentication
        </button>
      </div>
    );
  }

  return (
    <div className="mfa-status">
      <h3>Two-factor authentication</h3>
      {totp ? (
        <>
          <p className="mfa-status__on">
            Two-factor authentication is <strong>enabled</strong> using your authenticator app.
          </p>
          <button type="button" onClick={remove} disabled={pending} className="btn-danger">
            {pending ? "Removing..." : "Remove authenticator app"}
          </button>
        </>
      ) : (
        <>
          <p className="mfa-status__off">
            Two-factor authentication is currently <strong>disabled</strong>.
          </p>
          <button
            type="button"
            onClick={() =>
              router.push(nextPath ? stripLocalePrefix(nextPath) : "/mfa")
            }
          >
            Enable two-factor authentication
          </button>
        </>
      )}
      {error ? <p role="alert" className="auth-form__error">{error}</p> : null}
    </div>
  );
}
