
create type public.app_role as enum ('admin','broker');
create type public.load_status as enum ('available','vetting','booked','dispatched','rolling','delivered','invoiced','paid','issue');
create type public.carrier_status as enum ('pending','vetted','dnu');

create table public.profiles (
  id uuid primary key,
  full_name text,
  email text,
  created_at timestamptz not null default now()
);
grant select, insert, update on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  role app_role not null,
  unique(user_id, role)
);
grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
alter table public.user_roles enable row level security;

create or replace function public.has_role(_user_id uuid, _role app_role)
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.user_roles where user_id=_user_id and role=_role) $$;

create policy "profiles readable" on public.profiles for select to authenticated using (true);
create policy "own profile insert" on public.profiles for insert to authenticated with check (id = auth.uid());
create policy "own profile update" on public.profiles for update to authenticated using (id = auth.uid() or public.has_role(auth.uid(),'admin'));
create policy "see own roles or admin" on public.user_roles for select to authenticated using (user_id = auth.uid() or public.has_role(auth.uid(),'admin'));
create policy "admin manage roles" on public.user_roles for all to authenticated using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(id, full_name, email) values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email), new.email);
  if not exists (select 1 from public.user_roles where role='admin') then
    insert into public.user_roles(user_id, role) values (new.id, 'admin');
  else
    insert into public.user_roles(user_id, role) values (new.id, 'broker');
  end if;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

create table public.broker_commissions (
  user_id uuid primary key,
  commission_pct numeric not null default 30,
  updated_at timestamptz not null default now()
);
grant select, insert, update, delete on public.broker_commissions to authenticated;
grant all on public.broker_commissions to service_role;
alter table public.broker_commissions enable row level security;
create policy "admin or self read commission" on public.broker_commissions for select to authenticated using (user_id = auth.uid() or public.has_role(auth.uid(),'admin'));
create policy "admin write commission" on public.broker_commissions for all to authenticated using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('customer','shipper','consignee')),
  name text not null,
  address text, city text, state text, zip text, phone text, email text, contact_name text,
  notes text,
  created_by uuid,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.companies to authenticated;
grant all on public.companies to service_role;
alter table public.companies enable row level security;
create policy "directory read" on public.companies for select to authenticated using (true);
create policy "directory insert" on public.companies for insert to authenticated with check (true);
create policy "directory update" on public.companies for update to authenticated using (true);
create policy "directory delete admin" on public.companies for delete to authenticated using (public.has_role(auth.uid(),'admin'));

