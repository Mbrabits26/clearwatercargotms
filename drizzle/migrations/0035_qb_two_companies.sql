ALTER TABLE public.qb_connection DROP CONSTRAINT qb_connection_id_check;
ALTER TABLE public.qb_connection ADD CONSTRAINT qb_connection_id_check CHECK (id IN (1, 2));
COMMENT ON COLUMN public.qb_connection.id IS '1 = Clearwater Cargo (brokerage AR/AP), 2 = Foust Farms (fleet invoices)';