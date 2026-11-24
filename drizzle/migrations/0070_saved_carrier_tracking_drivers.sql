CREATE TABLE public.carrier_tracking_drivers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  carrier_id uuid NOT NULL REFERENCES public.carriers(id) ON DELETE CASCADE,
  driver_name text NOT NULL DEFAULT '',
  driver_phone text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (carrier_id, driver_phone),
  CONSTRAINT carrier_tracking_phone_format CHECK (driver_phone ~ '^\+[1-9][0-9]{7,14}$')
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.carrier_tracking_drivers TO authenticated;
GRANT ALL ON public.carrier_tracking_drivers TO service_role;
ALTER TABLE public.carrier_tracking_drivers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff manage saved carrier drivers" ON public.carrier_tracking_drivers FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));