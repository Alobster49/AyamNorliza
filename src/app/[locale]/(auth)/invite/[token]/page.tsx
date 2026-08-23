import { redirect } from "next/navigation";
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
  if (!token) redirect("/login");

  // The server action invokes the Edge Function. Show a small
  // "processing..." UI while it runs and then redirect to the org.
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    // Force the user to sign in / sign up first; the action will
    // create the auth.users row on first accept.
    redirect(`/login?next=/invite/${encodeURIComponent(token)}`);
  }

  const result = await acceptInvitationAction({ token, displayName: user.user_metadata?.display_name });
  if (!result.ok) {
    return (
      <main className="auth-page">
        <div className="flex justify-end">
          <LocaleSwitcher />
        </div>
        <section>
          <h1>Could not accept invitation</h1>
          <p role="alert">{result.message}</p>
        </section>
      </main>
    );
  }
  redirect(`/`);
  // hashToken import retained to keep the function-side hash in the bundle.
  void hashToken;
}
