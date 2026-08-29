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
  driver: "driver",
  farm_manager: "farm_manager",
  supervisor: "supervisor",
  caretaker: "caretaker",
  veterinarian: "veterinarian",
  biosecurity_qa: "biosecurity_qa",
  maintenance: "maintenance",
  inventory: "inventory",
  logistics: "logistics",
  auditor: "auditor",
  support: "support",
};

export function roleLabelKey(role: string): string {
  return ROLE_LABEL_KEYS[role] ?? role;
}
