CREATE OR REPLACE FUNCTION public.revoke_removed_approval()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF old.user_id IS NOT NULL THEN
    DELETE FROM public.user_roles WHERE user_id = old.user_id;
    DELETE FROM public.user_permissions WHERE user_id = old.user_id;
  END IF;
  RETURN old;
END $$;
CREATE TRIGGER approved_user_access_revoke AFTER DELETE ON public.approved_users
FOR EACH ROW EXECUTE FUNCTION public.revoke_removed_approval();