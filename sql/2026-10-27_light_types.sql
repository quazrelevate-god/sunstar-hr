-- ============================================================================
-- Sunstar HR — Light Types section (owner request, 2026-10-27)
--
-- HOW TO RUN: Supabase Dashboard → SQL Editor → paste → Run. Safe to re-run.
-- Adds 16 light-type quantity columns, filled by employees in the second
-- (Fill actuals) step, matching the client's Ginco Meydan light-fitting sheet.
-- Existing rows get 0. Same non-negative guarantee as the other counts.
-- ============================================================================

alter table public.sunstar_work_entries
  add column if not exists lt_d1          integer not null default 0,
  add column if not exists lt_d2_nrm      integer not null default 0,
  add column if not exists lt_d2_dim      integer not null default 0,
  add column if not exists lt_d3_nrm      integer not null default 0,
  add column if not exists lt_d3_dim      integer not null default 0,
  add column if not exists lt_d4_nrm      integer not null default 0,
  add column if not exists lt_d4_dim      integer not null default 0,
  add column if not exists lt_d5_nrm      integer not null default 0,
  add column if not exists lt_d5_dim      integer not null default 0,
  add column if not exists lt_d6_nrm      integer not null default 0,
  add column if not exists lt_d6_dim      integer not null default 0,
  add column if not exists lt_dl          integer not null default 0,
  add column if not exists lt_dr          integer not null default 0,
  add column if not exists lt_st_nrm      integer not null default 0,
  add column if not exists lt_st_dim      integer not null default 0,
  add column if not exists lt_chandelier  integer not null default 0;

alter table public.sunstar_work_entries
  drop constraint if exists sunstar_light_types_nonneg;
alter table public.sunstar_work_entries
  add constraint sunstar_light_types_nonneg check (
        lt_d1 >= 0 and lt_d2_nrm >= 0 and lt_d2_dim >= 0
    and lt_d3_nrm >= 0 and lt_d3_dim >= 0 and lt_d4_nrm >= 0 and lt_d4_dim >= 0
    and lt_d5_nrm >= 0 and lt_d5_dim >= 0 and lt_d6_nrm >= 0 and lt_d6_dim >= 0
    and lt_dl >= 0 and lt_dr >= 0 and lt_st_nrm >= 0 and lt_st_dim >= 0
    and lt_chandelier >= 0
  );
