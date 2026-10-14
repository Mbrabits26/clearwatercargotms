ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS sales_broker_id uuid;
COMMENT ON COLUMN public.companies.sales_broker_id IS 'Broker who brought in this customer (commission reports)';

-- Company-wide lane history for staff (rate view, lanes run). No broker attribution, so no one broker's pay is exposed.
CREATE OR REPLACE FUNCTION public.lane_history_loads(_carrier uuid DEFAULT NULL)
RETURNS TABLE (id uuid, load_number text, status public.load_status, carrier_id uuid, customer_id uuid, shipper_id uuid, consignee_id uuid,
  origin_city text, origin_state text, dest_city text, dest_state text, pickup_at timestamptz, delivery_at timestamptz, created_at timestamptz,
  equipment text, commodity text, weight_lbs integer, miles integer, customer_rate numeric, carrier_rate numeric, accessorials jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT l.id, l.load_number, l.status, l.carrier_id, l.customer_id, l.shipper_id, l.consignee_id,
    l.origin_city, l.origin_state, l.dest_city, l.dest_state, l.pickup_at, l.delivery_at, l.created_at,
    l.equipment, l.commodity, l.weight_lbs, l.miles, l.customer_rate, l.carrier_rate, l.accessorials
  FROM public.loads l
  WHERE public.is_staff(auth.uid())
    AND l.status <> 'cancelled'
    AND (_carrier IS NULL OR l.carrier_id = _carrier)
$$;
REVOKE ALL ON FUNCTION public.lane_history_loads(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.lane_history_loads(uuid) TO authenticated;