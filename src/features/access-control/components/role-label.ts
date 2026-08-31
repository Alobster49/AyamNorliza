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

/**
 * True for a seeded system role key (owner, org_admin, hr, seller,
 * supervisor, driver, inventory) -- the only keys the `roles` message
 * catalog has entries for. A dynamic-RBAC picker rendering
 * `organization_roles` rows uses this to decide whether a row's `name`
 * (the org-authored display string, right for a custom role) or its i18n
 * label (right for a system role, kept translated in both locales) is the
 * correct thing to show -- see `roleDisplayLabel`.
 */
export function isKnownRoleKey(key: string): boolean {
  return key in ROLE_LABEL_KEYS;
}

/**
 * The label to show for an `organization_roles` row: the translated
 * catalog string for a system role (`isSystem`), the org-authored `name`
 * for a custom one. `tRoles` is the `useTranslations("roles")` /
 * `getTranslations("roles")` instance already in scope at each call site.
 */
export function roleDisplayLabel(
  tRoles: (key: never) => string,
  role: { key: string; name: string; isSystem: boolean },
): string {
  return role.isSystem && isKnownRoleKey(role.key) ? tRoles(roleLabelKey(role.key) as never) : role.name;
}
