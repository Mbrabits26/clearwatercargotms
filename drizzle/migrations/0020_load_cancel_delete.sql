ALTER TYPE public.load_status ADD VALUE IF NOT EXISTS 'cancelled';
ALTER TABLE public.loads ADD COLUMN IF NOT EXISTS cancel_reason text, ADD COLUMN IF NOT EXISTS cancelled_at timestamptz, ADD COLUMN IF NOT EXISTS cancelled_by uuid;
CREATE OR REPLACE FUNCTION public.guard_load_delete() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.status::text IN ('invoiced','paid') THEN RAISE EXCEPTION 'This load was invoiced or paid — cancel it instead of deleting.'; END IF;
  IF OLD.ratecon_signed OR EXISTS (SELECT 1 FROM ratecon_requests WHERE load_id = OLD.id AND status = 'signed') THEN RAISE EXCEPTION 'This load has a signed rate con — cancel it instead of deleting.'; END IF;
  IF EXISTS (SELECT 1 FROM qb_sync WHERE load_id = OLD.id) THEN RAISE EXCEPTION 'This load was sent to QuickBooks — cancel it instead of deleting.'; END IF;
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS guard_load_delete ON public.loads;
CREATE TRIGGER guard_load_delete BEFORE DELETE ON public.loads FOR EACH ROW EXECUTE FUNCTION public.guard_load_delete();