
create or replace function public.grant_named_admins()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.email_confirmed_at is not null
     and lower(new.email) in ('accounting@clearwatercargo.com','eric@clearwatercargo.com') then
    insert into public.user_roles(user_id, role) values (new.id, 'admin') on conflict (user_id, role) do nothing;
  end if;
  return new;
end $$;

create trigger on_auth_user_created_named_admin
after insert on auth.users for each row execute function public.grant_named_admins();

create trigger on_auth_user_confirmed_named_admin
after update of email_confirmed_at on auth.users for each row
when (old.email_confirmed_at is null and new.email_confirmed_at is not null)
execute function public.grant_named_admins();

insert into public.user_roles(user_id, role)
select id, 'admin' from auth.users
where email_confirmed_at is not null and lower(email) in ('accounting@clearwatercargo.com','eric@clearwatercargo.com')
on conflict (user_id, role) do nothing;
