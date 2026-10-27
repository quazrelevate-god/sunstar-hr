-- ============================================================================
-- Sunstar HR — per-employee queue (owner request, 2026-10-27)
--
-- HOW TO RUN: Supabase Dashboard → SQL Editor → paste this whole file → Run.
-- Safe to run more than once. Touches ONLY sunstar_* objects.
--
-- Change: employees now see, fill and delete ONLY the queued entries assigned
-- to them (employee_id = their own profile; the stamp trigger sets this to
-- the creator on every worker-created entry, spoof-proof). Before this, any
-- worker saw every not-yet-submitted job (the old shared-tablet model) —
-- e.g. Bharath's queue showed Sunil's entry.
--
-- Admins are unchanged: they still see and manage everything.
--
-- Also adds sunstar_suggestions(): the typeahead on the entry form used to
-- read all rows for its history; with reads now scoped to own entries, this
-- SECURITY DEFINER function supplies org-wide DISTINCT identifier values
-- (cluster/villa/client/... names only — no hours, no prices) to any active
-- member, so autocomplete stays useful.
-- ============================================================================

-- ---- 1. SELECT: own non-finalized entries only (admins: everything) ----
drop policy if exists sunstar_entries_read_members on public.sunstar_work_entries;
create policy sunstar_entries_read_members on public.sunstar_work_entries
  for select to authenticated
  using (
    public.sunstar_is_admin()
    or (state <> 'FINALIZED' and employee_id = public.sunstar_member_id())
  );

-- ---- 2. UPDATE: own queued entries only ----
drop policy if exists sunstar_entries_update_members on public.sunstar_work_entries;
create policy sunstar_entries_update_members on public.sunstar_work_entries
  for update to authenticated
  using (
    public.sunstar_is_admin()
    or (state = 'AWAITING_ACTUAL' and employee_id = public.sunstar_member_id())
  )
  with check (
    public.sunstar_is_admin()
    or (employee_id = public.sunstar_member_id()
        and state in ('AWAITING_ACTUAL','AWAITING_PRICE'))
  );

-- ---- 3. DELETE: own queued entries only ----
drop policy if exists sunstar_entries_delete_members on public.sunstar_work_entries;
create policy sunstar_entries_delete_members on public.sunstar_work_entries
  for delete to authenticated
  using (
    public.sunstar_is_admin()
    or (state = 'AWAITING_ACTUAL' and employee_id = public.sunstar_member_id())
  );

-- (INSERT policy unchanged: members may insert AWAITING_ACTUAL rows; the
--  stamp trigger forces employee_id/created_by_id to the creator.)

-- ---- 4. Org-wide autocomplete values, without exposing rows ----
create or replace function public.sunstar_suggestions()
returns jsonb
language sql stable security definer
set search_path = public
as $$
  select coalesce(jsonb_object_agg(col, vals), '{}'::jsonb)
  from (
    select t.col, jsonb_agg(distinct btrim(t.raw) order by btrim(t.raw)) as vals
    from public.sunstar_work_entries e
    cross join lateral (values
      ('cluster',          e.cluster),
      ('phase',            e.phase),
      ('villa',            e.villa),
      ('bedroom_type',     e.bedroom_type),
      ('floor_type',       e.floor_type),
      ('description',      e.description),
      ('client',           e.client),
      ('status',           e.status),
      ('apartment_number', e.apartment_number)
    ) as t(col, raw)
    where public.sunstar_member_id() is not null
      and t.raw is not null
      and btrim(t.raw) <> ''
    group by t.col
  ) g;
$$;
revoke execute on function public.sunstar_suggestions() from public, anon;
grant  execute on function public.sunstar_suggestions() to authenticated;

-- Done. Quick verification:
--   As an employee token: select count(*) from sunstar_work_entries;  → only own rows
--   select jsonb_object_keys(public.sunstar_suggestions());           → 9 keys
