-- ============================================================================
-- Sunstar HR — server-side "who did it" stamping + number sanity checks
-- Date: 2026-09-29
--
-- HOW TO RUN: Supabase Dashboard → SQL Editor → paste this whole file → Run.
-- Safe to run more than once. Does not change or delete any existing rows.
-- Read the note above section #11 first (one quick check query).
--
-- Why:
--  #5  employee_id / employee_name / created_by_id / actual_by_id / priced_by_id
--      were trusted from the browser, so a logged-in worker could record work
--      under someone else's name by calling the API directly. This trigger sets
--      them from the logged-in user instead. (Works alongside the existing
--      sunstar_guard_updates and sunstar_set_end_date_on_actual triggers.)
--  #11 Negative hours / prices / point counts and impossible hours are now
--      rejected by the database too, not only by the screens.
-- ============================================================================


-- ---------- #5  Stamp the actor from the logged-in user ----------

create or replace function public.sunstar_stamp_actor()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  me public.sunstar_employees%rowtype;
begin
  -- Service role / SQL editor / edge functions: leave values as sent.
  if auth.uid() is null then
    return new;
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
    end if;

  elsif tg_op = 'UPDATE' then
    -- Owner / creator can never be rewritten by a non-admin.
    if me.role <> 'admin' then
      new.created_by_id := old.created_by_id;
      new.employee_id   := old.employee_id;
      new.employee_name := old.employee_name;
    end if;

    -- Who filled the actuals: stamped at the moment the job moves to AWAITING_PRICE.
    if old.state = 'AWAITING_ACTUAL' and new.state = 'AWAITING_PRICE' then
      new.actual_by_id := me.id;
    elsif me.role <> 'admin' then
      new.actual_by_id := old.actual_by_id;
    end if;

    -- Who priced it: stamped at the moment the job becomes FINALIZED.
    if new.state = 'FINALIZED' and old.state is distinct from 'FINALIZED' then
      new.priced_by_id := me.id;
    elsif me.role <> 'admin' then
      new.priced_by_id := old.priced_by_id;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists sunstar_stamp_actor on public.sunstar_work_entries;
create trigger sunstar_stamp_actor
  before insert or update on public.sunstar_work_entries
  for each row execute function public.sunstar_stamp_actor();


-- ---------- #11  Number sanity checks ----------
-- NOT VALID = the constraint is added without scanning existing rows, and is
-- enforced on every insert/update from now on. NOTE: updating an OLD row that
-- already breaks a rule will then fail until the bad value is corrected.
--
-- BEFORE running this section, check for existing rows that break the rules
-- (the system started blank, so this should return nothing):
--
--   select id, villa, client, hours, target_hours, total_manpower, total_price
--   from public.sunstar_work_entries
--   where coalesce(hours,0) < 0 or coalesce(target_hours,0) < 0
--      or coalesce(total_price,0) < 0 or coalesce(total_manpower,0) < 0
--      or least(power_point, gi_box_nos, data_point, telephone_point, lighting_point, fcu_point,
--               db_conduit, gi_conduiting, gi_circular_box, gi_offset, final_fix_switch,
--               final_fix_socket, type_no_1_light, type_no_2_light, type_no_3_light,
--               type_no_4_light, type_no_5_light, type_no_6_light, led_strip_light_meter) < 0
--      or (total_manpower > 0 and (hours > 24*total_manpower or target_hours > 24*total_manpower));
--
-- If it returns rows, fix them via Admin → Queue → Edit first (or tell your developer).
-- Once clean, you can optionally make the checks cover old rows too:
--   alter table public.sunstar_work_entries validate constraint sunstar_no_negative_numbers;
--   alter table public.sunstar_work_entries validate constraint sunstar_hours_plausible;

alter table public.sunstar_work_entries
  drop constraint if exists sunstar_no_negative_numbers;

alter table public.sunstar_work_entries
  add constraint sunstar_no_negative_numbers check (
        coalesce(hours, 0)                 >= 0
    and coalesce(target_hours, 0)          >= 0
    and coalesce(total_price, 0)           >= 0
    and coalesce(total_manpower, 0)        >= 0
    and coalesce(power_point, 0)           >= 0
    and coalesce(gi_box_nos, 0)            >= 0
    and coalesce(data_point, 0)            >= 0
    and coalesce(telephone_point, 0)       >= 0
    and coalesce(lighting_point, 0)        >= 0
    and coalesce(fcu_point, 0)             >= 0
    and coalesce(db_conduit, 0)            >= 0
    and coalesce(gi_conduiting, 0)         >= 0
    and coalesce(gi_circular_box, 0)       >= 0
    and coalesce(gi_offset, 0)             >= 0
    and coalesce(final_fix_switch, 0)      >= 0
    and coalesce(final_fix_socket, 0)      >= 0
    and coalesce(type_no_1_light, 0)       >= 0
    and coalesce(type_no_2_light, 0)       >= 0
    and coalesce(type_no_3_light, 0)       >= 0
    and coalesce(type_no_4_light, 0)       >= 0
    and coalesce(type_no_5_light, 0)       >= 0
    and coalesce(type_no_6_light, 0)       >= 0
    and coalesce(led_strip_light_meter, 0) >= 0
  ) not valid;

-- Same rule as the app: a job can't log more than 24h × manpower.
alter table public.sunstar_work_entries
  drop constraint if exists sunstar_hours_plausible;

alter table public.sunstar_work_entries
  add constraint sunstar_hours_plausible check (
    total_manpower is null or total_manpower <= 0 or (
          (hours is null        or hours        <= 24 * total_manpower)
      and (target_hours is null or target_hours <= 24 * total_manpower)
    )
  ) not valid;

-- Done. Quick check (should list the new trigger and two constraints):
--   select tgname from pg_trigger where tgrelid = 'public.sunstar_work_entries'::regclass and not tgisinternal;
--   select conname from pg_constraint where conrelid = 'public.sunstar_work_entries'::regclass and contype = 'c';
