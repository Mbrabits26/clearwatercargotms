ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS accept_token uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS responded_at timestamptz,
  ADD COLUMN IF NOT EXISTS customer_note text,
  ADD COLUMN IF NOT EXISTS accepted_by text;
CREATE UNIQUE INDEX IF NOT EXISTS quotes_accept_token_key ON public.quotes(accept_token);