CREATE OR REPLACE FUNCTION public.import_its_loads(rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r jsonb; ins int := 0; skip int := 0; upd int := 0; fail int := 0; errs jsonb := '[]'::jsonb;
  lid uuid; wo text; cr numeric; kr numeric;
begin
  if not public.has_role(auth.uid(), 'admin') then raise exception 'Admin only'; end if;
  perform set_config('app.its_import', 'on', true);
  for r in select * from jsonb_array_elements(rows) loop
    wo := nullif(trim(coalesce(r->>'customer_ref','')), '');
    cr := nullif(r->>'customer_rate','')::numeric;
    kr := nullif(r->>'carrier_rate','')::numeric;
    select id into lid from public.loads
      where (external_ref = r->>'external_ref' and coalesce(source,'its') = 'its')
         or load_number = r->>'load_number'
      order by (source = 'its') desc nulls last limit 1;
    begin
      if lid is not null then
        update public.loads l set
          customer_ref = coalesce(wo, l.customer_ref),
          ship_ref = coalesce(nullif(l.ship_ref,''), nullif(r->>'ship_ref','')),
          external_ref = coalesce(l.external_ref, r->>'external_ref'),
          customer_rate = case when coalesce(l.customer_rate,0) = 0 and cr is not null then cr else l.customer_rate end,
          carrier_rate = case when coalesce(l.carrier_rate,0) = 0 and kr is not null then kr else l.carrier_rate end,
          carrier_id = coalesce(l.carrier_id, nullif(r->>'carrier_id','')::uuid),
          customer_id = coalesce(l.customer_id, nullif(r->>'customer_id','')::uuid)
        where l.id = lid
          and (l.customer_ref is distinct from coalesce(wo, l.customer_ref)
            or (nullif(l.ship_ref,'') is null and nullif(r->>'ship_ref','') is not null)
            or l.external_ref is null
            or (coalesce(l.customer_rate,0) = 0 and cr is not null)
            or (coalesce(l.carrier_rate,0) = 0 and kr is not null)
            or (l.carrier_id is null and nullif(r->>'carrier_id','') is not null)
            or (l.customer_id is null and nullif(r->>'customer_id','') is not null));
        if found then upd := upd + 1; else skip := skip + 1; end if;
      else
        insert into public.loads (load_number, source, external_ref, customer_id, carrier_id, broker_id, origin_city, origin_state, dest_city, dest_state, pickup_at, delivery_at, equipment, weight_lbs, customer_rate, carrier_rate, status, accessorials, ship_ref, customer_ref)
        values (r->>'load_number', 'its', r->>'external_ref', nullif(r->>'customer_id','')::uuid, nullif(r->>'carrier_id','')::uuid, nullif(r->>'broker_id','')::uuid, coalesce(r->>'origin_city',''), coalesce(r->>'origin_state',''), coalesce(r->>'dest_city',''), coalesce(r->>'dest_state',''), nullif(r->>'pickup_at','')::timestamptz, nullif(r->>'delivery_at','')::timestamptz, coalesce(nullif(r->>'equipment',''),'Van'), nullif(r->>'weight_lbs','')::int, coalesce(cr,0), coalesce(kr,0), coalesce(r->>'status','booked')::public.load_status, '[]'::jsonb, nullif(r->>'ship_ref',''), wo);
        ins := ins + 1;
      end if;
    exception when others then
      fail := fail + 1;
      if jsonb_array_length(errs) < 20 then errs := errs || jsonb_build_object('load', r->>'load_number', 'error', sqlerrm); end if;
    end;
  end loop;
  return jsonb_build_object('inserted', ins, 'updated', upd, 'skipped', skip, 'failed', fail, 'errors', errs);
end $function$;