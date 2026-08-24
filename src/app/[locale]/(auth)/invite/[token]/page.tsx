import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { acceptInvitationAction } from "@/features/identity-access/server/actions";
import { LocaleSwitcher } from "@/components/shared/locale-switcher";
import { hashToken } from "@/lib/auth/invite-token";

/**
 * Invitation acceptance page.
 *
 * The link in the invite email is `/invite/<raw-token>`. We hash the
 * token client-side (handled by the Edge Function) and call the
 * invitation-accept Edge Function. For Phase 1 simplicity we call the
 * server action instead, which forwards to the Edge Function.
 */
export default async function InviteAcceptPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const locale = await getLocale();
  // Locale-prefixed explicitly (same pattern as `requireUserOrRedirect`):
  // this file keeps `next/navigation`'s `redirect()` via a targeted eslint
  // exemption (see eslint.config.mjs) since it already builds `/${locale}`
  // itself - `@/i18n/navigation`'s redirect would double-prefix it.
  if (!token) redirect(`/${locale}/login`);

  // The server action invokes the Edge Function. Show a small
  // "processing..." UI while it runs and then redirect to the org.
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    // Force the user to sign in / sign up first; the action will
    // create the auth.users row on first accept.
    redirect(`/${locale}/login?next=/invite/${encodeURIComponent(token)}`);
  }

  const result = await acceptInvitationAction({ token, displayName: user.user_metadata?.display_name });
  if (!result.ok) {
    const [t, tRoot] = await Promise.all([getTranslations("auth.invite"), getTranslations()]);
    return (
      <main className="auth-page">
        <div className="flex justify-end">
          <LocaleSwitcher />
        </div>
        <section>
          <h1>{t("failureTitle")}</h1>
          {/* `messageKey` is a dynamic full path (e.g. "errors.identity.invite.expired");
              next-intl's typed `t()` only accepts literal keys, so this is cast at the call site. */}
          <p role="alert">{tRoot(result.messageKey as never)}</p>
        </section>
      </main>
    );
  }
  redirect(`/${locale}`);
  // hashToken import retained to keep the function-side hash in the bundle.
  void hashToken;
}
