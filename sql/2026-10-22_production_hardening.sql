-- ============================================================================
-- Sunstar HR — production hardening (2026-10-22 security + data audit)
--
-- HOW TO RUN: Supabase Dashboard → SQL Editor → paste this whole file → Run.
-- Safe to run more than once. Touches ONLY sunstar_* objects (not the
-- co-hosted app). Changes no real entry data except trimming whitespace on
-- one row (step 15).
--
-- What it fixes (audit ids):
--  C1  Any authenticated user of this SHARED Supabase project — including the
--      co-hosted app's 9 users — could read all Sunstar entries (prices!) and
--      the employee roster. Reads are now limited to active Sunstar members.
--  H1  Employees could edit already-submitted (AWAITING_PRICE) entries via the
--      raw API — hours/counts feed pricing. Now queued-only.
--  H2  Employees could delete colleagues' submitted work via the raw API.
--      Now queued-only (shared-tablet flow preserved).
--  H3  Employees could INSERT rows with price/target/attribution pre-filled.
--      The stamp trigger now blanks admin-only fields on non-admin inserts.
--  M1  active=false (deactivation) now actually blocks access everywhere.
--  F5  updated_at column + touch triggers → enables whole-row optimistic
--      concurrency in the edit/price modals.
--  F7  end_date now stamps the Dubai date, not UTC (00:00–04:00 fix).
--  F3  Indexes for the queue filter, date filters, and FK covers.
--  F6  search_path pinned + EXECUTE revoked on internal functions.
--  L3  Admins can delete invoice billing clients.
--  F10/F11  Saner defaults, NOT NULLs the app already guarantees, length caps.
-- ============================================================================

-- ---- 1. Active-membership helper (used by all member-scoped policies) ----
create or replace function public.sunstar_member_id()
returns uuid
language sql stable security definer
set search_path = public
as $$
  select id from public.sunstar_employees
  where auth_user_id = auth.uid() and active
  limit 1;
$$;
revoke execute on function public.sunstar_member_id() from public, anon;
grant  execute on function public.sunstar_member_id() to authenticated;

-- ---- 2. Admin check now requires an ACTIVE admin (M1) ----
create or replace function public.sunstar_is_admin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.sunstar_employees
    where auth_user_id = auth.uid() and role = 'admin' and active
  );
$$;
revoke execute on function public.sunstar_is_admin() from public, anon;
grant  execute on function public.sunstar_is_admin() to authenticated;

-- ---- 3. C1 + price visibility: member-scoped reads; employees never see
--         FINALIZED rows (prices are admin-only; client decision 2026-10-23) ----
drop policy if exists sunstar_entries_read_all_authed on public.sunstar_work_entries;
drop policy if exists sunstar_entries_read_members    on public.sunstar_work_entries;
create policy sunstar_entries_read_members on public.sunstar_work_entries
  for select to authenticated
  using (
    public.sunstar_is_admin()
    or (public.sunstar_member_id() is not null and state <> 'FINALIZED')
  );

-- Duplicate-warning helper: the morning form warns when the same villa +
-- client + date already exists IN ANY STATE. Employees can no longer read
-- finalized rows, so this SECURITY DEFINER function answers the question
-- without exposing prices (returns state + hours only, member-gated).
create or replace function public.sunstar_dup_check(p_villa text, p_client text, p_start date)
returns table (id uuid, state text, hours numeric)
language sql stable security definer
set search_path = public
as $$
  select e.id, e.state, e.hours
  from public.sunstar_work_entries e
  where public.sunstar_member_id() is not null
    and lower(btrim(e.villa))  = lower(btrim(p_villa))
    and lower(btrim(e.client)) = lower(btrim(p_client))
    and e.start_date = p_start
  order by e.created_at desc
  limit 3;
$$;
revoke execute on function public.sunstar_dup_check(text, text, date) from public, anon;
grant  execute on function public.sunstar_dup_check(text, text, date) to authenticated;

drop policy if exists sunstar_emp_read         on public.sunstar_employees;
drop policy if exists sunstar_emp_read_members on public.sunstar_employees;
create policy sunstar_emp_read_members on public.sunstar_employees
  for select to authenticated
  using (public.sunstar_member_id() is not null);

