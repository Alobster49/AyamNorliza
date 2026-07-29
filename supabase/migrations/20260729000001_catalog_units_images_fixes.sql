-- 20260729000001_catalog_units_images_fixes.sql
-- Catalog units (per_kg/per_piece), decimal order quantities, missing DELETE
-- RLS policies, and the product-images storage bucket.

begin;

-- ---------------------------------------------------------------------------
-- 1. unit_type on product_variants
--    price_per_unit means RM per kg when 'per_kg', RM per piece when 'per_piece'.
-- ---------------------------------------------------------------------------
alter table public.product_variants
  add column if not exists unit_type text not null default 'per_piece'
  constraint product_variants_unit_type_check check (unit_type in ('per_kg', 'per_piece'));

comment on column public.product_variants.unit_type is
  'How this variant is sold: per_kg (decimal quantities) or per_piece (integer quantities).';

-- ---------------------------------------------------------------------------
-- 2. Decimal quantities (e.g. 1.5 kg). Existing check (quantity > 0) survives.
-- ---------------------------------------------------------------------------
alter table public.order_items alter column quantity type numeric(10,3);
alter table public.buyer_order_items alter column quantity type numeric(10,3);

-- ---------------------------------------------------------------------------
-- 3. Missing DELETE RLS policies. Without these, every delete silently
--    affects 0 rows. Orders are intentionally NOT deletable (cancel instead).
-- ---------------------------------------------------------------------------
create policy "categories_delete" on public.categories
  for delete using (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and status = 'active'
      and role in ('owner', 'org_admin', 'seller')
    )
  );

create policy "products_delete" on public.products
  for delete using (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and status = 'active'
      and role in ('owner', 'org_admin', 'seller')
    )
  );

create policy "product_variants_delete" on public.product_variants
  for delete using (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and status = 'active'
      and role in ('owner', 'org_admin', 'seller')
    )
  );

create policy "customers_delete" on public.customers
  for delete using (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and status = 'active'
      and role in ('owner', 'org_admin', 'seller')
    )
  );

-- ---------------------------------------------------------------------------
-- 4. product-images storage bucket (public read; sellers write within own org
--    folder: object names are '{organization_id}/{uuid}.{ext}').
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-images',
  'product-images',
  true,
  5242880,
  array['image/jpeg','image/png','image/webp','image/gif']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy "product_images_public_read" on storage.objects
  for select using (bucket_id = 'product-images');

create policy "product_images_seller_insert" on storage.objects
  for insert with check (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1] in (
      select organization_id::text from public.organization_members
      where user_id = auth.uid() and status = 'active'
      and role in ('owner', 'org_admin', 'seller')
    )
  );

create policy "product_images_seller_update" on storage.objects
  for update using (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1] in (
      select organization_id::text from public.organization_members
      where user_id = auth.uid() and status = 'active'
      and role in ('owner', 'org_admin', 'seller')
    )
  );

create policy "product_images_seller_delete" on storage.objects
  for delete using (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1] in (
      select organization_id::text from public.organization_members
      where user_id = auth.uid() and status = 'active'
      and role in ('owner', 'org_admin', 'seller')
    )
  );

commit;
