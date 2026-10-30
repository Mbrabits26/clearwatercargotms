ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS website text,
  ADD COLUMN IF NOT EXISTS industry text,
  ADD COLUMN IF NOT EXISTS equipment text,
  ADD COLUMN IF NOT EXISTS contact_title text,
  ADD COLUMN IF NOT EXISTS outreach_status text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS do_not_contact boolean NOT NULL DEFAULT false;

CREATE TABLE public.outreach_senders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  from_email text NOT NULL,
  display_name text NOT NULL,
  title text,
  phone text,
  signature text,
  daily_cap integer NOT NULL DEFAULT 20,
  require_approval boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true,
  last_sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.outreach_senders TO authenticated;
GRANT ALL ON public.outreach_senders TO service_role;
ALTER TABLE public.outreach_senders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read senders" ON public.outreach_senders FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "own or admin manage senders" ON public.outreach_senders FOR ALL TO authenticated
  USING (public.is_staff(auth.uid()) AND (user_id = auth.uid() OR public.has_role(auth.uid(),'admin')))
  WITH CHECK (public.is_staff(auth.uid()) AND (user_id = auth.uid() OR public.has_role(auth.uid(),'admin')));
CREATE POLICY "cap limit" ON public.outreach_senders AS RESTRICTIVE FOR ALL TO authenticated USING (true) WITH CHECK (daily_cap BETWEEN 1 AND 40);

CREATE TABLE public.outreach_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES public.outreach_senders(id) ON DELETE CASCADE,
  step integer NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  send_after date NOT NULL DEFAULT current_date,
  status text NOT NULL DEFAULT 'pending',
  approved boolean NOT NULL DEFAULT false,
  sent_at timestamptz,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.outreach_messages (status, send_after);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.outreach_messages TO authenticated;
GRANT ALL ON public.outreach_messages TO service_role;
ALTER TABLE public.outreach_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "messages follow lead access" ON public.outreach_messages FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.leads l WHERE l.id = lead_id))
  WITH CHECK (EXISTS (SELECT 1 FROM public.leads l WHERE l.id = lead_id) AND status IN ('pending','skipped'));