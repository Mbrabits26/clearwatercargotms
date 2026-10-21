ALTER TABLE public.qb_sync ADD COLUMN IF NOT EXISTS attachments jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.qb_sync ADD COLUMN IF NOT EXISTS attachments_sent jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.qb_sync ADD COLUMN IF NOT EXISTS attach_on_send boolean NOT NULL DEFAULT true;
ALTER TABLE public.qb_sync ADD COLUMN IF NOT EXISTS attach_error text;
COMMENT ON COLUMN public.qb_sync.attachments IS 'Load-docs storage paths [{path,name}] to attach to the QuickBooks invoice/bill.';
COMMENT ON COLUMN public.qb_sync.attachments_sent IS 'Paths already uploaded to QuickBooks (never uploaded twice).';
COMMENT ON COLUMN public.qb_sync.attach_on_send IS 'QuickBooks IncludeOnSend: include attachments when QuickBooks emails the invoice.';