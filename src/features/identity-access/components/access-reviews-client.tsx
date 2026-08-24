"use client";

import { useState } from "react";
import { useTranslations, useFormatter } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { startAccessReviewAction, decideReviewItemAction } from "@/features/identity-access/server/actions";
import type { AccessReview, AccessReviewItem, OrganizationMember } from "../types";

const DECISION_KEYS = {
  keep: "keep",
  modify: "modify",
  revoke: "revoke",
  pending: "pending",
} as const;

export function AccessReviewsClient(props: {
  organizationId: string;
  reviews: AccessReview[];
  members: OrganizationMember[];
  itemsByReview: Record<string, AccessReviewItem[]>;
}) {
  const router = useRouter();
  const t = useTranslations("identity.accessReviews");
  const tRoot = useTranslations();
  const format = useFormatter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function start() {
    setError(null);
    setPending(true);
    const result = await startAccessReviewAction({
      organizationId: props.organizationId,
      periodStart: new Date().toISOString(),
      periodEnd: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
      dueAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
      reviewerId: props.members[0]?.userId ?? "",
    });
    setPending(false);
    if (!result.ok) {
      // `messageKey` is a dynamic full path (e.g. "errors.identity.common.forbidden");
      // next-intl's typed `t()` only accepts literal keys, so this is cast at the call site.
      setError(tRoot(result.messageKey as never));
      return;
    }
    router.refresh();
  }

  async function decide(itemId: string, decision: "keep" | "modify" | "revoke") {
    setError(null);
    const result = await decideReviewItemAction({ itemId, decision });
    if (!result.ok) {
      setError(tRoot(result.messageKey as never));
      return;
    }
    router.refresh();
  }

  return (
    <div>
      <button type="button" onClick={start} disabled={pending}>
        {pending ? t("starting") : t("startReview")}
      </button>
      {error ? <p role="alert">{error}</p> : null}
      {props.reviews.map((r) => (
        <article key={r.id} className="review">
          <h2>
            {t("reviewHeading", { id: r.id.slice(0, 8), status: r.status })}
          </h2>
          <p>{t("due", { date: format.dateTime(new Date(r.dueAt), { dateStyle: "medium", timeStyle: "short" }) })}</p>
          <table className="data-table">
            <thead>
              <tr>
                <th>{t("colMember")}</th>
                <th>{t("colDecision")}</th>
                <th>{t("colDecidedAt")}</th>
                <th>{t("colActions")}</th>
              </tr>
            </thead>
            <tbody>
              {(props.itemsByReview[r.id] ?? []).map((item) => {
                const member = props.members.find((m) => m.id === item.organizationMemberId);
                return (
                  <tr key={item.id}>
                    <td><code>{member?.userId ?? item.organizationMemberId}</code></td>
                    <td>{t(`decision.${DECISION_KEYS[item.decision]}`)}</td>
                    <td>
                      {item.decidedAt
                        ? format.dateTime(new Date(item.decidedAt), { dateStyle: "medium", timeStyle: "short" })
                        : t("notDecided")}
                    </td>
                    <td>
                      <button type="button" onClick={() => decide(item.id, "keep")}>{t("decision.keep")}</button>
                      <button type="button" onClick={() => decide(item.id, "modify")}>{t("decision.modify")}</button>
                      <button type="button" onClick={() => decide(item.id, "revoke")}>{t("decision.revoke")}</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </article>
      ))}
    </div>
  );
}
