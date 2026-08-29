/**
 * Message-catalog keys (scoped to the `roles` namespace) for known role
 * values. Resolve with `useTranslations("roles")` / `getTranslations`, e.g.
 * `t(roleLabelKey(role))`.
 */
const ROLE_LABEL_KEYS: Record<string, string> = {
  owner: "owner",
  org_admin: "org_admin",
  hr: "hr",
  seller: "seller",
  supervisor: "supervisor",
  driver: "driver",
  inventory: "inventory",
};

export function roleLabelKey(role: string): string {
  return ROLE_LABEL_KEYS[role] ?? role;
}
