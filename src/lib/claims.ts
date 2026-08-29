/**
 * Advisory-claim expiry shared by the loading board (orders.loading_claimed_*)
 * and the weigh queue (order_tasks.weigh_claimed_*). A claim is an advisory
 * lock with a TTL, not workflow state: expired means unclaimed everywhere.
 */
export const CLAIM_TTL_MS = 10 * 60 * 1000;

export function isClaimActive(claimedAt: string | null, nowMs: number): boolean {
  if (claimedAt === null) return false;
  const at = Date.parse(claimedAt);
  return Number.isFinite(at) && nowMs - at < CLAIM_TTL_MS;
}
