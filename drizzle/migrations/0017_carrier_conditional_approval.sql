ALTER TABLE public.carriers ADD COLUMN IF NOT EXISTS conditional_until date, ADD COLUMN IF NOT EXISTS conditional_note text, ADD COLUMN IF NOT EXISTS conditional_by uuid;

CREATE OR REPLACE FUNCTION public.enforce_carrier_compliance()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
declare c record; cond boolean;
begin
  if new.carrier_id is not null and (tg_op = 'INSERT' or new.carrier_id is distinct from old.carrier_id) then
    select * into c from public.carriers where id = new.carrier_id;
    if c.status = 'dnu' then raise exception 'Carrier % is on the Do Not Use list: %', c.legal_name, c.dnu_reason; end if;
    if c.authority_status <> 'Authorized' then raise exception 'Carrier % authority is %', c.legal_name, c.authority_status; end if;
    cond := c.status = 'pending' and c.conditional_until is not null and c.conditional_until >= current_date;
    if c.status <> 'vetted' and not cond then raise exception 'Carrier % is not vetted yet', c.legal_name; end if;
    if not cond and (c.insurance_expires is null or c.insurance_expires < current_date) then raise exception 'Carrier % insurance is missing or expired', c.legal_name; end if;
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.guard_carrier_conditional()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
begin
  if (new.conditional_until is distinct from old.conditional_until or new.conditional_note is distinct from old.conditional_note or new.conditional_by is distinct from old.conditional_by)
     and auth.uid() is not null and not public.has_role(auth.uid(), 'admin') then
    raise exception 'Only admins can conditionally approve carriers';
  end if;
  return new;
end $function$;

DROP TRIGGER IF EXISTS carriers_conditional_guard ON public.carriers;
CREATE TRIGGER carriers_conditional_guard BEFORE UPDATE ON public.carriers FOR EACH ROW EXECUTE FUNCTION public.guard_carrier_conditional();