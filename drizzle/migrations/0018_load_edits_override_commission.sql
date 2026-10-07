ALTER TABLE public.broker_commissions ALTER COLUMN commission_pct SET DEFAULT 0;
UPDATE public.broker_commissions SET commission_pct = 0 WHERE commission_pct <> 0;

CREATE POLICY "Authors or admins update notes" ON public.load_notes FOR UPDATE TO authenticated
  USING (author_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (author_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
DROP POLICY IF EXISTS "Authors or admins delete notes" ON public.load_notes;
CREATE POLICY "Authors or admins delete notes" ON public.load_notes FOR DELETE TO authenticated
  USING (author_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.load_notes TO authenticated;

ALTER TABLE public.loads ADD COLUMN IF NOT EXISTS override_by uuid, ADD COLUMN IF NOT EXISTS override_at timestamptz, ADD COLUMN IF NOT EXISTS override_reason text;

CREATE OR REPLACE FUNCTION public.guard_load_override()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
begin
  if (tg_op = 'INSERT' and new.override_reason is not null)
     or (tg_op = 'UPDATE' and (new.override_reason is distinct from old.override_reason or new.override_by is distinct from old.override_by)) then
    if auth.uid() is not null and not public.has_role(auth.uid(), 'admin') then
      raise exception 'Only admins can override carrier compliance';
    end if;
    if new.override_reason is not null then
      new.override_by := coalesce(auth.uid(), new.override_by);
      new.override_at := now();
    end if;
  end if;
  return new;
end $$;
DROP TRIGGER IF EXISTS loads_override_guard ON public.loads;
CREATE TRIGGER loads_override_guard BEFORE INSERT OR UPDATE ON public.loads FOR EACH ROW EXECUTE FUNCTION public.guard_load_override();

CREATE OR REPLACE FUNCTION public.enforce_carrier_compliance()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
declare c record; cond boolean; ovr boolean;
begin
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