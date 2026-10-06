
create or replace function public.is_staff(_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _uid and role in ('admin','broker'))
$$;

drop policy "drivers read" on public.drivers;
drop policy "drivers update" on public.drivers;
drop policy "drivers write" on public.drivers;
create policy "drivers read" on public.drivers for select to authenticated using (public.is_staff(auth.uid()));
create policy "drivers update" on public.drivers for update to authenticated using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));
create policy "drivers write" on public.drivers for insert to authenticated with check (public.is_staff(auth.uid()));

drop policy "invites read" on public.carrier_invites;
drop policy "invites update" on public.carrier_invites;
drop policy "invites insert" on public.carrier_invites;
create policy "invites read" on public.carrier_invites for select to authenticated using (public.is_staff(auth.uid()));
create policy "invites update" on public.carrier_invites for update to authenticated using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));
create policy "invites insert" on public.carrier_invites for insert to authenticated with check (public.is_staff(auth.uid()));

drop policy "directory read" on public.companies;
drop policy "directory update" on public.companies;
drop policy "directory insert" on public.companies;
create policy "directory read" on public.companies for select to authenticated using (public.is_staff(auth.uid()));
create policy "directory update" on public.companies for update to authenticated using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));
create policy "directory insert" on public.companies for insert to authenticated with check (public.is_staff(auth.uid()));

drop policy "profiles readable" on public.profiles;
create policy "profiles readable" on public.profiles for select to authenticated using (id = auth.uid() or public.is_staff(auth.uid()));

drop policy "fleet read" on public.fleet_units;
drop policy "fleet update" on public.fleet_units;
drop policy "fleet write" on public.fleet_units;
create policy "fleet read" on public.fleet_units for select to authenticated using (public.is_staff(auth.uid()));
create policy "fleet update" on public.fleet_units for update to authenticated using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));
create policy "fleet write" on public.fleet_units for insert to authenticated with check (public.is_staff(auth.uid()));

drop policy "carriers read" on public.carriers;
drop policy "carriers update" on public.carriers;
drop policy "carriers insert" on public.carriers;
create policy "carriers read" on public.carriers for select to authenticated using (public.is_staff(auth.uid()));
create policy "carriers update" on public.carriers for update to authenticated using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));
create policy "carriers insert" on public.carriers for insert to authenticated with check (public.is_staff(auth.uid()));

drop policy "docs read" on public.carrier_documents;
drop policy "docs insert" on public.carrier_documents;
create policy "docs read" on public.carrier_documents for select to authenticated using (public.is_staff(auth.uid()));
create policy "docs insert" on public.carrier_documents for insert to authenticated with check (public.is_staff(auth.uid()) and exists (select 1 from public.carriers c where c.id = carrier_id));

drop policy "carrier docs read" on storage.objects;
drop policy "carrier docs upload" on storage.objects;
drop policy "load docs read" on storage.objects;
drop policy "load docs upload" on storage.objects;
create policy "carrier docs read" on storage.objects for select to authenticated using (
  bucket_id = 'carrier-docs' and public.is_staff(auth.uid())
  and exists (select 1 from public.carriers c where c.id::text = (storage.foldername(name))[1]));
create policy "carrier docs upload" on storage.objects for insert to authenticated with check (
  bucket_id = 'carrier-docs' and public.is_staff(auth.uid())
  and exists (select 1 from public.carriers c where c.id::text = (storage.foldername(name))[1]));
create policy "load docs read" on storage.objects for select to authenticated using (
  bucket_id = 'load-docs' and public.is_staff(auth.uid())
  and exists (select 1 from public.loads l where l.id::text = (storage.foldername(name))[1]));
create policy "load docs upload" on storage.objects for insert to authenticated with check (
  bucket_id = 'load-docs' and public.is_staff(auth.uid())
  and exists (select 1 from public.loads l where l.id::text = (storage.foldername(name))[1]));
