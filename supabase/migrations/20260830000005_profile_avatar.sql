-- ---------------------------------------------------------------------------
-- Avatar support: profiles.avatar + avatars storage bucket.
--
-- profiles.avatar shapes:
--   preset:<id>   bundled preset face (public/avatars/presets/<id>.svg)
--   upload:<path> object inside the avatars bucket
--   null          deterministic default face seeded from user_id
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column if not exists avatar text
  check (avatar is null or avatar ~ '^preset:[a-z0-9-]+$' or avatar ~ '^upload:.+$');

comment on column public.profiles.avatar is
  'preset:<id> = bundled preset face; upload:<path> = object in avatars bucket; null = deterministic default seeded from user_id.';

-- ---------------------------------------------------------------------------
-- avatars storage bucket (public read; users write only under their own
-- '{user_id}/...' prefix; 2 MB limit, image mime allowlist).
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  2097152,
  array['image/jpeg','image/png','image/webp']
)
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
