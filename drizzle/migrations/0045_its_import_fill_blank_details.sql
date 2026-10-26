CREATE OR REPLACE FUNCTION public.import_its_loads(rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r jsonb; ins int := 0; skip int := 0; upd int := 0; fail int := 0; errs jsonb := '[]'::jsonb;
  lid uuid; wo text; cr numeric; kr numeric; pu timestamptz; de timestamptz; wt int;
begin
  if not public.has_role(auth.uid(), 'admin') then raise exception 'Admin only'; end if;
  perform set_config('app.its_import', 'on', true);
  for r in select * from jsonb_array_elements(rows) loop
    begin
      wo := nullif(trim(coalesce(r->>'customer_ref','')), '');
      cr := nullif(r->>'customer_rate','')::numeric;
      kr := nullif(r->>'carrier_rate','')::numeric;
      pu := nullif(r->>'pickup_at','')::timestamptz;
      de := nullif(r->>'delivery_at','')::timestamptz;
      wt := nullif(r->>'weight_lbs','')::int;
      lid := null;
      select id into lid from public.loads
        where (external_ref = r->>'external_ref' and coalesce(source,'its') = 'its')
           or load_number = r->>'load_number'
        order by (source = 'its') desc nulls last limit 1;
      if lid is not null then
        -- Fill blanks only (W/O # always wins as Customer ref #).
        update public.loads l set
          customer_ref = coalesce(wo, l.customer_ref),
          ship_ref = coalesce(nullif(l.ship_ref,''), nullif(r->>'ship_ref','')),
          external_ref = coalesce(l.external_ref, r->>'external_ref'),
          customer_rate = case when coalesce(l.customer_rate,0) = 0 and cr is not null then cr else l.customer_rate end,
          carrier_rate = case when coalesce(l.carrier_rate,0) = 0 and kr is not null then kr else l.carrier_rate end,
          carrier_id = coalesce(l.carrier_id, nullif(r->>'carrier_id','')::uuid),
          customer_id = coalesce(l.customer_id, nullif(r->>'customer_id','')::uuid),
          origin_city = coalesce(nullif(l.origin_city,''), nullif(r->>'origin_city',''), l.origin_city),
          origin_state = coalesce(nullif(l.origin_state,''), nullif(r->>'origin_state',''), l.origin_state),
          dest_city = coalesce(nullif(l.dest_city,''), nullif(r->>'dest_city',''), l.dest_city),
          dest_state = coalesce(nullif(l.dest_state,''), nullif(r->>'dest_state',''), l.dest_state),
          pickup_at = coalesce(l.pickup_at, pu),
          delivery_at = coalesce(l.delivery_at, de),
          weight_lbs = coalesce(l.weight_lbs, wt)
        where l.id = lid
          and (l.customer_ref is distinct from coalesce(wo, l.customer_ref)
            or (nullif(l.ship_ref,'') is null and nullif(r->>'ship_ref','') is not null)
            or l.external_ref is null
            or (coalesce(l.customer_rate,0) = 0 and cr is not null)
            or (coalesce(l.carrier_rate,0) = 0 and kr is not null)
            or (l.carrier_id is null and nullif(r->>'carrier_id','') is not null)
            or (l.customer_id is null and nullif(r->>'customer_id','') is not null)
            or (nullif(l.origin_city,'') is null and nullif(r->>'origin_city','') is not null)
            or (nullif(l.origin_state,'') is null and nullif(r->>'origin_state','') is not null)
            or (nullif(l.dest_city,'') is null and nullif(r->>'dest_city','') is not null)
            or (nullif(l.dest_state,'') is null and nullif(r->>'dest_state','') is not null)
            or (l.pickup_at is null and pu is not null)
            or (l.delivery_at is null and de is not null)
            or (l.weight_lbs is null and wt is not null));
        if found then upd := upd + 1; else skip := skip + 1; end if;
      else
        insert into public.loads (load_number, source, external_ref, customer_id, carrier_id, broker_id, origin_city, origin_state, dest_city, dest_state, pickup_at, delivery_at, equipment, weight_lbs, customer_rate, carrier_rate, status, accessorials, ship_ref, customer_ref)
        values (r->>'load_number', 'its', r->>'external_ref', nullif(r->>'customer_id','')::uuid, nullif(r->>'carrier_id','')::uuid, nullif(r->>'broker_id','')::uuid, coalesce(r->>'origin_city',''), coalesce(r->>'origin_state',''), coalesce(r->>'dest_city',''), coalesce(r->>'dest_state',''), pu, de, coalesce(nullif(r->>'equipment',''),'Van'), wt, coalesce(cr,0), coalesce(kr,0), coalesce(r->>'status','booked')::public.load_status, '[]'::jsonb, nullif(r->>'ship_ref',''), wo);
        ins := ins + 1;
      end if;
    exception when others then
      fail := fail + 1;
      if jsonb_array_length(errs) < 20 then errs := errs || jsonb_build_object('load', r->>'load_number', 'error', sqlerrm); end if;
    end;
  end loop;
  return jsonb_build_object('inserted', ins, 'updated', upd, 'skipped', skip, 'failed', fail, 'errors', errs);
end $function$;