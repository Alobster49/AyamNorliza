import { AVATAR_PRESET_IDS, presetUrl } from "./presets";

export type ResolvedAvatar =
  | { kind: "preset"; url: string }
  | { kind: "upload"; path: string };

// FNV-1a — cheap, stable, spreads uuids evenly across the preset list.
function hash(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function seededPreset(userId: string): ResolvedAvatar {
  const id = AVATAR_PRESET_IDS[hash(userId) % AVATAR_PRESET_IDS.length] ?? "face-01";
  return { kind: "preset", url: presetUrl(id) };
}

/**
 * Resolve a profiles.avatar value to something renderable.
 * Unknown preset ids and malformed values fall back to the seeded default
 * rather than a broken image.
 */
export function resolveAvatar(
  avatar: string | null | undefined,
  userId: string,
): ResolvedAvatar {
  if (avatar?.startsWith("preset:")) {
    const id = avatar.slice("preset:".length);
    if (AVATAR_PRESET_IDS.includes(id)) {
      return { kind: "preset", url: presetUrl(id) };
    }
    return seededPreset(userId);
  }
  if (avatar?.startsWith("upload:")) {
    const path = avatar.slice("upload:".length);
    if (path) return { kind: "upload", path };
  }
  return seededPreset(userId);
}
