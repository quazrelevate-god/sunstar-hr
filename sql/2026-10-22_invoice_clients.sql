-- Applied to production on 2026-10-22 as migration "sunstar_invoice_clients".
-- Billing parties for generated invoices. A work-entry client label is not the
-- legal billing name, so each billing client remembers which entry labels it
-- was used for, plus address, TRN, last project and last invoice number.
create table if not exists public.sunstar_invoice_clients (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  address         text not null default '',
  trn             text not null default '',
  entry_clients   text[] not null default '{}',
  last_invoice_no text not null default '',
  last_project    text not null default '',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create unique index if not exists sunstar_invoice_clients_name_key
  on public.sunstar_invoice_clients (lower(btrim(name)));

alter table public.sunstar_invoice_clients enable row level security;

create policy sunstar_invoice_clients_admin_read on public.sunstar_invoice_clients
  for select using (public.sunstar_is_admin());
create policy sunstar_invoice_clients_admin_insert on public.sunstar_invoice_clients
  for insert with check (public.sunstar_is_admin());
create policy sunstar_invoice_clients_admin_update on public.sunstar_invoice_clients
  for update using (public.sunstar_is_admin()) with check (public.sunstar_is_admin());

insert into public.sunstar_invoice_clients (name, address, trn, last_invoice_no, last_project) values
  ('BILT MIDDLE EAST LLC', 'P.O.BOX:239, DUBAI, UAE', '100223251800003', 'SS:PT:INV:10202611', ''),
  ('M/S MEPTRON ELECTROMECHANICAL CONTRACTING LLC', 'DUBAI, UAE', '105478809400003', 'INV/SAMEP-07/26/04', 'CARLTON-5th floor CHW WORKS')
on conflict do nothing;
