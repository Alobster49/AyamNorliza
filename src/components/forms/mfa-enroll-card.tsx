"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { startMfaEnrollAction, verifyMfaChallengeAction, unenrollMfaAction } from "@/features/identity-access/server/auth-actions";

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
    router.push(nextPath);
  }

  async function skip() {
    router.push(nextPath);
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
      <h2>Two-factor authentication</h2>
      {enrolled ? (
        <div>
          <p>Scan this QR code with your authenticator app, then enter the 6-digit code.</p>
          {enrolled.qrCode ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img alt="TOTP QR code" src={enrolled.qrCode} width={180} height={180} />
          ) : null}
          {enrolled.secret ? <code>{enrolled.secret}</code> : null}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              verify();
            }}
          >
            <label>
              Code
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
              {pending ? "Verifying..." : "Verify and enable"}
            </button>
            {isOptional && (
              <button
                type="button"
                className="btn-secondary"
                onClick={skip}
                disabled={pending}
              >
                Cancel
              </button>
            )}
          </form>
        </div>
      ) : (
        <div>
          <p>
            {isOptional
              ? "Add an authenticator app to protect your account with an extra layer of security. You can skip for now and enable it later from your security settings."
              : "Add an authenticator app to protect your account."}
          </p>
          {error ? <p role="alert">{error}</p> : null}
          <div className="mfa-enroll__actions">
            <button type="button" onClick={enroll} disabled={pending}>
              {pending ? "Starting..." : "Set up authenticator app"}
            </button>
            {isOptional && (
              <button
                type="button"
                className="btn-secondary"
                onClick={skip}
                disabled={pending}
              >
                Skip for now
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
            onClick={() => router.push(nextPath ?? "/mfa")}
          >
            Enable two-factor authentication
          </button>
        </>
      )}
      {error ? <p role="alert" className="auth-form__error">{error}</p> : null}
    </div>
  );
}
