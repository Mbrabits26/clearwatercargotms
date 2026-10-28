CREATE POLICY "bid files delete" ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'bid-files' AND public.is_staff(auth.uid())
  AND EXISTS (SELECT 1 FROM public.bids b WHERE b.id::text = (storage.foldername(objects.name))[1]
    AND (b.created_by = auth.uid() OR public.has_role(auth.uid(), 'admin'::public.app_role))));