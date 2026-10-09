create table public.deletion_log (
  id uuid primary key default gen_random_uuid(),
  table_name text not null,
  row_id uuid,
  label text,
  snapshot jsonb not null,
  deleted_by uuid,
  deleted_at timestamptz not null default now()
);
grant select on public.deletion_log to authenticated;
grant all on public.deletion_log to service_role;
alter table public.deletion_log enable row level security;
create policy "admins read deletion log" on public.deletion_log for select to authenticated using (public.has_role(auth.uid(),'admin'));

create or replace function public.log_deletion() returns trigger language plpgsql security definer set search_path = public as $$
declare j jsonb := to_jsonb(old);
begin
  insert into public.deletion_log(table_name,row_id,label,snapshot,deleted_by)
  values (tg_table_name, (j->>'id')::uuid,
    coalesce(j->>'load_number', j->>'legal_name', j->>'name', j->>'company_name', j->>'quote_number', j->>'unit_number', j->>'full_name', j->>'file_name', j->>'invoice_number', j->>'kind'),
    j, auth.uid());
  return old;
end $$;

do $$ declare t text; begin
  foreach t in array array['companies','carriers','carrier_documents','drivers','fleet_units','leads','quotes','loads','load_notes','qb_sync','load_offers','load_tracking_tokens'] loop
    execute format('create trigger %I after delete on public.%I for each row execute function public.log_deletion()', 'log_delete_'||t, t);
  end loop;
end $$;

-- staff may delete directory/carrier/fleet items
create policy "staff delete companies" on public.companies for delete to authenticated using (public.is_staff(auth.uid()));
create policy "staff delete carriers" on public.carriers for delete to authenticated using (public.is_staff(auth.uid()));
create policy "staff delete carrier docs" on public.carrier_documents for delete to authenticated using (public.is_staff(auth.uid()));
create policy "staff delete drivers" on public.drivers for delete to authenticated using (public.is_staff(auth.uid()));
create policy "staff delete fleet" on public.fleet_units for delete to authenticated using (public.is_staff(auth.uid()));

-- deleting a referenced record blanks it on loads/quotes/leads instead of failing
alter table public.loads drop constraint loads_driver_id_fkey, add constraint loads_driver_id_fkey foreign key (driver_id) references public.drivers(id) on delete set null;
alter table public.loads drop constraint loads_customer_id_fkey, add constraint loads_customer_id_fkey foreign key (customer_id) references public.companies(id) on delete set null;
alter table public.loads drop constraint loads_shipper_id_fkey, add constraint loads_shipper_id_fkey foreign key (shipper_id) references public.companies(id) on delete set null;
alter table public.loads drop constraint loads_consignee_id_fkey, add constraint loads_consignee_id_fkey foreign key (consignee_id) references public.companies(id) on delete set null;
alter table public.loads drop constraint loads_carrier_id_fkey, add constraint loads_carrier_id_fkey foreign key (carrier_id) references public.carriers(id) on delete set null;
alter table public.loads drop constraint loads_truck_id_fkey, add constraint loads_truck_id_fkey foreign key (truck_id) references public.fleet_units(id) on delete set null;
alter table public.loads drop constraint loads_trailer_id_fkey, add constraint loads_trailer_id_fkey foreign key (trailer_id) references public.fleet_units(id) on delete set null;
alter table public.quotes drop constraint quotes_customer_id_fkey, add constraint quotes_customer_id_fkey foreign key (customer_id) references public.companies(id) on delete set null;
alter table public.quotes drop constraint quotes_load_id_fkey, add constraint quotes_load_id_fkey foreign key (load_id) references public.loads(id) on delete set null;
alter table public.leads drop constraint leads_company_id_fkey, add constraint leads_company_id_fkey foreign key (company_id) references public.companies(id) on delete set null;

-- accounting-linked loads: admins only
create or replace function public.guard_load_delete() returns trigger language plpgsql security definer set search_path = public as $$
BEGIN
  IF public.has_role(auth.uid(), 'admin') THEN RETURN OLD; END IF;
  IF OLD.status::text IN ('invoiced','paid') THEN RAISE EXCEPTION 'This load was invoiced or paid — only an admin can delete it.'; END IF;
  IF OLD.ratecon_signed OR EXISTS (SELECT 1 FROM ratecon_requests WHERE load_id = OLD.id AND status = 'signed') THEN RAISE EXCEPTION 'This load has a signed rate con — only an admin can delete it.'; END IF;
  IF EXISTS (SELECT 1 FROM qb_sync WHERE load_id = OLD.id) THEN RAISE EXCEPTION 'This load has accounting records — only an admin can delete it.'; END IF;
  RETURN OLD;
END $$;