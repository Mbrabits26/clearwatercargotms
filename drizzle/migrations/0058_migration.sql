alter table public.notification_prefs
  add column if not exists app_mentions boolean not null default true,
  add column if not exists email_mentions boolean not null default true;