ALTER TABLE public.qb_sync DROP CONSTRAINT qb_sync_status_check;
ALTER TABLE public.qb_sync ADD CONSTRAINT qb_sync_status_check CHECK (status = ANY (ARRAY['queued'::text, 'sent'::text, 'error'::text, 'hold'::text]));
ALTER TABLE public.qb_sync ADD COLUMN IF NOT EXISTS carrier_invoice_number text;
ALTER TABLE public.qb_sync ADD COLUMN IF NOT EXISTS carrier_invoice_lines jsonb NOT NULL DEFAULT '[]'::jsonb;
COMMENT ON COLUMN public.qb_sync.carrier_invoice_lines IS 'Charges read from the carrier''s own invoice: [{description, amount}] for rate con audit.';