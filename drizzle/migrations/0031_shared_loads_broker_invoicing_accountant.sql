CREATE OR REPLACE FUNCTION public.is_staff(_uid uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$ select exists (select 1 from public.user_roles where user_id = _uid and role in ('admin','broker','accountant')) $$;

CREATE OR REPLACE FUNCTION public.is_finance(_uid uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$ select exists (select 1 from public.user_roles where user_id = _uid and role in ('admin','accountant')) $$;

DROP POLICY IF EXISTS "loads read" ON public.loads;
CREATE POLICY "loads read" ON public.loads FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
DROP POLICY IF EXISTS "loads update" ON public.loads;
CREATE POLICY "loads update" ON public.loads FOR UPDATE TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "qb read admin" ON public.qb_sync;
DROP POLICY IF EXISTS "qb write admin" ON public.qb_sync;
CREATE POLICY "qb read staff" ON public.qb_sync FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "qb insert staff" ON public.qb_sync FOR INSERT TO authenticated WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "qb update staff" ON public.qb_sync FOR UPDATE TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "qb delete finance" ON public.qb_sync FOR DELETE TO authenticated USING (public.is_finance(auth.uid()));