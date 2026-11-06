CREATE TABLE public.fleet_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_kind text NOT NULL,
  owner_id uuid NOT NULL,
  doc_type text NOT NULL,
  file_path text,
  file_name text,
  expires_on date,
  service_date date,
  amount numeric,
  odometer integer,
  notes text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX fleet_records_owner_idx ON public.fleet_records(owner_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fleet_records TO authenticated;
GRANT ALL ON public.fleet_records TO service_role;
ALTER TABLE public.fleet_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fleet records staff read" ON public.fleet_records FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "fleet records staff insert" ON public.fleet_records FOR INSERT TO authenticated WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "fleet records staff update" ON public.fleet_records FOR UPDATE TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "fleet records staff delete" ON public.fleet_records FOR DELETE TO authenticated USING (public.is_staff(auth.uid()));
CREATE TRIGGER fleet_records_log_deletion AFTER DELETE ON public.fleet_records FOR EACH ROW EXECUTE FUNCTION public.log_deletion();