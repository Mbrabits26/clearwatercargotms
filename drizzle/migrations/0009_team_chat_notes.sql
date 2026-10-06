CREATE TABLE public.chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel text NOT NULL,
  author_id uuid NOT NULL DEFAULT auth.uid(),
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.chat_messages (channel, created_at);
GRANT SELECT, INSERT ON public.chat_messages TO authenticated;
GRANT ALL ON public.chat_messages TO service_role;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "chat read" ON public.chat_messages FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()) AND (channel = 'team' OR (channel LIKE 'dm:%' AND position(auth.uid()::text in channel) > 0)));
CREATE POLICY "chat insert" ON public.chat_messages FOR INSERT TO authenticated
  WITH CHECK (author_id = auth.uid() AND public.is_staff(auth.uid()) AND (channel = 'team' OR (channel LIKE 'dm:%' AND position(auth.uid()::text in channel) > 0)));

CREATE TABLE public.chat_reads (
  user_id uuid NOT NULL DEFAULT auth.uid(),
  channel text NOT NULL,
  last_read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, channel)
);
GRANT SELECT, INSERT, UPDATE ON public.chat_reads TO authenticated;
GRANT ALL ON public.chat_reads TO service_role;
ALTER TABLE public.chat_reads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own reads" ON public.chat_reads FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE TABLE public.load_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  load_id uuid NOT NULL REFERENCES public.loads(id) ON DELETE CASCADE,
  author_id uuid NOT NULL DEFAULT auth.uid(),
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.load_notes (load_id, created_at);
GRANT SELECT, INSERT, DELETE ON public.load_notes TO authenticated;
GRANT ALL ON public.load_notes TO service_role;
ALTER TABLE public.load_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "notes read" ON public.load_notes FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()) AND EXISTS (SELECT 1 FROM public.loads l WHERE l.id = load_id));
CREATE POLICY "notes insert" ON public.load_notes FOR INSERT TO authenticated
  WITH CHECK (author_id = auth.uid() AND public.is_staff(auth.uid()) AND EXISTS (SELECT 1 FROM public.loads l WHERE l.id = load_id));
CREATE POLICY "notes delete" ON public.load_notes FOR DELETE TO authenticated
  USING (author_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.load_notes;