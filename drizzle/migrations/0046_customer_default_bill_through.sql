ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS bill_through text CHECK (bill_through IN ('invoice','fleet_invoice'));
COMMENT ON COLUMN public.companies.bill_through IS 'Customer default billing company for its loads: invoice = Clearwater Cargo, fleet_invoice = Foust Farms. NULL = automatic by truck.';

-- Madison Wood Preservers and Adelphia Metals LLC are always billed through Foust Farms.
UPDATE public.companies SET bill_through = 'fleet_invoice'
WHERE id IN ('8f552916-40a9-4038-ae33-6f0b938d386c','5a6b682e-f118-4561-9874-96c0d651cbfd');

CREATE OR REPLACE FUNCTION public.default_load_bill_through() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.bill_through IS NULL AND NEW.customer_id IS NOT NULL THEN
    SELECT c.bill_through INTO NEW.bill_through FROM public.companies c WHERE c.id = NEW.customer_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS loads_default_bill_through ON public.loads;
CREATE TRIGGER loads_default_bill_through BEFORE INSERT OR UPDATE OF customer_id, bill_through ON public.loads
FOR EACH ROW EXECUTE FUNCTION public.default_load_bill_through();

-- Backfill: current loads for these customers left on automatic now bill through Foust Farms.
UPDATE public.loads SET bill_through = 'fleet_invoice'
WHERE customer_id IN ('8f552916-40a9-4038-ae33-6f0b938d386c','5a6b682e-f118-4561-9874-96c0d651cbfd')
  AND bill_through IS NULL;