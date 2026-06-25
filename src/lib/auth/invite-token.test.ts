import { describe, it, expect } from "vitest";
import { newInvitationToken, hashToken, verifyToken } from "@/lib/auth/invite-token";

describe("invitation tokens", () => {
  it("generates a 32-byte base64url token", () => {
    const t = newInvitationToken();
    expect(t.raw.length).toBeGreaterThanOrEqual(40);
    expect(t.hash.length).toBeGreaterThanOrEqual(40);
  });

  it("hashes are deterministic and distinct from raw", () => {
    const t = newInvitationToken();
    expect(hashToken(t.raw)).toBe(t.hash);
    expect(verifyToken(t.raw, t.hash)).toBe(true);
    expect(verifyToken(t.raw, "wronghash")).toBe(false);
  });

  it("tokens are unique across calls", () => {
    const set = new Set<string>();
    for (let i = 0; i < 50; i += 1) {
      set.add(newInvitationToken().raw);
    }
    expect(set.size).toBe(50);
  });
});
