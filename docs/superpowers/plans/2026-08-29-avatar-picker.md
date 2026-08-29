# Avatar Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace initials-only sidebar avatar with preset doodle faces (Open Peeps, 64 bundled SVGs), deterministic default per user, and photo upload — editable from an "Edit profile" dialog in the sidebar user dropdown.

**Architecture:** `profiles.avatar text` column (`preset:<id>` / `upload:<path>` / null=seeded default) + public `avatars` storage bucket. Presets generated once by a dev script via DiceBear and committed under `public/avatars/presets/`. A `UserAvatar` client component resolves the value; an edit dialog + server action mutate it.

**Tech Stack:** Next.js App Router, Supabase (Postgres + Storage + RLS), shadcn/ui, next-intl, vitest. Dev-only: `@dicebear/core`, `@dicebear/collection`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-29-avatar-picker-design.md`.
- Seller sidebar (`seller-sidebar.tsx`) is dead code (no importers) — do NOT touch it.
- Migrations live in `supabase/migrations/`, next stamp `20260830000005_*`.
- Repo gotcha: new tables/buckets need explicit grants — mirror `20260729000001_catalog_units_images_fixes.sql` style.
- i18n: add keys to BOTH `src/messages/en.json` and `src/messages/ms.json`.
- Test accounts password `password123`; QA via dev-account picker.

---

### Task 1: Migration — avatar column + avatars bucket

**Files:**
- Create: `supabase/migrations/20260830000005_profile_avatar.sql`

**Interfaces:**
- Produces: `profiles.avatar text null` (check `^preset:[a-z0-9-]+$|^upload:.+$`), storage bucket `avatars` (public read, owner-prefix write, 2 MB, jpeg/png/webp).

- [ ] **Step 1: Write migration**

```sql
-- Avatar support: profiles.avatar + avatars storage bucket.
alter table public.profiles
  add column if not exists avatar text
  check (avatar is null or avatar ~ '^preset:[a-z0-9-]+$' or avatar ~ '^upload:.+$');

comment on column public.profiles.avatar is
  'preset:<id> = bundled preset face; upload:<path> = object in avatars bucket; null = deterministic default seeded from user_id.';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152,
        array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy "avatars_public_read" on storage.objects
  for select using (bucket_id = 'avatars');

create policy "avatars_owner_insert" on storage.objects
  for insert with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "avatars_owner_update" on storage.objects
  for update using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "avatars_owner_delete" on storage.objects
  for delete using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
```

- [ ] **Step 2: Apply locally** — `supabase migration up` (or `npx supabase migration up`). Expected: applies cleanly.
- [ ] **Step 3: Commit** — `git add supabase/migrations/20260830000005_profile_avatar.sql && git commit -m "feat(profile): avatar column + avatars bucket"`.

### Task 2: Presets + resolver (TDD)

**Files:**
- Create: `scripts/generate-avatar-presets.mjs`
- Create: `public/avatars/presets/*.svg` (64 files, generated)
- Create: `src/lib/avatar/presets.ts`, `src/lib/avatar/resolve.ts`
- Test: `src/lib/avatar/resolve.test.ts`

**Interfaces:**
- Produces: `AVATAR_PRESET_IDS: readonly string[]` (64 ids), `presetUrl(id): string`, `resolveAvatar(avatar: string | null, userId: string): { kind: "preset"; url: string } | { kind: "upload"; path: string }`.

- [ ] **Step 1:** `npm i -D @dicebear/core @dicebear/collection`
- [ ] **Step 2:** Write generator script (64 fixed seeds `face-01`…`face-64`, openPeeps style, `createAvatar(openPeeps, { seed })`, write `.svg` files + emit id list). Run `node scripts/generate-avatar-presets.mjs`; expect 64 SVGs.
- [ ] **Step 3:** Write failing vitest for `resolveAvatar`: preset value → preset URL; upload value → path; null → deterministic preset (same userId twice = same id, two userIds likely differ); malformed value → falls back to seeded preset.
- [ ] **Step 4:** Run test, expect FAIL. Implement `presets.ts` (id array) + `resolve.ts` (simple FNV-1a or char-sum hash mod 64). Run `npx vitest run src/lib/avatar` — PASS.
- [ ] **Step 5:** Commit.

### Task 3: UserAvatar component + sidebar wiring

**Files:**
- Create: `src/features/profile/components/user-avatar.tsx`
- Modify: `src/features/identity-access/server/queries.ts` (getProfile select + map `avatar`), `src/features/identity-access/types.ts` (Profile.avatar)
- Modify: `src/app/[locale]/(dashboard)/[organizationSlug]/layout.tsx` (pass `userId`, `avatar` to AppSidebar)
- Modify: `src/features/dashboard/components/app-sidebar.tsx` (NavUser props + both Avatar spots)

**Interfaces:**
- Produces: `<UserAvatar avatar={string|null} userId userName userEmail className />` — renders `AvatarImage` (preset SVG path or Supabase public URL) with `AvatarFallback` initials.
- Upload public URL built client-side: `${NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/avatars/<path>`.

- [ ] **Step 1:** Extend `Profile` type + `getProfile` select with `avatar`.
- [ ] **Step 2:** Build `UserAvatar` (client component, wraps shadcn Avatar/AvatarImage/AvatarFallback, uses `resolveAvatar`).
- [ ] **Step 3:** Thread `userId` + `avatar` through layout → `AppSidebar` → `NavUser`; replace both initials-only `<Avatar>` blocks with `<UserAvatar>`.
- [ ] **Step 4:** `npx tsc --noEmit` clean; commit.

### Task 4: Edit profile dialog + server action + i18n

**Files:**
- Create: `src/features/profile/components/edit-profile-dialog.tsx`
- Create: `src/features/profile/server/actions.ts` (`updateProfileAction`)
- Modify: `src/features/dashboard/components/app-sidebar.tsx` (enable "Operator profile" item → opens dialog)
- Modify: `src/messages/en.json`, `src/messages/ms.json` (`profile.edit.*` keys)

**Interfaces:**
- `updateProfileAction(formData: FormData)` server action: fields `displayName` (1–150 chars), `avatar` (preset id or "upload" sentinel or empty), optional `file`. Uploads to `avatars/<user_id>/avatar.<ext>` (upsert), updates `profiles` (display_name, avatar, version+1, updated_at), `revalidatePath("/[organizationSlug]", "layout")`. Returns `{ ok: true } | { ok: false; error: string }`.
- Dialog: name input, upload tile (client-validated ≤2 MB, jpeg/png/webp), 64-preset grid (8 cols sm+, 5 cols mobile), ring on selection, `useToast` on save.

- [ ] **Step 1:** Server action with auth check (`requireUser` pattern from existing actions).
- [ ] **Step 2:** Dialog component; wire into user dropdown replacing disabled item.
- [ ] **Step 3:** i18n keys en + ms.
- [ ] **Step 4:** `npx tsc --noEmit` + `npx vitest run src/lib/avatar` clean; commit.

### Task 5: Verify end-to-end

- [ ] **Step 1:** `npm run build` (or dev server) clean.
- [ ] **Step 2:** Browser QA: login `hr@gmail.com`/`password123` — sidebar shows seeded doodle face (not "HM"); open Edit profile; pick preset → saves + sidebar updates; upload photo → shows; reload persists.
- [ ] **Step 3:** Screenshot proof; commit any fixes.
