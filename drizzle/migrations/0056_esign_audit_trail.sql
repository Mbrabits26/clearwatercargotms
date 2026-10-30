ALTER TABLE public.ratecon_requests
  ADD COLUMN IF NOT EXISTS signer_ip text,
  ADD COLUMN IF NOT EXISTS user_agent text,
  ADD COLUMN IF NOT EXISTS consent_text text,
  ADD COLUMN IF NOT EXISTS terms_sha256 text,
  ADD COLUMN IF NOT EXISTS doc_sha256 text;
ALTER TABLE public.carrier_signatures
  ADD COLUMN IF NOT EXISTS consent_text text,
  ADD COLUMN IF NOT EXISTS terms_sha256 text,
  ADD COLUMN IF NOT EXISTS doc_sha256 text,
  ADD COLUMN IF NOT EXISTS file_path text;
CREATE INDEX IF NOT EXISTS ratecon_requests_doc_sha256_idx ON public.ratecon_requests (doc_sha256) WHERE doc_sha256 IS NOT NULL;
CREATE INDEX IF NOT EXISTS carrier_signatures_doc_sha256_idx ON public.carrier_signatures (doc_sha256) WHERE doc_sha256 IS NOT NULL;