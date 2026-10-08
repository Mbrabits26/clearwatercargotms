ALTER TABLE public.carriers DROP CONSTRAINT carriers_pay_terms_check;
ALTER TABLE public.carriers ADD CONSTRAINT carriers_pay_terms_check CHECK (pay_terms = ANY (ARRAY['net30','quickpay','factoring','factored_quickpay']));
ALTER TABLE public.loads DROP CONSTRAINT loads_pay_terms_check;
ALTER TABLE public.loads ADD CONSTRAINT loads_pay_terms_check CHECK (pay_terms = ANY (ARRAY['net30','quickpay','factoring','factored_quickpay']));
ALTER TABLE public.carriers ADD COLUMN IF NOT EXISTS factoring_remit_address text;

ALTER TABLE public.qb_sync DROP CONSTRAINT qb_sync_kind_check;
ALTER TABLE public.qb_sync ADD CONSTRAINT qb_sync_kind_check CHECK (kind = ANY (ARRAY['invoice','bill','fleet_invoice']));
CREATE SEQUENCE IF NOT EXISTS public.invoice_number_seq START 10001;
GRANT USAGE, SELECT ON SEQUENCE public.invoice_number_seq TO authenticated, service_role;
ALTER TABLE public.qb_sync
  ADD COLUMN IF NOT EXISTS invoice_number text UNIQUE,
  ADD COLUMN IF NOT EXISTS gross_amount numeric,
  ADD COLUMN IF NOT EXISTS quickpay_fee numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS carrier_invoice_amount numeric,
  ADD COLUMN IF NOT EXISTS carrier_invoice_path text;

CREATE OR REPLACE FUNCTION public.assign_invoice_number()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF new.kind IN ('invoice','fleet_invoice') AND new.invoice_number IS NULL THEN
    new.invoice_number := 'INV-' || nextval('public.invoice_number_seq')::text;
  END IF;
  RETURN new;
END $$;
CREATE TRIGGER qb_sync_invoice_number BEFORE INSERT ON public.qb_sync FOR EACH ROW EXECUTE FUNCTION public.assign_invoice_number();
UPDATE public.qb_sync SET invoice_number = 'INV-' || nextval('public.invoice_number_seq')::text WHERE kind = 'invoice' AND invoice_number IS NULL;