create table public.leads (
  id uuid primary key default gen_random_uuid(),
  company_name text not null,
  contact_name text, phone text, email text, city text, state text,
  lanes text, source text, est_monthly_loads integer,
  stage text not null default 'new' check (stage in ('new','contacted','quoting','negotiating','won','lost')),
  lost_reason text, next_follow_up date,
  owner_id uuid default auth.uid(),
  company_id uuid references public.companies(id) on delete set null,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.leads to authenticated;
grant all on public.leads to service_role;
alter table public.leads enable row level security;
create policy "leads own or admin" on public.leads for all to authenticated
  using (public.is_staff(auth.uid()) and (owner_id = auth.uid() or public.has_role(auth.uid(),'admin')))
  with check (public.is_staff(auth.uid()) and (owner_id = auth.uid() or public.has_role(auth.uid(),'admin')));

create table public.lead_activities (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  method text not null default 'call',
  notes text check (char_length(notes) <= 4000),
  occurred_at timestamptz not null default now(),
  follow_up date,
  author_id uuid default auth.uid(),
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.lead_activities to authenticated;
grant all on public.lead_activities to service_role;
alter table public.lead_activities enable row level security;
create policy "lead activities via lead" on public.lead_activities for all to authenticated
  using (exists (select 1 from public.leads l where l.id = lead_id))
  with check (exists (select 1 from public.leads l where l.id = lead_id));

update public.user_permissions set perms = array_append(perms,'leads') where not ('leads' = any(perms));