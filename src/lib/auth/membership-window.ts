/**
 * One definition of "this membership is live right now", shared by every
 * app-layer guard.
 *
 * The database has always answered this question the same way — roughly
 * forty RLS policies, from the order pipeline through HR leave, all read
 * `status = 'active' and (expires_at is null or expires_at > now())`. The
 * app layer had drifted into two different answers: most guards checked
 * only `status = 'active'`, which kept letting an expired temporary member
 * through, while `requireOrgMember` demanded `expires_at is null`, which
 * locked out a temporary member who still had days left. Both are fixed by
 * routing every membership lookup through this filter.
 *
 * Callers pair it with the status check, since `.or()` covers only the
 * expiry branch:
 *
 *     .eq("status", "active").or(activeMembershipWindow())
 */

/**
 * A PostgREST `or()` filter matching memberships that have not expired:
 * no expiry set, or an expiry still in the future.
 *
 * The cutoff is this server's clock rather than the database's `now()`,
 * which PostgREST cannot express in a filter. Any skew only matters within
 * a second or so of the exact expiry instant, and the RLS policies re-check
 * the same condition against the real `now()` before any row is returned.
 */
export function activeMembershipWindow(): string {
  return `expires_at.is.null,expires_at.gt.${new Date().toISOString()}`;
}
