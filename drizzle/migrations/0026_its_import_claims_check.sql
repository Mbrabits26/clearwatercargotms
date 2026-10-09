CREATE OR REPLACE FUNCTION public.enforce_carrier_compliance()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
declare c record; cond boolean; ovr boolean;
begin
  -- historical imports run server-side only (no API request claims present)
  if new.source = 'its' and coalesce(current_setting('request.jwt.claims', true), '') = '' then return new; end if;
  if new.carrier_id is not null and (tg_op = 'INSERT' or new.carrier_id is distinct from old.carrier_id) then
    select * into c from public.carriers where id = new.carrier_id;
    if c.status = 'dnu' then raise exception 'Carrier % is on the Do Not Use list: %', c.legal_name, c.dnu_reason; end if;
    if c.authority_status <> 'Authorized' then raise exception 'Carrier % authority is %', c.legal_name, c.authority_status; end if;
    ovr := new.override_reason is not null and length(trim(new.override_reason)) > 0 and public.has_role(auth.uid(), 'admin');
    if ovr then return new; end if;
    cond := c.status = 'pending' and c.conditional_until is not null and c.conditional_until >= current_date;
    if c.status <> 'vetted' and not cond then raise exception 'Carrier % is not vetted yet', c.legal_name; end if;
    if not cond and (c.insurance_expires is null or c.insurance_expires < current_date) then raise exception 'Carrier % insurance is missing or expired', c.legal_name; end if;
  end if;
  return new;
end $function$;