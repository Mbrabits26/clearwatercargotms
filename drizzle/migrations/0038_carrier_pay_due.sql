ALTER TABLE public.loads
  ADD COLUMN IF NOT EXISTS pod_received_at timestamptz,
  ADD COLUMN IF NOT EXISTS carrier_paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS carrier_paid_by uuid,
  ADD COLUMN IF NOT EXISTS carrier_paid_ref text;

COMMENT ON COLUMN public.loads.pod_received_at IS 'When the POD was first marked received; starts the carrier pay clock.';
COMMENT ON COLUMN public.loads.carrier_paid_at IS 'When finance marked the carrier paid for this load (admin/accountant only).';

UPDATE public.loads SET pod_received_at = coalesce(delivery_at, now()) WHERE pod_received AND pod_received_at IS NULL;

CREATE OR REPLACE FUNCTION public.stamp_load_pay_fields()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.pod_received AND (TG_OP = 'INSERT' OR NOT OLD.pod_received) AND NEW.pod_received_at IS NULL THEN
    NEW.pod_received_at := now();
  ELSIF NOT NEW.pod_received THEN
    NEW.pod_received_at := NULL;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.carrier_paid_at IS NOT NULL OR NEW.carrier_paid_by IS NOT NULL OR NEW.carrier_paid_ref IS NOT NULL THEN
      IF auth.uid() IS NOT NULL AND NOT public.is_finance(auth.uid()) THEN RAISE EXCEPTION 'Only admins or accountants can mark carriers paid'; END IF;
    END IF;
  ELSIF NEW.carrier_paid_at IS DISTINCT FROM OLD.carrier_paid_at OR NEW.carrier_paid_ref IS DISTINCT FROM OLD.carrier_paid_ref OR NEW.carrier_paid_by IS DISTINCT FROM OLD.carrier_paid_by THEN
    IF auth.uid() IS NOT NULL AND NOT public.is_finance(auth.uid()) THEN RAISE EXCEPTION 'Only admins or accountants can mark carriers paid'; END IF;
    NEW.carrier_paid_by := CASE WHEN NEW.carrier_paid_at IS NULL THEN NULL ELSE coalesce(auth.uid(), NEW.carrier_paid_by) END;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS loads_pay_fields ON public.loads;
CREATE TRIGGER loads_pay_fields BEFORE INSERT OR UPDATE ON public.loads
  FOR EACH ROW EXECUTE FUNCTION public.stamp_load_pay_fields();

CREATE TABLE public.carrier_payment_accounts (
  carrier_id uuid PRIMARY KEY REFERENCES public.carriers(id) ON DELETE CASCADE,
  method text NOT NULL DEFAULT 'ach',
  bank_name text,
  account_name text,
  routing_number text,
  account_number text,
  account_type text,
  remit_email text,
  notes text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.carrier_payment_accounts TO authenticated;
GRANT ALL ON public.carrier_payment_accounts TO service_role;

ALTER TABLE public.carrier_payment_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Finance reads carrier payment accounts" ON public.carrier_payment_accounts
  FOR SELECT TO authenticated USING (public.is_finance(auth.uid()));
CREATE POLICY "Finance adds carrier payment accounts" ON public.carrier_payment_accounts
  FOR INSERT TO authenticated WITH CHECK (public.is_finance(auth.uid()));
CREATE POLICY "Finance edits carrier payment accounts" ON public.carrier_payment_accounts
  FOR UPDATE TO authenticated USING (public.is_finance(auth.uid())) WITH CHECK (public.is_finance(auth.uid()));
CREATE POLICY "Finance removes carrier payment accounts" ON public.carrier_payment_accounts
  FOR DELETE TO authenticated USING (public.is_finance(auth.uid()));

CREATE OR REPLACE FUNCTION public.stamp_payment_account()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at := now(); NEW.updated_by := auth.uid(); RETURN NEW; END $$;

CREATE TRIGGER carrier_payment_accounts_stamp BEFORE INSERT OR UPDATE ON public.carrier_payment_accounts
  FOR EACH ROW EXECUTE FUNCTION public.stamp_payment_account();