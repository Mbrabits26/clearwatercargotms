CREATE TABLE public.fuel_postings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  week_of date,
  kind text NOT NULL DEFAULT 'diesel' CHECK (kind IN ('diesel','fsc')),
  entries jsonb NOT NULL DEFAULT '[]'::jsonb,
  raw text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.fuel_postings IS 'Weekly fuel posts pasted on the Bid Desk: entries [{label, value}] by region or option; kind diesel = $/gal, fsc = $/mi';
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fuel_postings TO authenticated;
GRANT ALL ON public.fuel_postings TO service_role;
ALTER TABLE public.fuel_postings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read fuel postings" ON public.fuel_postings FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "staff add fuel postings" ON public.fuel_postings FOR INSERT TO authenticated WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "staff edit fuel postings" ON public.fuel_postings FOR UPDATE TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "creator or admin delete fuel postings" ON public.fuel_postings FOR DELETE TO authenticated USING (public.is_staff(auth.uid()) AND (created_by = auth.uid() OR public.has_role(auth.uid(),'admin')));
CREATE INDEX fuel_postings_created_idx ON public.fuel_postings (created_at DESC);