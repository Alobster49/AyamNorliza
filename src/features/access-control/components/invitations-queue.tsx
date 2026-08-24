import { getTranslations } from "next-intl/server";
import type { Invitation } from "@/features/identity-access/types";
import { roleLabelKey } from "./role-label";

/**
 * Pending invitations queue. Shows the invitations that have not yet been
 * accepted or revoked — at-a-glance info, no actions yet (per MOD-19).
 */
export async function InvitationsQueue({
  invitations,
}: {
  invitations: ReadonlyArray<Invitation>;
}) {
  const pending = invitations.filter(
    (i) => i.acceptedAt == null && i.revokedAt == null,
  );
  const accepted = invitations.filter((i) => i.acceptedAt != null).length;
  const revoked = invitations.filter((i) => i.revokedAt != null).length;
  const [t, tRoles] = await Promise.all([
    getTranslations("identity.invitationsQueue"),
    getTranslations("roles"),
  ]);

  return (
    <section
      aria-labelledby="invitations-heading"
      className="border-t border-foreground/10 pt-12"
    >
      <div className="flex items-baseline justify-between">
        <h2
          id="invitations-heading"
          className="font-display text-3xl leading-none"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {t("heading")}
        </h2>
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
          {t("summary", { pending: pending.length, accepted, revoked })}
        </p>
      </div>
      <p className="mt-2 max-w-prose text-sm text-muted-foreground">
        {t("description")}
      </p>

      {pending.length === 0 ? (
        <p className="mt-6 rounded-sm border border-dashed border-foreground/15 px-4 py-6 text-center text-sm text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <ul className="mt-6 divide-y divide-foreground/10 border-y border-foreground/10">
          {pending.map((invite) => (
            <li
              key={invite.id}
              className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-3"
            >
              <span className="font-medium">{invite.email}</span>
              <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                {tRoles(roleLabelKey(invite.role))}
              </span>
              <span className="ml-auto font-mono text-xs tabular-nums text-muted-foreground">
                {t("expires", { date: invite.expiresAt?.slice(0, 10) ?? "—" })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
