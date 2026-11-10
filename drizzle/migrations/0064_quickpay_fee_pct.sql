ALTER TABLE public.carriers ADD COLUMN IF NOT EXISTS quickpay_fee_pct numeric;
ALTER TABLE public.loads ADD COLUMN IF NOT EXISTS quickpay_fee_pct numeric;
COMMENT ON COLUMN public.carriers.quickpay_fee_pct IS 'Optional Quick Pay fee % for this carrier; null = standard for its pay option';
COMMENT ON COLUMN public.loads.quickpay_fee_pct IS 'Optional Quick Pay fee % for this load; null = carrier/standard';