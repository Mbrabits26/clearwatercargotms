CREATE OR REPLACE FUNCTION public.assign_invoice_number()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF new.qb_class IS NULL THEN
    new.qb_class := CASE WHEN new.kind = 'fleet_invoice' THEN 'Foust Farms Truckin' ELSE 'Clearwater Brokerage' END;
  END IF;
  -- An assignment correction must remain unnumbered while awaiting its verified QB invoice.
  IF new.invoice_number IS NULL AND NOT (new.status = 'hold' AND new.qb_ref IS NULL) THEN
    IF new.kind = 'fleet_invoice' THEN new.invoice_number := 'FF-' || nextval('public.fleet_invoice_number_seq')::text;
    ELSIF new.kind = 'invoice' THEN new.invoice_number := 'INV-' || nextval('public.invoice_number_seq')::text;
    END IF;
  END IF;
  RETURN new;
END $$;