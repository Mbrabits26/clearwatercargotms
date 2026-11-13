CREATE OR REPLACE FUNCTION public.apply_invoice_correction(p_plan jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE item jsonb; r public.qb_sync%ROWTYPE; n text; k text; result jsonb := '[]';
BEGIN
 IF NOT public.is_finance(auth.uid()) THEN RAISE EXCEPTION 'Only admins or accountants can correct invoice assignments.'; END IF;
 IF jsonb_typeof(p_plan) <> 'array' OR jsonb_array_length(p_plan) = 0 THEN RAISE EXCEPTION 'No invoice corrections supplied.'; END IF;
 LOCK TABLE public.qb_sync IN SHARE ROW EXCLUSIVE MODE;
 IF (SELECT count(*) FROM jsonb_array_elements(p_plan)) <> (SELECT count(DISTINCT v->>'id') FROM jsonb_array_elements(p_plan) v) THEN RAISE EXCEPTION 'Duplicate correction entries.'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_plan) LOOP
  SELECT * INTO r FROM public.qb_sync WHERE id = (item->>'id')::uuid FOR UPDATE;
  IF NOT FOUND OR r.kind NOT IN ('invoice','fleet_invoice') THEN RAISE EXCEPTION 'Customer invoice not found.'; END IF;
  IF r.qb_ref IS DISTINCT FROM (item->>'previousRef') OR r.invoice_number IS DISTINCT FROM (item->>'previousNumber') OR r.kind IS DISTINCT FROM (item->>'previousKind') THEN RAISE EXCEPTION 'An invoice changed. Refresh and verify both loads again.'; END IF;
  k := item->>'kind';
  IF k NOT IN ('invoice','fleet_invoice') THEN RAISE EXCEPTION 'Unknown billing company.'; END IF;
  IF EXISTS(SELECT 1 FROM public.qb_sync o WHERE o.load_id = r.load_id AND o.kind = k AND o.id <> r.id AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_plan) v WHERE (v->>'id')::uuid = o.id)) THEN RAISE EXCEPTION 'Load already has an invoice in the selected company.'; END IF;
  IF item->>'qbRef' IS NOT NULL AND (item->>'number' IS NULL OR item->>'status' <> 'sent' OR k <> r.kind) THEN RAISE EXCEPTION 'Existing QuickBooks invoice must be verified in its original company.'; END IF;
  IF item->>'qbRef' IS NULL AND item->>'status' <> 'hold' THEN RAISE EXCEPTION 'Unlinked invoices must stay on hold.'; END IF;
 END LOOP;
 -- Verify whole combined groups are included, including members added since the preview.
 FOR item IN SELECT value FROM jsonb_array_elements(p_plan) LOOP
  IF item->>'previousNumber' IS NOT NULL AND EXISTS(SELECT 1 FROM public.qb_sync o WHERE o.kind = item->>'previousKind' AND o.invoice_number = item->>'previousNumber' AND o.qb_ref IS NOT DISTINCT FROM (item->>'previousRef') AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_plan) v WHERE (v->>'id')::uuid = o.id)) THEN RAISE EXCEPTION 'Combined invoice changed. Refresh and review all loads.'; END IF;
  IF item->>'qbRef' IS NOT NULL AND EXISTS(SELECT 1 FROM public.qb_sync o WHERE o.kind = item->>'kind' AND o.qb_ref = item->>'qbRef' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_plan) v WHERE (v->>'id')::uuid = o.id)) THEN RAISE EXCEPTION 'QuickBooks invoice is linked to another load. Review both loads first.'; END IF;
 END LOOP;
 FOR item IN SELECT value FROM jsonb_array_elements(p_plan) LOOP
  n := item->>'number'; k := item->>'kind';
  IF coalesce((item->>'allocate')::boolean, false) THEN
   IF item->>'qbRef' IS NOT NULL THEN RAISE EXCEPTION 'Cannot allocate a number for an existing QB invoice.'; END IF;
   -- One new number per old group, including combined loads.
   SELECT v->>'number' INTO n FROM jsonb_array_elements(result) v WHERE v->>'group' = item->>'group' LIMIT 1;
   IF n IS NULL THEN n := CASE WHEN k = 'fleet_invoice' THEN 'FF-' || nextval('public.fleet_invoice_number_seq')::text ELSE 'INV-' || nextval('public.invoice_number_seq')::text END; END IF;
  END IF;
  UPDATE public.qb_sync SET kind = k, invoice_number = n, qb_ref = item->>'qbRef', status = item->>'status', sent_at = CASE WHEN item->>'qbRef' IS NOT NULL THEN now() ELSE NULL END, error = NULL, attach_error = NULL, attachments_sent = coalesce(item->'attachmentsSent','[]'::jsonb), qb_class = CASE WHEN k = 'fleet_invoice' THEN 'Foust Farms Truckin' ELSE 'Clearwater Brokerage' END WHERE id = (item->>'id')::uuid;
  result := result || jsonb_build_array(jsonb_build_object('id',item->>'id','number',n,'group',item->>'group'));
 END LOOP;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.apply_invoice_correction(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_invoice_correction(jsonb) TO authenticated;