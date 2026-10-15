ALTER TABLE public.ratecon_requests
  ADD COLUMN IF NOT EXISTS void_reason text,
  ADD COLUMN IF NOT EXISTS void_note text,
  ADD COLUMN IF NOT EXISTS voided_by uuid,
  ADD COLUMN IF NOT EXISTS voided_at timestamptz;