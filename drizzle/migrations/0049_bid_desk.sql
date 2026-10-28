CREATE SEQUENCE IF NOT EXISTS public.bid_number_seq START 1001;

CREATE TABLE public.bids (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bid_number text NOT NULL DEFAULT ('BID-' || nextval('public.bid_number_seq')::text),
  name text NOT NULL,
  kind text NOT NULL DEFAULT 'spot' CHECK (kind IN ('spot','contract')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','won','lost','partial')),
  customer_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  customer_name text,
  customer_email text,
  due_date date,
  fsc_per_mile numeric NOT NULL DEFAULT 0,
  target_margin numeric NOT NULL DEFAULT 15,
  source_file text,
  source_headers jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes text,
  submitted_at timestamptz,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bids TO authenticated;
GRANT ALL ON public.bids TO service_role;
GRANT USAGE ON SEQUENCE public.bid_number_seq TO authenticated, service_role;
ALTER TABLE public.bids ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read bids" ON public.bids FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "staff add bids" ON public.bids FOR INSERT TO authenticated WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "staff edit bids" ON public.bids FOR UPDATE TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "creator or admin delete bids" ON public.bids FOR DELETE TO authenticated USING (public.is_staff(auth.uid()) AND (created_by = auth.uid() OR public.has_role(auth.uid(),'admin')));

CREATE TABLE public.bid_lanes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bid_id uuid NOT NULL REFERENCES public.bids(id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0,
  origin_city text NOT NULL DEFAULT '',
  origin_state text NOT NULL DEFAULT '',
  origin_zip text,
  dest_city text NOT NULL DEFAULT '',
  dest_state text NOT NULL DEFAULT '',
  dest_zip text,
  equipment text NOT NULL DEFAULT 'Dry Van',
  miles numeric,
  volume text,
  loads_per_week numeric,
  pickup_date date,
  carrier_cost numeric,
  linehaul numeric,
  fsc_per_mile numeric,
  accessorials jsonb NOT NULL DEFAULT '[]'::jsonb,
  market_spot_rpm numeric,
  market_contract_rpm numeric,
  market_note text,
  history_rpm numeric,
  history_cost_rpm numeric,
  history_n integer,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','won','lost')),
  lost_reason text,
  quote_id uuid REFERENCES public.quotes(id) ON DELETE SET NULL,
  load_id uuid REFERENCES public.loads(id) ON DELETE SET NULL,
  notes text,
  original jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bid_lanes_bid_idx ON public.bid_lanes(bid_id, position);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bid_lanes TO authenticated;
GRANT ALL ON public.bid_lanes TO service_role;
ALTER TABLE public.bid_lanes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read bid lanes" ON public.bid_lanes FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "staff add bid lanes" ON public.bid_lanes FOR INSERT TO authenticated WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "staff edit bid lanes" ON public.bid_lanes FOR UPDATE TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "staff delete bid lanes" ON public.bid_lanes FOR DELETE TO authenticated USING (public.is_staff(auth.uid()));

CREATE TRIGGER log_delete_bids AFTER DELETE ON public.bids FOR EACH ROW EXECUTE FUNCTION public.log_deletion();