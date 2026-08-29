# Avatar picker — design

**Date:** 2026-08-29
**Status:** Approved

## Goal

Replace the initials-only avatar ("HM") with a real avatar system: every user gets a
unique hand-drawn default face, can pick one of ~64 bundled preset faces, or upload
their own photo.

Original request referenced koboyo.com face icons; its license prohibits bundling
icons "where users can pick" them, so we use **Open Peeps** (CC0, same doodle
aesthetic) generated via **DiceBear** at build time instead.

## Data model

New migration `add_profile_avatar`:

- `profiles.avatar text null` with a check constraint: value must match
  `^preset:[a-z0-9-]+$` or `^upload:.+$`.
  - `preset:<id>` — one of the bundled preset faces.
  - `upload:<storage-path>` — path inside the `avatars` bucket.
  - `null` — default: deterministic preset chosen by hashing `user_id` into the
    preset list (stable, unique-looking, zero setup).
- New **public storage bucket `avatars`** (same pattern as `product-images`):
  - public read;
  - authenticated users may insert/update/delete only under their own prefix
    (`<user_id>/…`);
  - 2 MB file size limit; mime allowlist `image/jpeg`, `image/png`, `image/webp`.
- Remember repo gotcha: grants on new tables/buckets — copy the grants/RLS style
  from `20260729000001_catalog_units_images_fixes.sql`.

## Presets

- One-off build script `scripts/generate-avatar-presets.mjs` using
  `@dicebear/core` + `@dicebear/collection` (open-peeps style), dev-dependency only.
- 64 fixed seeds → 64 SVG files committed to `public/avatars/presets/<id>.svg`.
- Preset id = seed slug. Manifest `src/lib/avatar/presets.ts` exports the ordered
  id list (used by both the picker grid and the default-avatar hash).
- Zero runtime dependency, zero external requests.

## UI

### Entry point

The currently-disabled "Operator profile" item in the user dropdown (both
`src/features/dashboard/components/app-sidebar.tsx` and
`src/features/seller/components/seller-sidebar.tsx`) becomes an **Edit profile**
item opening a dialog.

### Edit profile dialog

New `src/features/profile/components/edit-profile-dialog.tsx`:

- Display name input (prefilled from `profiles.display_name`).
- Avatar section:
  - "Upload photo" tile first: file input (jpeg/png/webp, ≤2 MB client-checked);
    no cropper — displayed with `object-cover`.
  - Scrollable grid (8 cols desktop, 5 mobile) of the 64 presets; the current
    selection gets a ring; the seeded default is ringed when `avatar` is null.
- Save = server action `updateProfileAction`:
  - upload (if any) to `avatars/<user_id>/avatar.<ext>` with upsert;
  - update `profiles.display_name` + `profiles.avatar` (+ bump `version`,
    `updated_at` per repo convention);
  - revalidate layout so sidebars refresh.

## Display

New `src/features/profile/components/user-avatar.tsx` wrapping shadcn `Avatar`:

- Input: `avatar` value, `userId`, `userName`, `userEmail`, size/className.
- Resolves: `preset:x` → `/avatars/presets/x.svg`; `upload:p` → Supabase public
  URL (cache-busted with `updated_at`); `null` → seeded preset from `userId`.
- `AvatarFallback` initials remain the loading/error fallback.
- Swapped into both sidebars (trigger button + dropdown label). Sidebars need the
  `avatar` value + `user_id` passed down from their server layouts (currently only
  name/email are passed).

## i18n

New `profile.edit` namespace strings in `messages/en.json` + `messages/ms.json`
(dialog title, name label, avatar label, upload, save, saved toast, size/type
errors), following existing namespace conventions.

## Out of scope (YAGNI)

- Image cropper / resizing.
- Buyer portal avatars.
- Avatar display anywhere beyond the two sidebars (the `UserAvatar` component
  makes later adoption trivial).
- Deleting old uploads when switching back to a preset (upsert keeps one file per
  user; harmless).

## Testing

- Unit test for the avatar-value resolver (preset / upload / null-seeded paths,
  malformed value falls back to initials).
- Manual QA with seeded dev accounts (`password123` roster) via dev-account picker.
