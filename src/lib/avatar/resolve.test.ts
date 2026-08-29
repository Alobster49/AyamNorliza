import { describe, expect, it } from "vitest";
import { AVATAR_PRESET_IDS, presetUrl } from "./presets";
import { resolveAvatar } from "./resolve";

const USER_A = "3f1c9a2e-0000-4000-8000-000000000001";
const USER_B = "9b7d5c4a-0000-4000-8000-000000000002";

describe("resolveAvatar", () => {
  it("resolves preset values to the bundled SVG url", () => {
    expect(resolveAvatar("preset:face-07", USER_A)).toEqual({
      kind: "preset",
      url: "/avatars/presets/face-07.svg",
    });
  });

  it("resolves upload values to the storage path", () => {
    expect(resolveAvatar("upload:abc/avatar.png", USER_A)).toEqual({
      kind: "upload",
      path: "abc/avatar.png",
    });
  });

  it("seeds a stable default preset from the user id when null", () => {
    const first = resolveAvatar(null, USER_A);
    const again = resolveAvatar(null, USER_A);
    expect(first).toEqual(again);
    expect(first.kind).toBe("preset");
    if (first.kind === "preset") {
      expect(AVATAR_PRESET_IDS.some((id) => first.url === presetUrl(id))).toBe(true);
    }
  });

  it("spreads different users across presets", () => {
    expect(resolveAvatar(null, USER_A)).not.toEqual(resolveAvatar(null, USER_B));
  });

  it("falls back to the seeded default on unknown preset ids and malformed values", () => {
    expect(resolveAvatar("preset:not-a-real-id", USER_A)).toEqual(
      resolveAvatar(null, USER_A),
    );
    expect(resolveAvatar("garbage", USER_A)).toEqual(resolveAvatar(null, USER_A));
  });
});
