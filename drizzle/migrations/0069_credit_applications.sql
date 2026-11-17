CREATE TABLE public.credit_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  company_name text,
  email text,
  quote_id uuid REFERENCES public.quotes(id) ON DELETE SET NULL,
  bid_id uuid REFERENCES public.bids(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'sent',
  answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  requested_limit numeric,
  approved_limit numeric,
  approved_terms text,
  review_note text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  signer_name text,
  signer_title text,
  signer_ip text,
  user_agent text,
  submitted_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '60 days'
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.credit_applications TO authenticated;
GRANT ALL ON public.credit_applications TO service_role;
ALTER TABLE public.credit_applications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read credit apps" ON public.credit_applications FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "staff create credit apps" ON public.credit_applications FOR INSERT TO authenticated WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "finance review credit apps" ON public.credit_applications FOR UPDATE TO authenticated USING (public.is_finance(auth.uid()) OR public.has_role(auth.uid(),'admin')) WITH CHECK (public.is_finance(auth.uid()) OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "admin delete credit apps" ON public.credit_applications FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));