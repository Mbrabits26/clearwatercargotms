CREATE TABLE public.chat_mentions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  author_id uuid NOT NULL DEFAULT auth.uid(),
  source text NOT NULL,
  channel text,
  load_id uuid REFERENCES public.loads(id) ON DELETE CASCADE,
  body text NOT NULL,
  read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.chat_mentions TO authenticated;
GRANT ALL ON public.chat_mentions TO service_role;
ALTER TABLE public.chat_mentions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own mentions read" ON public.chat_mentions FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "own mentions update" ON public.chat_mentions FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "staff mention insert" ON public.chat_mentions FOR INSERT TO authenticated WITH CHECK (author_id = auth.uid() AND public.is_staff(auth.uid()));
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_mentions;

CREATE TABLE public.load_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  load_id uuid NOT NULL REFERENCES public.loads(id) ON DELETE CASCADE,
  carrier_id uuid NOT NULL REFERENCES public.carriers(id) ON DELETE CASCADE,
  email text,
  offered_rate numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'sent',
  counter_rate numeric,
  note text,
  responded_at timestamptz,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (load_id, carrier_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.load_offers TO authenticated;
GRANT ALL ON public.load_offers TO service_role;
ALTER TABLE public.load_offers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "offers staff" ON public.load_offers FOR ALL TO authenticated
  USING (public.is_staff(auth.uid()) AND EXISTS (SELECT 1 FROM public.loads l WHERE l.id = load_id))
  WITH CHECK (public.is_staff(auth.uid()) AND EXISTS (SELECT 1 FROM public.loads l WHERE l.id = load_id));
ALTER PUBLICATION supabase_realtime ADD TABLE public.load_offers;

CREATE VIEW public.carrier_lane_history WITH (security_invoker = true) AS
SELECT carrier_id, origin_city, origin_state, dest_city, dest_state, equipment,
  count(*)::int AS runs, avg(carrier_rate)::numeric(10,2) AS avg_rate,
  avg(CASE WHEN miles > 0 THEN carrier_rate / miles END)::numeric(10,2) AS avg_rpm,
  max(coalesce(pickup_at, created_at)) AS last_run
FROM public.loads
WHERE carrier_id IS NOT NULL AND status IN ('delivered','invoiced','paid','rolling','dispatched')
GROUP BY 1,2,3,4,5,6;
GRANT SELECT ON public.carrier_lane_history TO authenticated;

CREATE TABLE public.quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_number text NOT NULL DEFAULT ('Q-' || to_char(now(),'YYMMDD') || '-' || substr(gen_random_uuid()::text,1,4)),
  broker_id uuid DEFAULT auth.uid(),
  customer_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  customer_name text,
  customer_email text,
  kind text NOT NULL DEFAULT 'spot',
  origin_city text NOT NULL, origin_state text NOT NULL,
  dest_city text NOT NULL, dest_state text NOT NULL,
  equipment text NOT NULL DEFAULT 'Dry Van',
  miles integer,
  pickup_date date,
  rate numeric NOT NULL DEFAULT 0,
  target_carrier_rate numeric,
  accessorials jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes text,
  status text NOT NULL DEFAULT 'draft',
  lost_reason text,
  load_id uuid REFERENCES public.loads(id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.quotes TO authenticated;
GRANT ALL ON public.quotes TO service_role;
ALTER TABLE public.quotes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "quotes own or admin" ON public.quotes FOR ALL TO authenticated
  USING (public.is_staff(auth.uid()) AND (broker_id = auth.uid() OR public.has_role(auth.uid(),'admin')))
  WITH CHECK (public.is_staff(auth.uid()) AND (broker_id = auth.uid() OR public.has_role(auth.uid(),'admin')));

CREATE TABLE public.market_rate_cache (
  key text PRIMARY KEY,
  result jsonb NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.market_rate_cache TO authenticated;
GRANT ALL ON public.market_rate_cache TO service_role;
ALTER TABLE public.market_rate_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cache staff read" ON public.market_rate_cache FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));