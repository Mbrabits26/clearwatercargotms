create table public.load_tracking_tokens (
  id uuid primary key default gen_random_uuid(),
  token uuid not null unique default gen_random_uuid(),
  load_id uuid not null references public.loads(id) on delete cascade,
  driver_name text,
  driver_phone text,
  status text not null default 'active' check (status in ('active','void')),
  created_by uuid,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days'
);
grant select, insert, update on public.load_tracking_tokens to authenticated;
grant all on public.load_tracking_tokens to service_role;
alter table public.load_tracking_tokens enable row level security;
create policy "tracking tokens staff" on public.load_tracking_tokens for all to authenticated
  using (public.is_staff(auth.uid()) and exists (select 1 from public.loads l where l.id = load_id))
  with check (public.is_staff(auth.uid()) and exists (select 1 from public.loads l where l.id = load_id));

create table public.load_tracking_pings (
  id uuid primary key default gen_random_uuid(),
  load_id uuid not null references public.loads(id) on delete cascade,
  token_id uuid references public.load_tracking_tokens(id) on delete set null,
  kind text not null default 'location' check (kind in ('location','status')),
  status text,
  note text,
  lat numeric,
  lng numeric,
  created_at timestamptz not null default now()
);
grant select on public.load_tracking_pings to authenticated;
grant all on public.load_tracking_pings to service_role;
alter table public.load_tracking_pings enable row level security;
create policy "tracking pings staff read" on public.load_tracking_pings for select to authenticated
  using (public.is_staff(auth.uid()) and exists (select 1 from public.loads l where l.id = load_id));

alter publication supabase_realtime add table public.load_tracking_pings;