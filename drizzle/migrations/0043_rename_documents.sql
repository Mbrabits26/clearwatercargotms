create table public.load_doc_names (
  path text primary key,
  display_name text not null check (length(btrim(display_name)) between 1 and 200),
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now()
);
grant select, insert, update, delete on public.load_doc_names to authenticated;
grant all on public.load_doc_names to service_role;
alter table public.load_doc_names enable row level security;
create policy "staff read load doc names" on public.load_doc_names for select to authenticated using (public.is_staff(auth.uid()));
create policy "staff name load docs" on public.load_doc_names for insert to authenticated
  with check (public.is_staff(auth.uid()) and exists (select 1 from public.loads l where l.id::text = split_part(path, '/', 1)));
create policy "staff rename load docs" on public.load_doc_names for update to authenticated
  using (public.is_staff(auth.uid()))
  with check (public.is_staff(auth.uid()) and exists (select 1 from public.loads l where l.id::text = split_part(path, '/', 1)));
create policy "staff clear load doc names" on public.load_doc_names for delete to authenticated using (public.is_staff(auth.uid()));

-- Staff may rename carrier documents (file name only).
revoke update on public.carrier_documents from authenticated;
grant update (file_name) on public.carrier_documents to authenticated;
create policy "staff rename carrier docs" on public.carrier_documents for update to authenticated
  using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));