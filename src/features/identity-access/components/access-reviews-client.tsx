"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { startAccessReviewAction, decideReviewItemAction } from "@/features/identity-access/server/actions";
import type { AccessReview, AccessReviewItem, OrganizationMember } from "../types";

export function AccessReviewsClient(props: {
  organizationId: string;
  reviews: AccessReview[];
  members: OrganizationMember[];
  itemsByReview: Record<string, AccessReviewItem[]>;
}) {
  const router = useRouter();
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
      setError(result.message);
      return;
    }
    router.refresh();
  }

  async function decide(itemId: string, decision: "keep" | "modify" | "revoke") {
    setError(null);
    const result = await decideReviewItemAction({ itemId, decision });
    if (!result.ok) {
      setError(result.message);
      return;
    }
    router.refresh();
  }

  return (
    <div>
      <button type="button" onClick={start} disabled={pending}>
        {pending ? "Starting..." : "Start quarterly review"}
      </button>
      {error ? <p role="alert">{error}</p> : null}
      {props.reviews.map((r) => (
        <article key={r.id} className="review">
          <h2>
            Review {r.id.slice(0, 8)} - {r.status}
          </h2>
          <p>Due: {new Date(r.dueAt).toLocaleString()}</p>
          <table className="data-table">
            <thead>
              <tr>
                <th>Member</th>
                <th>Decision</th>
                <th>Decided at</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {(props.itemsByReview[r.id] ?? []).map((item) => {
                const member = props.members.find((m) => m.id === item.organizationMemberId);
                return (
                  <tr key={item.id}>
                    <td><code>{member?.userId ?? item.organizationMemberId}</code></td>
                    <td>{item.decision}</td>
                    <td>{item.decidedAt ? new Date(item.decidedAt).toLocaleString() : "-"}</td>
                    <td>
                      <button type="button" onClick={() => decide(item.id, "keep")}>Keep</button>
                      <button type="button" onClick={() => decide(item.id, "modify")}>Modify</button>
                      <button type="button" onClick={() => decide(item.id, "revoke")}>Revoke</button>
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
