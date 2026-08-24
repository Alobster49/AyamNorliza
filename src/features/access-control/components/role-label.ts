/** Shared role formatting for the access-control feature. */
export function roleLabel(role: string): string {
  return role
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/**
 * Message-catalog keys (scoped to the `roles` namespace) for known role
 * values. Resolve with `useTranslations("roles")` / `getTranslations`, e.g.
 * `t(roleLabelKey(role))`.
 *
 * `roleLabel` above stays as-is (still returns English text) so consumers
 * that have not been converted to `next-intl` yet keep compiling and
 * rendering correctly; new/converted consumers should prefer this map.
 */
const ROLE_LABEL_KEYS: Record<string, string> = {
  owner: "owner",
  org_admin: "org_admin",
  seller: "seller",
  driver: "driver",
  inventory: "inventory",
  logistics: "logistics",
};

export function roleLabelKey(role: string): string {
  return ROLE_LABEL_KEYS[role] ?? role;
}
