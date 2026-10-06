
create table public.qb_sync (
  id uuid primary key default gen_random_uuid(),
  load_id uuid not null references public.loads(id) on delete cascade,
  kind text not null check (kind in ('invoice','bill')),
  payee text,
  amount numeric not null default 0,
  status text not null default 'queued' check (status in ('queued','sent','error')),
  qb_ref text,
  error text,
  created_by uuid,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (load_id, kind)
);
grant select, insert, update, delete on public.qb_sync to authenticated;
grant all on public.qb_sync to service_role;
alter table public.qb_sync enable row level security;
create policy "qb read admin" on public.qb_sync for select to authenticated using (public.has_role(auth.uid(),'admin'));
create policy "qb write admin" on public.qb_sync for all to authenticated using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));
