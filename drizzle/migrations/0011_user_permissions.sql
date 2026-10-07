CREATE TABLE public.user_permissions (
  user_id uuid PRIMARY KEY,
  perms text[] NOT NULL DEFAULT ARRAY['dispatch','directory','carriers','fleet','quotes','reports','export'],
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_permissions TO authenticated;
GRANT ALL ON public.user_permissions TO service_role;
ALTER TABLE public.user_permissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "perms own read" ON public.user_permissions FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "perms admin write" ON public.user_permissions FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));