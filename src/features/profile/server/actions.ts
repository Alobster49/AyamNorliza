"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AVATAR_PRESET_IDS } from "@/lib/avatar/presets";

const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
const ALLOWED_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export type UpdateProfileResult =
  | { ok: true }
  | { ok: false; error: "validation" | "unauthenticated" | "upload" | "internal" };

/**
 * Self-service profile update: display name + avatar choice.
 *
 * FormData fields:
 *   displayName  1..150 chars
 *   avatar       "preset:<id>" | "upload" (file field must be set) | "" (keep seeded default)
 *   file         image file when avatar === "upload"
 */
export async function updateProfileAction(
  formData: FormData,
): Promise<UpdateProfileResult> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "unauthenticated" };

  const displayName = String(formData.get("displayName") ?? "").trim();
  if (displayName.length < 1 || displayName.length > 150) {
    return { ok: false, error: "validation" };
  }

  const avatarChoice = String(formData.get("avatar") ?? "");
  let avatarValue: string | null = null;

  if (avatarChoice.startsWith("preset:")) {
    const id = avatarChoice.slice("preset:".length);
    if (!AVATAR_PRESET_IDS.includes(id)) return { ok: false, error: "validation" };
    avatarValue = avatarChoice;
  } else if (avatarChoice === "upload") {
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return { ok: false, error: "validation" };
    }
    const ext = ALLOWED_MIME[file.type];
    if (!ext || file.size > MAX_UPLOAD_BYTES) {
      return { ok: false, error: "validation" };
    }
    // Timestamped name so the public URL changes on every new upload —
    // no stale-CDN cache busting needed.
    const path = `${user.id}/avatar-${Date.now()}.${ext}`;
    const { error: uploadError } = await supabase.storage
      .from("avatars")
      .upload(path, file, { contentType: file.type, upsert: true });
    if (uploadError) return { ok: false, error: "upload" };
    avatarValue = `upload:${path}`;
  } else if (avatarChoice === "keep") {
    // Name-only save: leave the avatar column untouched.
    const { error } = await supabase
      .from("profiles")
      .update({ display_name: displayName, updated_at: new Date().toISOString() })
      .eq("user_id", user.id);
    if (error) return { ok: false, error: "internal" };
    revalidatePath("/[locale]/[organizationSlug]", "layout");
    return { ok: true };
  } else if (avatarChoice !== "") {
    return { ok: false, error: "validation" };
  }

  const { error } = await supabase
    .from("profiles")
    .update({
      display_name: displayName,
      avatar: avatarValue,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", user.id);
  if (error) return { ok: false, error: "internal" };

  revalidatePath("/[locale]/[organizationSlug]", "layout");
  return { ok: true };
}