-- ---- 4. C1/H3: INSERT requires active membership; employees only AWAITING_ACTUAL ----
drop policy if exists sunstar_entries_insert_authed  on public.sunstar_work_entries;
drop policy if exists sunstar_entries_insert_members on public.sunstar_work_entries;
create policy sunstar_entries_insert_members on public.sunstar_work_entries
  for insert to authenticated
  with check (
    public.sunstar_is_admin()
    or (public.sunstar_member_id() is not null and state = 'AWAITING_ACTUAL')
  );

-- ---- 5. H1: employees may UPDATE only queued (AWAITING_ACTUAL) rows ----
drop policy if exists sunstar_entries_update_authed  on public.sunstar_work_entries;
drop policy if exists sunstar_entries_update_members on public.sunstar_work_entries;
create policy sunstar_entries_update_members on public.sunstar_work_entries
  for update to authenticated
  using (
    public.sunstar_is_admin()
    or (public.sunstar_member_id() is not null and state = 'AWAITING_ACTUAL')
  )
  with check (
    public.sunstar_is_admin()
    or (public.sunstar_member_id() is not null
        and state in ('AWAITING_ACTUAL','AWAITING_PRICE'))
  );

-- ---- 6. H2: employees may DELETE only queued rows ----
drop policy if exists sunstar_entries_delete_authed  on public.sunstar_work_entries;
drop policy if exists sunstar_entries_delete_members on public.sunstar_work_entries;
create policy sunstar_entries_delete_members on public.sunstar_work_entries
  for delete to authenticated
  using (
    public.sunstar_is_admin()
    or (public.sunstar_member_id() is not null and state = 'AWAITING_ACTUAL')
  );

-- ---- 7. H3: non-admin INSERT cannot pre-set money/attribution fields ----
create or replace function public.sunstar_stamp_actor()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  me public.sunstar_employees%rowtype;
begin
  if auth.uid() is null then
    return new;  -- service role / SQL editor: leave values as sent
  end if;

  select * into me
  from public.sunstar_employees
  where auth_user_id = auth.uid()
  limit 1;

  if not found then
    return new;  -- no profile: RLS decides whether the write is allowed at all
  end if;

  if tg_op = 'INSERT' then
    new.created_by_id := me.id;
    if me.role <> 'admin' then
      new.employee_id   := me.id;
      new.employee_name := me.full_name;
      -- Admin-only fields can never arrive pre-filled from a worker login.
      new.total_price   := null;
      new.target_hours  := null;
      new.actual_by_id  := null;
      new.priced_by_id  := null;
      new.end_date      := null;
    end if;

  elsif tg_op = 'UPDATE' then
    if me.role <> 'admin' then
      new.created_by_id := old.created_by_id;
      new.employee_id   := old.employee_id;
      new.employee_name := old.employee_name;
    end if;

    if old.state = 'AWAITING_ACTUAL' and new.state = 'AWAITING_PRICE' then
      new.actual_by_id := me.id;
    elsif me.role <> 'admin' then
      new.actual_by_id := old.actual_by_id;
    end if;

    if new.state = 'FINALIZED' and old.state is distinct from 'FINALIZED' then
      new.priced_by_id := me.id;
    elsif me.role <> 'admin' then
      new.priced_by_id := old.priced_by_id;
    end if;
  end if;

  return new;
end;
$$;

-- ---- 8. F7: end_date stamped in Dubai time, not UTC ----
create or replace function public.sunstar_set_end_date_on_actual()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.state = 'AWAITING_PRICE' and (old.state is distinct from new.state) then
    if new.end_date is null then
      new.end_date := (now() at time zone 'Asia/Dubai')::date;
    end if;
  end if;
  return new;
end $$;

-- ---- 9. F5: updated_at for optimistic concurrency ----
alter table public.sunstar_work_entries
  add column if not exists updated_at timestamptz not null default now();

drop trigger if exists sunstar_work_entries_touch on public.sunstar_work_entries;
create trigger sunstar_work_entries_touch
  before update on public.sunstar_work_entries
  for each row execute function public.sunstar_touch_updated_at();

drop trigger if exists sunstar_invoice_clients_touch on public.sunstar_invoice_clients;
create trigger sunstar_invoice_clients_touch
  before update on public.sunstar_invoice_clients
  for each row execute function public.sunstar_touch_updated_at();

