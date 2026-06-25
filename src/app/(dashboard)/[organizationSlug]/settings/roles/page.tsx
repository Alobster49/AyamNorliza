import { CAPABILITIES, ROLES } from "@/lib/auth/permissions";

export default function RolesPage() {
  return (
    <section>
      <h1>Roles &amp; permissions</h1>
      <p>Phase 1: read-only. Editing this matrix is owned by MOD-19.</p>
      <table className="data-table">
        <thead>
          <tr>
            <th>Capability</th>
            {ROLES.map((r) => (
              <th key={r}>{r}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {CAPABILITIES.map((c) => (
            <tr key={c}>
              <td><code>{c}</code></td>
              {ROLES.map((r) => (
                <td key={r}>
                  <RoleHasCap role={r} capability={c} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

import { can } from "@/lib/auth/permissions";
function RoleHasCap({ role, capability }: { role: (typeof ROLES)[number]; capability: (typeof CAPABILITIES)[number] }) {
  return can(role, capability) ? "✓" : "";
}
