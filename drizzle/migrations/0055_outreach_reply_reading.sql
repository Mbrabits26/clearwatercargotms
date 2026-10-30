ALTER TABLE public.outreach_senders
  ADD COLUMN IF NOT EXISTS replies_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS reply_access text NOT NULL DEFAULT 'unknown';

CREATE TABLE public.outreach_replies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  sender_id uuid REFERENCES public.outreach_senders(id) ON DELETE SET NULL,
  gmail_message_id text NOT NULL,
  thread_id text,
  from_email text,
  subject text,
  body text,
  category text NOT NULL DEFAULT 'info',
  summary text,
  action_taken text,
  received_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sender_id, gmail_message_id)
);

GRANT SELECT, UPDATE, DELETE ON public.outreach_replies TO authenticated;
GRANT ALL ON public.outreach_replies TO service_role;
ALTER TABLE public.outreach_replies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "replies follow lead access read" ON public.outreach_replies
  FOR SELECT TO authenticated
  USING (is_staff(auth.uid()) AND EXISTS (SELECT 1 FROM public.leads l WHERE l.id = outreach_replies.lead_id));
CREATE POLICY "replies follow lead access update" ON public.outreach_replies
  FOR UPDATE TO authenticated
  USING (is_staff(auth.uid()) AND EXISTS (SELECT 1 FROM public.leads l WHERE l.id = outreach_replies.lead_id))
  WITH CHECK (is_staff(auth.uid()) AND EXISTS (SELECT 1 FROM public.leads l WHERE l.id = outreach_replies.lead_id));
CREATE POLICY "admins delete replies" ON public.outreach_replies
  FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX outreach_replies_lead_idx ON public.outreach_replies(lead_id, received_at DESC);