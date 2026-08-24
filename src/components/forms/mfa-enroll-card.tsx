"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { startMfaEnrollAction, verifyMfaChallengeAction, unenrollMfaAction } from "@/features/identity-access/server/auth-actions";
import { toLocaleAgnostic } from "@/lib/auth/next-path";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";

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
  const tRoot = useTranslations();
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
      // `messageKey` is a dynamic full path (e.g. "errors.identity.common.unauthenticated");
      // next-intl's typed `t()` only accepts literal keys, so this is cast at the call site.
      setError(tRoot(result.messageKey as never));
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
      setError(tRoot(result.messageKey as never));
      return;
    }
    // `nextPath` comes in from the server page's `?next=` query read. This
    // router is the i18n one, which adds its own locale prefix
    // unconditionally - `toLocaleAgnostic` re-validates and strips any
    // existing prefix so it isn't doubled up.
    router.push(toLocaleAgnostic(nextPath) ?? "/mfa");
  }

  async function skip() {
    // See `verify()` above.
    router.push(toLocaleAgnostic(nextPath) ?? "/mfa");
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
  const t = useTranslations("auth.mfa");
  const tRoot = useTranslations();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [removed, setRemoved] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const totp = factors.find((f) => f.friendly_name);
  const router = useRouter();

  async function performRemove() {
    if (!totp) return;
    setError(null);
    setPending(true);
    const result = await unenrollMfaAction({ factorId: totp.id });
    setPending(false);
    if (!result.ok) {
      setError(tRoot(result.messageKey as never));
      return;
    }
    setRemoved(true);
  }

  const strong = (chunks: React.ReactNode) => <strong>{chunks}</strong>;

  if (removed) {
    return (
      <div className="mfa-status">
        <h3>{t("title")}</h3>
        <p className="mfa-status__off">
          {t.rich("statusDisabled", { strong })}
        </p>
        <button
          type="button"
          onClick={() => router.push("/mfa")}
        >
          {t("enableButton")}
        </button>
      </div>
    );
  }

  return (
    <div className="mfa-status">
      <h3>{t("title")}</h3>
      {totp ? (
        <>
          <p className="mfa-status__on">
            {t.rich("statusEnabled", { strong })}
          </p>
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            disabled={pending}
            className="btn-danger"
          >
            {pending ? t("removing") : t("removeButton")}
          </button>
          <ConfirmDialog
            open={confirmOpen}
            onOpenChange={(next) => {
              if (!next) setConfirmOpen(false);
            }}
            title={t("removeTitle")}
            description={t("removeConfirm")}
            confirmLabel={t("removeAction")}
            onConfirm={performRemove}
          />
        </>
      ) : (
        <>
          <p className="mfa-status__off">
            {t.rich("statusDisabled", { strong })}
          </p>
          <button
            type="button"
            onClick={() => router.push(toLocaleAgnostic(nextPath) ?? "/mfa")}
          >
            {t("enableButton")}
          </button>
        </>
      )}
      {error ? <p role="alert" className="auth-form__error">{error}</p> : null}
    </div>
  );
}