-- ---- 10. F6/L1: pin search_path; lock function EXECUTE down ----
alter function public.sunstar_guard_updates()           set search_path = public;
alter function public.sunstar_set_end_date_on_actual()  set search_path = public;
alter function public.sunstar_touch_updated_at()        set search_path = public;
revoke execute on function public.sunstar_stamp_actor()            from public, anon, authenticated;
revoke execute on function public.sunstar_guard_updates()          from public, anon, authenticated;
revoke execute on function public.sunstar_set_end_date_on_actual() from public, anon, authenticated;
revoke execute on function public.sunstar_touch_updated_at()       from public, anon, authenticated;

-- ---- 11. F3: indexes for hot paths + FK covers ----
create index if not exists idx_sunstar_entries_state_created
  on public.sunstar_work_entries (state, created_at, id);
create index if not exists idx_sunstar_entries_start_date
  on public.sunstar_work_entries (start_date);
create index if not exists idx_sunstar_entries_actual_by
  on public.sunstar_work_entries (actual_by_id);
create index if not exists idx_sunstar_entries_created_by
  on public.sunstar_work_entries (created_by_id);
create index if not exists idx_sunstar_entries_priced_by
  on public.sunstar_work_entries (priced_by_id);
create index if not exists idx_sunstar_saved_filters_created_by
  on public.sunstar_saved_filters (created_by_id);

-- ---- 12. L3: admins can delete billing clients (deny-by-default gap) ----
drop policy if exists sunstar_invoice_clients_admin_delete on public.sunstar_invoice_clients;
create policy sunstar_invoice_clients_admin_delete on public.sunstar_invoice_clients
  for delete to authenticated
  using (public.sunstar_is_admin());

-- ---- 13. Advisor: split FOR ALL admin policies so SELECT isn't doubled ----
drop policy if exists sunstar_emp_admin_write  on public.sunstar_employees;
drop policy if exists sunstar_emp_admin_insert on public.sunstar_employees;
drop policy if exists sunstar_emp_admin_update on public.sunstar_employees;
drop policy if exists sunstar_emp_admin_delete on public.sunstar_employees;
create policy sunstar_emp_admin_insert on public.sunstar_employees
  for insert to authenticated with check (public.sunstar_is_admin());
create policy sunstar_emp_admin_update on public.sunstar_employees
  for update to authenticated
  using (public.sunstar_is_admin()) with check (public.sunstar_is_admin());
create policy sunstar_emp_admin_delete on public.sunstar_employees
  for delete to authenticated using (public.sunstar_is_admin());

drop policy if exists sunstar_saved_filters_admin_write  on public.sunstar_saved_filters;
drop policy if exists sunstar_saved_filters_admin_insert on public.sunstar_saved_filters;
drop policy if exists sunstar_saved_filters_admin_update on public.sunstar_saved_filters;
drop policy if exists sunstar_saved_filters_admin_delete on public.sunstar_saved_filters;
create policy sunstar_saved_filters_admin_insert on public.sunstar_saved_filters
  for insert to authenticated with check (public.sunstar_is_admin());
create policy sunstar_saved_filters_admin_update on public.sunstar_saved_filters
  for update to authenticated
  using (public.sunstar_is_admin()) with check (public.sunstar_is_admin());
create policy sunstar_saved_filters_admin_delete on public.sunstar_saved_filters
  for delete to authenticated using (public.sunstar_is_admin());

-- ---- 14. F10/F11: hygiene — defaults, NOT NULLs, length guard ----
alter table public.sunstar_work_entries alter column description drop default;
alter table public.sunstar_work_entries alter column status set default 'IN PROGRESS';
alter table public.sunstar_work_entries alter column villa       set not null;
alter table public.sunstar_work_entries alter column client      set not null;
alter table public.sunstar_work_entries alter column description set not null;
alter table public.sunstar_work_entries
  drop constraint if exists sunstar_text_len;
alter table public.sunstar_work_entries
  add constraint sunstar_text_len check (
    length(villa) <= 120 and length(client) <= 200 and length(description) <= 500
  ) not valid;

-- ---- 15. F9: repair the one row saved with untrimmed villa/client ----
update public.sunstar_work_entries
   set villa = btrim(villa), client = btrim(client)
 where villa <> btrim(villa) or client <> btrim(client);

-- Done. Quick verification:
--   select policyname, cmd from pg_policies where tablename='sunstar_work_entries';
--   select column_name from information_schema.columns
--     where table_name='sunstar_work_entries' and column_name='updated_at';
