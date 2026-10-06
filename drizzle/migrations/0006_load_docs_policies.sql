
create policy "load docs read" on storage.objects for select to authenticated
  using (bucket_id = 'load-docs' and exists (select 1 from public.loads l where l.id::text = (storage.foldername(name))[1]));
create policy "load docs upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'load-docs' and exists (select 1 from public.loads l where l.id::text = (storage.foldername(name))[1]));
