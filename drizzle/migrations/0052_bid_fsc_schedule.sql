ALTER TABLE public.bids ADD COLUMN IF NOT EXISTS fsc_schedule jsonb;
ALTER TABLE public.bids ADD COLUMN IF NOT EXISTS fsc_note text;
COMMENT ON COLUMN public.bids.fsc_schedule IS 'Pasted fuel surcharge table [{min,max,rpm}] (diesel $/gal range -> FSC $/mi), reused when the diesel price changes';
COMMENT ON COLUMN public.bids.fsc_note IS 'Where the current FSC came from, e.g. DOE price and date';