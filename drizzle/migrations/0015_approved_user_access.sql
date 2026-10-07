CREATE TABLE public.approved_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  full_name text,
  role public.app_role NOT NULL DEFAULT 'broker',
  perms text[] NOT NULL DEFAULT ARRAY['dispatch','directory','carriers','fleet','leads','quotes','reports']::text[],
  user_id uuid UNIQUE,
  approved_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT approved_users_email_unique UNIQUE (email)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.approved_users TO authenticated;
GRANT ALL ON public.approved_users TO service_role;
ALTER TABLE public.approved_users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read approved users" ON public.approved_users FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admins add approved users" ON public.approved_users FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admins update approved users" ON public.approved_users FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admins delete approved users" ON public.approved_users FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

INSERT INTO public.approved_users(email, full_name, role, perms, user_id)
SELECT lower(p.email), p.full_name,
  CASE WHEN public.has_role(p.id, 'admin') THEN 'admin'::public.app_role ELSE 'broker'::public.app_role END,
  COALESCE(up.perms, ARRAY['dispatch','directory','carriers','fleet','leads','quotes','reports']::text[]),
  p.id
FROM public.profiles p
LEFT JOIN public.user_permissions up ON up.user_id = p.id
WHERE p.email IS NOT NULL
ON CONFLICT (email) DO UPDATE SET user_id = EXCLUDED.user_id;

CREATE OR REPLACE FUNCTION public.is_approved(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.approved_users
    WHERE user_id = _uid
      AND lower(email) = lower(COALESCE((SELECT email FROM auth.users WHERE id = _uid), ''))
  )
$$;
GRANT EXECUTE ON FUNCTION public.is_approved(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE approval public.approved_users%ROWTYPE;
BEGIN
  INSERT INTO public.profiles(id, full_name, email)
  VALUES (new.id, COALESCE(new.raw_user_meta_data->>'full_name', new.email), new.email)
  ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, full_name = COALESCE(public.profiles.full_name, EXCLUDED.full_name);

  SELECT * INTO approval FROM public.approved_users WHERE lower(email) = lower(new.email) LIMIT 1;
  IF approval.id IS NOT NULL THEN
    UPDATE public.approved_users SET user_id = new.id WHERE id = approval.id;
    DELETE FROM public.user_roles WHERE user_id = new.id;
    INSERT INTO public.user_roles(user_id, role) VALUES (new.id, approval.role);
    INSERT INTO public.user_permissions(user_id, perms) VALUES (new.id, approval.perms)
      ON CONFLICT (user_id) DO UPDATE SET perms = EXCLUDED.perms, updated_at = now();
  END IF;
  RETURN new;
END $$;

CREATE OR REPLACE FUNCTION public.sync_approved_user_access()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE target_id uuid;
BEGIN
  target_id := COALESCE(new.user_id, (SELECT id FROM auth.users WHERE lower(email) = lower(new.email) LIMIT 1));
  IF target_id IS NOT NULL THEN
    UPDATE public.approved_users SET user_id = target_id WHERE id = new.id;
    DELETE FROM public.user_roles WHERE user_id = target_id;
    INSERT INTO public.user_roles(user_id, role) VALUES (target_id, new.role);
    INSERT INTO public.user_permissions(user_id, perms) VALUES (target_id, new.perms)
      ON CONFLICT (user_id) DO UPDATE SET perms = EXCLUDED.perms, updated_at = now();
  END IF;
  RETURN new;
END $$;
CREATE TRIGGER approved_user_access_sync AFTER INSERT OR UPDATE OF email, role, perms ON public.approved_users
FOR EACH ROW EXECUTE FUNCTION public.sync_approved_user_access();