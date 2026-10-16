ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS pay_terms text NOT NULL DEFAULT 'Net 30';
ALTER TABLE public.qb_sync ADD COLUMN IF NOT EXISTS terms text;
ALTER TABLE public.qb_sync ADD COLUMN IF NOT EXISTS due_date date;