alter table public.fleet_units add column if not exists eld_id text;
alter table public.drivers add column if not exists eld_id text;
create table public.eld_positions (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid references public.fleet_units(id) on delete cascade,
  driver_id uuid references public.drivers(id) on delete set null,
  eld_unit text, eld_driver text,
  lat double precision, lng double precision,
  speed_mph numeric, heading numeric, odometer numeric,
  duty_status text, drive_left_min integer, shift_left_min integer, cycle_left_min integer,
  recorded_at timestamptz not null default now(),
  source text not null default 'core_eld',
  created_at timestamptz not null default now()
);
create index eld_positions_unit_time on public.eld_positions(unit_id, recorded_at desc);
grant select on public.eld_positions to authenticated;
grant all on public.eld_positions to service_role;
alter table public.eld_positions enable row level security;
create policy "eld read staff" on public.eld_positions for select to authenticated using (public.is_staff(auth.uid()));