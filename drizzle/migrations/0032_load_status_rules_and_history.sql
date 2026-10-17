CREATE OR REPLACE FUNCTION public.enforce_load_rules()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare is_admin boolean := auth.uid() is not null and public.has_role(auth.uid(), 'admin');
declare app_user boolean := coalesce(current_setting('request.jwt.claims', true), '') <> '';
begin
  if new.source = 'its' and (not app_user or current_setting('app.its_import', true) = 'on') then return new; end if;
  if not app_user then return new; end if;
  if new.customer_rate < 0 or new.carrier_rate < 0 then raise exception 'Rates cannot be negative'; end if;
  if new.pickup_at is not null and new.delivery_at is not null and new.delivery_at < new.pickup_at then
    raise exception 'Delivery date can''t be before the pickup date'; end if;
  if (tg_op = 'INSERT' or new.status is distinct from old.status) and not is_admin then
    if new.status in ('booked','dispatched','rolling','delivered','invoiced','paid') and new.customer_id is null then
      raise exception 'Add a customer before moving this load to %', new.status; end if;
    if new.status in ('dispatched','rolling','delivered','invoiced','paid') and new.carrier_id is null and new.truck_id is null then
      raise exception 'Assign a carrier or company truck before moving this load to %', new.status; end if;
    if new.status in ('invoiced','paid') and not exists (select 1 from public.qb_sync where load_id = new.id and kind in ('invoice','fleet_invoice')) then
      raise exception 'Create the customer invoice before marking this load %', new.status; end if;
  end if;
  return new;
end $$;

CREATE TRIGGER loads_rules BEFORE INSERT OR UPDATE ON public.loads FOR EACH ROW EXECUTE FUNCTION public.enforce_load_rules();

CREATE OR REPLACE FUNCTION public.log_load_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
begin
  if new.status is distinct from old.status and auth.uid() is not null then
    insert into public.load_notes(load_id, author_id, body)
    values (new.id, auth.uid(), 'Status changed: ' || old.status || ' → ' || new.status);
  end if;
  return new;
end $$;

CREATE TRIGGER loads_status_log AFTER UPDATE OF status ON public.loads FOR EACH ROW EXECUTE FUNCTION public.log_load_status();