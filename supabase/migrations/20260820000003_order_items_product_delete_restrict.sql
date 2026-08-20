-- Order history must survive catalog edits.
--
-- 20260810000001 created order_items.product_id with "on delete restrict" so a
-- product that has ever been ordered cannot be destroyed. An interim migration
-- relaxed that to "on delete cascade" because the seller UI only exposed hard
-- delete, which left such products stuck -- but the cost was that one click on
-- the trash icon silently deleted historical order lines (invoices, revenue
-- reports, customer history).
--
-- The UI now archives products (products.is_active = false) instead, so the
-- constraint goes back to restrict: deleting a product with order history is a
-- 23503 the app turns into "archive it instead".
alter table public.order_items
  drop constraint if exists order_items_product_id_fkey;

alter table public.order_items
  add constraint order_items_product_id_fkey
  foreign key (product_id) references public.products(id) on delete restrict;
