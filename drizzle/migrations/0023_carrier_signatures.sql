CREATE TABLE public.carrier_signatures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  carrier_id uuid NOT NULL REFERENCES public.carriers(id) ON DELETE CASCADE,
  external_ref text NOT NULL UNIQUE,
  source text NOT NULL DEFAULT 'packet app',
  signer_name text,
  signer_title text,
  signed_at timestamptz,
  signer_ip text,
  user_agent text,
  pay_type text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.carrier_signatures TO authenticated;
GRANT ALL ON public.carrier_signatures TO service_role;
ALTER TABLE public.carrier_signatures ENABLE ROW LEVEL SECURITY;
CREATE POLICY "carrier signatures staff read" ON public.carrier_signatures FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "carrier signatures admin write" ON public.carrier_signatures FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
COMMENT ON COLUMN public.carriers.factoring_remit_address IS 'DEPRECATED: use factoring_remit';