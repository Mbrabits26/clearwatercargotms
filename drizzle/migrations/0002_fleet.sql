
create table public.fleet_units (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('truck','trailer')),
  unit_number text not null,
  make_model text, year integer, vin text, plate text,
  equipment text,
  status text not null default 'available' check (status in ('available','assigned','maintenance','out_of_service')),
  notes text,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.fleet_units to authenticated;
grant all on public.fleet_units to service_role;
alter table public.fleet_units enable row level security;
create policy "fleet read" on public.fleet_units for select to authenticated using (true);
create policy "fleet write" on public.fleet_units for insert to authenticated with check (true);
create policy "fleet update" on public.fleet_units for update to authenticated using (true);
create policy "fleet delete admin" on public.fleet_units for delete to authenticated using (public.has_role(auth.uid(),'admin'));

create table public.drivers (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  phone text, email text,
  cdl_number text, cdl_state text, cdl_expires date, medical_expires date,
  status text not null default 'available' check (status in ('available','on_load','off_duty','unavailable')),
  home_city text,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.drivers to authenticated;
grant all on public.drivers to service_role;
alter table public.drivers enable row level security;
create policy "drivers read" on public.drivers for select to authenticated using (true);
create policy "drivers write" on public.drivers for insert to authenticated with check (true);
create policy "drivers update" on public.drivers for update to authenticated using (true);
create policy "drivers delete admin" on public.drivers for delete to authenticated using (public.has_role(auth.uid(),'admin'));

alter table public.loads add column truck_id uuid references public.fleet_units(id) on delete set null;
alter table public.loads add column trailer_id uuid references public.fleet_units(id) on delete set null;
alter table public.loads add column driver_id uuid references public.drivers(id) on delete set null;
