CREATE OR REPLACE FUNCTION public.save_carrier_invoice_review(p_load uuid, p_bill uuid, p_path text, p_kind text, p_number text, p_amount numeric, p_lines jsonb, p_factor jsonb DEFAULT NULL, p_account jsonb DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE l public.loads%ROWTYPE; c public.carriers%ROWTYPE; b public.qb_sync%ROWTYPE; result uuid; gross numeric; fee numeric;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_finance(auth.uid()) THEN RAISE EXCEPTION 'Only admins and accountants can save carrier billing and payment details'; END IF;
 IF p_kind IS NULL OR p_kind NOT IN ('regular','factoring') OR length(coalesce(p_number,''))>200 OR p_amount<0 OR p_lines IS NULL OR jsonb_typeof(p_lines)<>'array' THEN RAISE EXCEPTION 'Invalid invoice details'; END IF;
 SELECT * INTO l FROM public.loads WHERE id=p_load FOR UPDATE;
 IF NOT FOUND OR l.carrier_id IS NULL THEN RAISE EXCEPTION 'Assign a carrier first'; END IF;
 SELECT * INTO c FROM public.carriers WHERE id=l.carrier_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Carrier unavailable'; END IF;
 IF p_path IS NULL OR p_path NOT LIKE p_load::text || '/%' OR p_path LIKE '%..%' THEN RAISE EXCEPTION 'Invoice file must belong to this load'; END IF;
 IF p_bill IS NOT NULL THEN SELECT * INTO b FROM public.qb_sync WHERE id=p_bill AND load_id=p_load AND kind='bill' FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'Carrier bill unavailable'; END IF;
 ELSE SELECT * INTO b FROM public.qb_sync WHERE load_id=p_load AND kind='bill' ORDER BY queued_at DESC LIMIT 1 FOR UPDATE; END IF;
 IF p_factor IS NOT NULL THEN
  IF p_kind<>'factoring' OR length(trim(coalesce(p_factor->>'company','')))=0 OR length(trim(coalesce(p_factor->>'address','')))=0 OR length(p_factor::text)>5000 THEN RAISE EXCEPTION 'Enter factoring company and remit address'; END IF;
  UPDATE public.carriers SET factoring_company=trim(p_factor->>'company'), factoring_remit=trim(p_factor->>'address'),factoring_remit_address=trim(p_factor->>'address') WHERE id=c.id;
 END IF;
 IF p_account IS NOT NULL THEN
  IF p_factor IS NULL OR length(p_account::text)>10000 THEN RAISE EXCEPTION 'Review factoring company before saving payment details'; END IF;
  IF coalesce(p_account->>'method','') NOT IN ('ach','check','wire') OR (coalesce(p_account->>'routing_number','')<>'' AND p_account->>'routing_number' !~ '^[0-9]{9}$') THEN RAISE EXCEPTION 'Invalid payment method or routing number'; END IF;
  INSERT INTO public.carrier_payment_accounts(carrier_id,method,bank_name,account_name,routing_number,account_number,account_type,remit_email,notes) VALUES(c.id,p_account->>'method',p_account->>'bank_name',p_account->>'account_name',p_account->>'routing_number',p_account->>'account_number',p_account->>'account_type',p_account->>'remit_email',p_account->>'notes') ON CONFLICT(carrier_id) DO UPDATE SET method=excluded.method,bank_name=excluded.bank_name,account_name=excluded.account_name,routing_number=excluded.routing_number,account_number=excluded.account_number,account_type=excluded.account_type,remit_email=excluded.remit_email,notes=excluded.notes;
 END IF;
 IF b.id IS NULL THEN
  SELECT coalesce(l.carrier_rate,0)+coalesce(sum(coalesce((a->>'amount')::numeric,0)),0) INTO gross FROM jsonb_array_elements(coalesce(l.accessorials,'[]'::jsonb)) a;
  fee:=case coalesce(l.pay_terms,c.pay_terms) when 'quickpay' then gross*0.05 when 'factored_quickpay' then gross*0.025 else 0 end;
  INSERT INTO public.qb_sync(load_id,kind,payee,amount,gross_amount,quickpay_fee,status,carrier_invoice_path,carrier_invoice_kind,carrier_invoice_number,carrier_invoice_amount,carrier_invoice_lines) VALUES(p_load,'bill',coalesce(p_factor->>'company',c.factoring_company,c.legal_name),gross-fee,gross,fee,'hold',p_path,p_kind,nullif(trim(p_number),''),p_amount,p_lines) RETURNING id INTO result;
 ELSE
  UPDATE public.qb_sync SET carrier_invoice_path=p_path,carrier_invoice_kind=p_kind,carrier_invoice_number=nullif(trim(p_number),''),carrier_invoice_amount=p_amount,carrier_invoice_lines=p_lines WHERE id=b.id RETURNING id INTO result;
 END IF;
 INSERT INTO public.load_notes(load_id,author_id,body) VALUES(p_load,auth.uid(),'Carrier invoice reviewed ('||p_kind||')'||CASE WHEN p_factor IS NOT NULL THEN '; factoring remit details saved on carrier (NOA and payment status unchanged)' ELSE '' END);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.save_carrier_invoice_review(uuid,uuid,text,text,text,numeric,jsonb,jsonb,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_carrier_invoice_review(uuid,uuid,text,text,text,numeric,jsonb,jsonb,jsonb) TO authenticated;