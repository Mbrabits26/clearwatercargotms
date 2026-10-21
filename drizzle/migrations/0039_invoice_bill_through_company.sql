-- Combined invoices share one invoice number across several rows, so the number cannot be unique per row.
ALTER TABLE public.qb_sync DROP CONSTRAINT IF EXISTS qb_sync_invoice_number_key;
CREATE INDEX IF NOT EXISTS qb_sync_invoice_number_idx ON public.qb_sync (invoice_number);

-- Move a not-yet-sent customer invoice (and every load on a combined invoice) to the other company's QuickBooks.
CREATE OR REPLACE FUNCTION public.set_invoice_company(p_id uuid, p_kind text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  r public.qb_sync%ROWTYPE;
  ids uuid[];
  new_num text;
BEGIN
  IF NOT public.is_finance(auth.uid()) THEN RAISE EXCEPTION 'Only admins or accountants can change the billing company.'; END IF;
  IF p_kind NOT IN ('invoice', 'fleet_invoice') THEN RAISE EXCEPTION 'Unknown billing company.'; END IF;
  SELECT * INTO r FROM public.qb_sync WHERE id = p_id;
  IF NOT FOUND OR r.kind NOT IN ('invoice', 'fleet_invoice') THEN RAISE EXCEPTION 'Invoice not found.'; END IF;
  IF r.kind = p_kind THEN RETURN r.invoice_number; END IF;
  SELECT array_agg(id) INTO ids FROM public.qb_sync
   WHERE kind = r.kind AND (id = p_id OR (r.invoice_number IS NOT NULL AND invoice_number = r.invoice_number));
  IF EXISTS (SELECT 1 FROM public.qb_sync WHERE id = ANY(ids) AND (status = 'sent' OR qb_ref IS NOT NULL)) THEN
    RAISE EXCEPTION 'This invoice is already in QuickBooks, so it cannot move to the other company.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.qb_sync o JOIN public.qb_sync s ON s.load_id = o.load_id WHERE s.id = ANY(ids) AND o.kind = p_kind) THEN
    RAISE EXCEPTION 'One of these loads already has an invoice with that company.';
  END IF;
  new_num := CASE WHEN p_kind = 'fleet_invoice' THEN 'FF-' || nextval('public.fleet_invoice_number_seq')::text
                  ELSE 'INV-' || nextval('public.invoice_number_seq')::text END;
  UPDATE public.qb_sync SET kind = p_kind, invoice_number = new_num, status = 'queued', error = NULL,
         qb_class = CASE WHEN p_kind = 'fleet_invoice' THEN 'Foust Farms Truckin' ELSE 'Clearwater Brokerage' END
   WHERE id = ANY(ids);
  RETURN new_num;
END $$;

REVOKE ALL ON FUNCTION public.set_invoice_company(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_invoice_company(uuid, text) TO authenticated;