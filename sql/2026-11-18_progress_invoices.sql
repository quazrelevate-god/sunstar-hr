-- Applied to production on 2026-11-18 as migration "sunstar_progress_invoices".
-- Progress (proforma) invoicing, as China Railway requires: a proforma with
-- per-tower/per-level progress first, then a one-page summary tax invoice
-- once the client approves.
--
--  * sunstar_invoice_clients gains the last proforma number (a separate
--    series from tax invoices) and free-form document defaults (scope text,
--    reference, retention %), so the next documents are pre-filled.
--  * sunstar_progress_items remembers each tower/level's contract quantity,
--    rate and unit per work-entry client label: typed once, reused on every
--    later proforma.

alter table public.sunstar_invoice_clients
  add column if not exists last_proforma_no text  not null default '',
  add column if not exists doc_defaults     jsonb not null default '{}'::jsonb;

create table if not exists public.sunstar_progress_items (
  client_label text not null,             -- work-entry client, lower(btrim()) with single spaces
  section      text not null,             -- normalised tower, e.g. 'TOWER 1A'
  item         text not null,             -- normalised level, e.g. 'LEVEL 9'
  uom          text not null default '',
  contract_qty numeric check (contract_qty is null or contract_qty >= 0),
  rate         numeric check (rate is null or rate >= 0),
  updated_at   timestamptz not null default now(),
  primary key (client_label, section, item)
);

alter table public.sunstar_progress_items enable row level security;

drop policy if exists sunstar_progress_items_admin_read   on public.sunstar_progress_items;
drop policy if exists sunstar_progress_items_admin_insert on public.sunstar_progress_items;
drop policy if exists sunstar_progress_items_admin_update on public.sunstar_progress_items;
create policy sunstar_progress_items_admin_read on public.sunstar_progress_items
  for select using (public.sunstar_is_admin());
create policy sunstar_progress_items_admin_insert on public.sunstar_progress_items
  for insert with check (public.sunstar_is_admin());
create policy sunstar_progress_items_admin_update on public.sunstar_progress_items
  for update using (public.sunstar_is_admin()) with check (public.sunstar_is_admin());

drop trigger if exists sunstar_progress_items_touch on public.sunstar_progress_items;
create trigger sunstar_progress_items_touch
  before update on public.sunstar_progress_items
  for each row execute function public.sunstar_touch_updated_at();