create table public.carriers (
  id uuid primary key default gen_random_uuid(),
  legal_name text not null,
  dba text,
  mc_number text, dot_number text,
  address text, city text, state text, zip text, phone text, email text, contact_name text,
  authority_status text not null default 'Authorized',
  safety_rating text default 'Not Rated',
  insurance_expires date,
  cargo_insurance numeric default 100000,
  auto_liability numeric default 1000000,
  status carrier_status not null default 'pending',
  dnu_reason text,
  w9_received boolean not null default false,
  coi_received boolean not null default false,
  agreement_signed boolean not null default false,
  factoring_company text,
  factoring_remit text,
  equipment text,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.carriers to authenticated;
grant all on public.carriers to service_role;
alter table public.carriers enable row level security;
create policy "carriers read" on public.carriers for select to authenticated using (true);
create policy "carriers insert" on public.carriers for insert to authenticated with check (true);
create policy "carriers update" on public.carriers for update to authenticated using (true);
create policy "carriers delete admin" on public.carriers for delete to authenticated using (public.has_role(auth.uid(),'admin'));

create sequence public.load_number_seq start 10450;
grant usage on sequence public.load_number_seq to authenticated;
create table public.loads (
  id uuid primary key default gen_random_uuid(),
  load_number text not null default ('CW-' || nextval('public.load_number_seq')),
  status load_status not null default 'available',
  broker_id uuid,
  customer_id uuid references public.companies(id) on delete set null,
  shipper_id uuid references public.companies(id) on delete set null,
  consignee_id uuid references public.companies(id) on delete set null,
  carrier_id uuid references public.carriers(id) on delete set null,
  origin_city text not null, origin_state text not null,
  dest_city text not null, dest_state text not null,
  pickup_at timestamptz, delivery_at timestamptz,
  equipment text not null default 'Dry Van',
  commodity text, weight_lbs integer, pieces integer, temperature text,
  miles integer,
  pickup_notes text, delivery_notes text,
  customer_rate numeric not null default 0,
  carrier_rate numeric not null default 0,
  accessorials jsonb not null default '[]'::jsonb,
  last_check_call timestamptz,
  ratecon_signed boolean not null default false,
  pod_received boolean not null default false,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.loads to authenticated;
grant all on public.loads to service_role;
alter table public.loads enable row level security;
create policy "loads read" on public.loads for select to authenticated using (broker_id is null or broker_id = auth.uid() or public.has_role(auth.uid(),'admin'));
create policy "loads insert" on public.loads for insert to authenticated with check (broker_id = auth.uid() or broker_id is null or public.has_role(auth.uid(),'admin'));
create policy "loads update" on public.loads for update to authenticated using (broker_id is null or broker_id = auth.uid() or public.has_role(auth.uid(),'admin'));
create policy "loads delete" on public.loads for delete to authenticated using (broker_id = auth.uid() or public.has_role(auth.uid(),'admin'));

create or replace function public.enforce_carrier_compliance()
returns trigger language plpgsql set search_path = public as $$
declare c record;
begin
  if new.carrier_id is not null and (tg_op = 'INSERT' or new.carrier_id is distinct from old.carrier_id) then
    select * into c from public.carriers where id = new.carrier_id;
    if c.status = 'dnu' then raise exception 'Carrier % is on the Do Not Use list: %', c.legal_name, c.dnu_reason; end if;
    if c.status <> 'vetted' then raise exception 'Carrier % is not vetted yet', c.legal_name; end if;
    if c.authority_status <> 'Authorized' then raise exception 'Carrier % authority is %', c.legal_name, c.authority_status; end if;
    if c.insurance_expires is null or c.insurance_expires < current_date then raise exception 'Carrier % insurance is missing or expired', c.legal_name; end if;
  end if;
  return new;
end $$;
create trigger loads_carrier_compliance before insert or update on public.loads for each row execute function public.enforce_carrier_compliance();

insert into public.companies (id, kind, name, address, city, state, zip, phone, contact_name) values
 ('11111111-0000-0000-0000-000000000001','customer','Piedmont Foods Distribution','2200 Industrial Blvd','Greensboro','NC','27406','(336) 555-0142','Dana Whitfield'),
 ('11111111-0000-0000-0000-000000000002','customer','Carolina Building Supply','800 Lumber Ln','Raleigh','NC','27610','(919) 555-0188','Marcus Hale'),
 ('11111111-0000-0000-0000-000000000003','customer','Blue Ridge Textiles','45 Mill St','Burlington','NC','27215','(336) 555-0177','Priya Shah'),
 ('22222222-0000-0000-0000-000000000001','shipper','Piedmont Foods - Greensboro DC','2200 Industrial Blvd','Greensboro','NC','27406','(336) 555-0142','Dock Office'),
 ('22222222-0000-0000-0000-000000000002','shipper','Siler City Lumber Yard','310 Hwy 64 W','Siler City','NC','27344','(919) 555-0123','Yard Manager'),
 ('22222222-0000-0000-0000-000000000003','shipper','Blue Ridge Textiles Plant 2','45 Mill St','Burlington','NC','27215','(336) 555-0177','Shipping'),
 ('33333333-0000-0000-0000-000000000001','consignee','Food Lion DC #4','1 Distribution Dr','Salisbury','NC','28147','(704) 555-0101','Receiving'),
 ('33333333-0000-0000-0000-000000000002','consignee','Lowe''s RDC Charlotte','9500 Logistics Pkwy','Charlotte','NC','28273','(704) 555-0166','Receiving'),
 ('33333333-0000-0000-0000-000000000003','consignee','Atlanta Apparel Hub','600 Peachtree Ind','Atlanta','GA','30318','(404) 555-0190','Inbound');

insert into public.carriers (id, legal_name, dba, mc_number, dot_number, city, state, phone, authority_status, safety_rating, insurance_expires, status, w9_received, coi_received, agreement_signed, factoring_company, equipment) values
 ('44444444-0000-0000-0000-000000000001','Tar Heel Transport LLC',null,'812345','2345678','Asheboro','NC','(336) 555-0211','Authorized','Satisfactory', current_date + 200,'vetted',true,true,true,'RTS Financial','Dry Van'),
 ('44444444-0000-0000-0000-000000000002','Coastal Reefer Inc','Coastal Cold','923456','3456789','Wilmington','NC','(910) 555-0233','Authorized','Satisfactory', current_date + 90,'vetted',true,true,true,null,'Reefer'),
 ('44444444-0000-0000-0000-000000000003','Southern Flat Haulers','SFH','734567','1234567','Columbia','SC','(803) 555-0244','Authorized','Not Rated', current_date + 30,'pending',true,false,false,null,'Flatbed'),
 ('44444444-0000-0000-0000-000000000004','Quick Lane Logistics',null,'645678','4567890','Newark','NJ','(973) 555-0299','Inactive','Conditional', current_date - 10,'dnu',false,false,false,null,'Dry Van');
update public.carriers set dnu_reason='Double-brokering' where id='44444444-0000-0000-0000-000000000004';

insert into public.loads (status, customer_id, shipper_id, consignee_id, carrier_id, origin_city, origin_state, dest_city, dest_state, pickup_at, delivery_at, equipment, commodity, weight_lbs, pieces, temperature, miles, customer_rate, carrier_rate, pickup_notes, delivery_notes, last_check_call, accessorials) values
 ('available','11111111-0000-0000-0000-000000000001','22222222-0000-0000-0000-000000000001','33333333-0000-0000-0000-000000000001',null,'Greensboro','NC','Salisbury','NC', now() + interval '1 day', now() + interval '1 day 6 hours','Reefer','Frozen poultry',38000,22,'-10°F',62,950,0,'Check in at guard shack. Seal required.','Appointment only, lumper on site.',null,'[]'),
 ('available','11111111-0000-0000-0000-000000000002','22222222-0000-0000-0000-000000000002','33333333-0000-0000-0000-000000000002',null,'Siler City','NC','Charlotte','NC', now() + interval '2 days', now() + interval '2 days 5 hours','Flatbed','Treated lumber',44000,18,null,110,1250,0,'Tarps required, 8ft drops.','Call 1hr ahead.',null,'[]'),
 ('dispatched','11111111-0000-0000-0000-000000000003','22222222-0000-0000-0000-000000000003','33333333-0000-0000-0000-000000000003','44444444-0000-0000-0000-000000000001','Burlington','NC','Atlanta','GA', now() - interval '3 hours', now() + interval '10 hours','Dry Van','Textile rolls',22000,40,null,340,2100,1650,'Load is floor-loaded.','No early deliveries.', now() - interval '5 hours','[{"type":"Lumper","amount":75}]'),
 ('rolling','11111111-0000-0000-0000-000000000001','22222222-0000-0000-0000-000000000001','33333333-0000-0000-0000-000000000003','44444444-0000-0000-0000-000000000002','Greensboro','NC','Atlanta','GA', now() - interval '8 hours', now() + interval '4 hours','Reefer','Produce',40000,24,'34°F',320,2400,1850,null,null, now() - interval '1 hour','[]'),
 ('delivered','11111111-0000-0000-0000-000000000002','22222222-0000-0000-0000-000000000002','33333333-0000-0000-0000-000000000002','44444444-0000-0000-0000-000000000001','Siler City','NC','Charlotte','NC', now() - interval '5 days', now() - interval '4 days','Dry Van','Building materials',30000,12,null,110,1100,850,null,null,null,'[{"type":"Detention","amount":100}]'),
 ('invoiced','11111111-0000-0000-0000-000000000003','22222222-0000-0000-0000-000000000003','33333333-0000-0000-0000-000000000003','44444444-0000-0000-0000-000000000001','Burlington','NC','Atlanta','GA', now() - interval '40 days', now() - interval '39 days','Dry Van','Textile rolls',21000,38,null,340,2050,1600,null,null,null,'[]'),
 ('paid','11111111-0000-0000-0000-000000000001','22222222-0000-0000-0000-000000000001','33333333-0000-0000-0000-000000000001','44444444-0000-0000-0000-000000000002','Greensboro','NC','Salisbury','NC', now() - interval '20 days', now() - interval '20 days','Reefer','Frozen poultry',37000,22,'-10°F',62,900,700,null,null,null,'[]'),
 ('issue','11111111-0000-0000-0000-000000000002','22222222-0000-0000-0000-000000000002','33333333-0000-0000-0000-000000000002','44444444-0000-0000-0000-000000000001','Siler City','NC','Charlotte','NC', now() - interval '6 hours', now() + interval '2 hours','Flatbed','Steel beams',46000,8,null,110,1400,1100,null,null, now() - interval '6 hours','[]');
