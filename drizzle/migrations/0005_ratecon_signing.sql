
alter table public.loads add column ratecon_pdf_path text, add column ship_ref text, add column dest_ref text;

create table public.ratecon_requests (
  id uuid primary key default gen_random_uuid(),
  token uuid not null unique default gen_random_uuid(),
  load_id uuid not null references public.loads(id) on delete cascade,
  carrier_email text,
  snapshot jsonb not null,
  status text not null default 'sent' check (status in ('sent','signed','void')),
  signer_name text,
  signer_title text,
  signed_at timestamptz,
  pdf_path text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days'
);
grant select, insert, update on public.ratecon_requests to authenticated;
grant all on public.ratecon_requests to service_role;
alter table public.ratecon_requests enable row level security;
create policy "ratecon req read" on public.ratecon_requests for select to authenticated
  using (exists (select 1 from public.loads l where l.id = load_id));
create policy "ratecon req insert" on public.ratecon_requests for insert to authenticated
  with check (exists (select 1 from public.loads l where l.id = load_id));
create policy "ratecon req update" on public.ratecon_requests for update to authenticated
  using (exists (select 1 from public.loads l where l.id = load_id));
