ALTER TABLE public.loads ADD COLUMN closed_at timestamptz, ADD COLUMN closed_by uuid, ADD COLUMN closeout_note text;
COMMENT ON COLUMN public.loads.closed_at IS 'Operational archive only; does not establish payment or change accounting records.';
CREATE OR REPLACE FUNCTION public.guard_load_closeout() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.closed_at IS NOT NULL THEN RAISE EXCEPTION 'Create the load before closing it out'; END IF;
  ELSIF NEW.closed_at IS DISTINCT FROM OLD.closed_at OR NEW.closeout_note IS DISTINCT FROM OLD.closeout_note OR NEW.closed_by IS DISTINCT FROM OLD.closed_by THEN
    IF auth.uid() IS NULL OR NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'Staff access required'; END IF;
    IF NEW.closed_at IS NOT NULL THEN
      IF NEW.status NOT IN ('delivered','invoiced','paid') THEN RAISE EXCEPTION 'Mark the load delivered before closing it out'; END IF;
      IF length(trim(coalesce(NEW.closeout_note,''))) = 0 THEN RAISE EXCEPTION 'A closeout note is required'; END IF;
      NEW.closed_by := auth.uid(); NEW.closed_at := now();
    END IF;
  END IF;
  IF NEW.closed_at IS NOT NULL AND NEW.status NOT IN ('delivered','invoiced','paid') THEN RAISE EXCEPTION 'Reopen the load before changing its status'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER loads_closeout_guard BEFORE INSERT OR UPDATE ON public.loads FOR EACH ROW EXECUTE FUNCTION public.guard_load_closeout();
CREATE OR REPLACE FUNCTION public.batch_load_action(_ids uuid[], _action text, _note text DEFAULT '') RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE _id uuid; _load public.loads%ROWTYPE; _results jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'Staff access required'; END IF;
  IF _action NOT IN ('delivered','closeout') THEN RAISE EXCEPTION 'Unknown batch action'; END IF;
  IF coalesce(array_length(_ids,1),0) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Select between 1 and 100 loads'; END IF;
  IF _action = 'closeout' AND length(trim(coalesce(_note,''))) = 0 THEN RAISE EXCEPTION 'A closeout note is required'; END IF;
  FOR _id IN SELECT DISTINCT unnest(_ids) LOOP
    BEGIN
      SELECT * INTO _load FROM public.loads WHERE id = _id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Load not found or not permitted'; END IF;
      IF _load.closed_at IS NOT NULL THEN RAISE EXCEPTION 'Load is already closed out'; END IF;
      IF _action = 'delivered' THEN
        IF _load.status NOT IN ('available','vetting','booked','dispatched','rolling','issue') THEN RAISE EXCEPTION 'Load is already delivered, invoiced, paid, or cancelled'; END IF;
        UPDATE public.loads SET status = 'delivered' WHERE id = _id;
      ELSE
        UPDATE public.loads SET closed_at = now(), closed_by = auth.uid(), closeout_note = trim(_note) WHERE id = _id;
        INSERT INTO public.load_notes(load_id,author_id,body) VALUES (_id,auth.uid(),'Operational closeout (payment unchanged): ' || trim(_note));
      END IF;
      _results := _results || jsonb_build_array(jsonb_build_object('id',_id,'ok',true));
    EXCEPTION WHEN OTHERS THEN
      _results := _results || jsonb_build_array(jsonb_build_object('id',_id,'ok',false,'error',SQLERRM));
    END;
  END LOOP;
  RETURN _results;
END $$;
REVOKE ALL ON FUNCTION public.batch_load_action(uuid[],text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.batch_load_action(uuid[],text,text) TO authenticated;
