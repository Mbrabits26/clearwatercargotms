ALTER TABLE public.bid_lanes
  ADD COLUMN IF NOT EXISTS offer_rpm numeric,
  ADD COLUMN IF NOT EXISTS offer_flat numeric,
  ADD COLUMN IF NOT EXISTS mileage_band text,
  ADD COLUMN IF NOT EXISTS counters jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS agreed_rpm numeric,
  ADD COLUMN IF NOT EXISTS source_table text,
  ADD COLUMN IF NOT EXISTS source_row integer;

ALTER TABLE public.bids
  ADD COLUMN IF NOT EXISTS offer_below_pct numeric,
  ADD COLUMN IF NOT EXISTS source_path text,
  ADD COLUMN IF NOT EXISTS source_tables jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS sheet_notes text;

CREATE POLICY "bid files read" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'bid-files' AND public.is_staff(auth.uid())
  AND EXISTS (SELECT 1 FROM public.bids b WHERE b.id::text = (storage.foldername(objects.name))[1]));

CREATE POLICY "bid files upload" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'bid-files' AND public.is_staff(auth.uid())
  AND EXISTS (SELECT 1 FROM public.bids b WHERE b.id::text = (storage.foldername(objects.name))[1]));