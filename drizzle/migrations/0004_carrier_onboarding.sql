
alter table public.carriers
  add column cargo_expires date,
  add column noa_received boolean not null default false,
  add column voided_check_received boolean not null default false;

create table public.carrier_documents (
  id uuid primary key default gen_random_uuid(),
  carrier_id uuid not null references public.carriers(id) on delete cascade,
  kind text not null check (kind in ('w9','coi','agreement','noa','voided_check','other')),
  file_path text not null,
  file_name text,
  expires_on date,
  source text not null default 'staff',
  uploaded_at timestamptz not null default now()
);
grant select, insert, update, delete on public.carrier_documents to authenticated;
grant all on public.carrier_documents to service_role;
alter table public.carrier_documents enable row level security;
create policy "docs read" on public.carrier_documents for select to authenticated using (true);
create policy "docs insert" on public.carrier_documents for insert to authenticated with check (true);
create policy "docs delete admin" on public.carrier_documents for delete to authenticated using (public.has_role(auth.uid(),'admin'));

create table public.carrier_invites (
  id uuid primary key default gen_random_uuid(),
  token uuid not null unique default gen_random_uuid(),
  carrier_id uuid references public.carriers(id) on delete cascade,
  email text,
  status text not null default 'sent' check (status in ('sent','submitted','revoked')),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days',
  submitted_at timestamptz
);
grant select, insert, update, delete on public.carrier_invites to authenticated;
grant all on public.carrier_invites to service_role;
alter table public.carrier_invites enable row level security;
create policy "invites read" on public.carrier_invites for select to authenticated using (true);
create policy "invites insert" on public.carrier_invites for insert to authenticated with check (true);
create policy "invites update" on public.carrier_invites for update to authenticated using (true);

create policy "carrier docs read" on storage.objects for select to authenticated using (bucket_id = 'carrier-docs');
create policy "carrier docs upload" on storage.objects for insert to authenticated with check (bucket_id = 'carrier-docs');
