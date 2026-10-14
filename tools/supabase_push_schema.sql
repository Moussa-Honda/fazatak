-- =========================================================
-- أقساطي — اشتراكات Web Push لـ Android PWA وSafari PWA
-- نفّذ هذا الملف مرة واحدة في Supabase SQL Editor.
-- =========================================================

create table if not exists fazatak_push_subscriptions (
  id uuid default gen_random_uuid() primary key,
  owner_user_id uuid references auth.users(id) on delete cascade,
  user_phone text references fazatak_users(phone) on delete cascade,
  endpoint text unique not null,
  subscription jsonb not null,
  expiration_time bigint,
  timezone text default 'Asia/Riyadh',
  last_notification_key text,
  created_at timestamp with time zone default timezone('utc'::text, now()),
  updated_at timestamp with time zone default timezone('utc'::text, now())
);

create index if not exists idx_fazatak_push_subscriptions_phone
  on fazatak_push_subscriptions(user_phone);

alter table fazatak_push_subscriptions enable row level security;
alter table fazatak_push_subscriptions force row level security;
alter table fazatak_push_subscriptions add column if not exists owner_user_id uuid references auth.users(id) on delete cascade;
alter table fazatak_push_subscriptions alter column user_phone drop not null;

create index if not exists idx_fazatak_push_subscriptions_owner
  on fazatak_push_subscriptions(owner_user_id);

-- Push subscription writes are performed only by the authenticated Worker.
-- Never grant direct access to anon/authenticated client roles.
revoke all privileges on table fazatak_push_subscriptions from public, anon, authenticated;
grant select, insert, update, delete on table fazatak_push_subscriptions to service_role;

do $$
declare
  policy_name text;
begin
  for policy_name in
    select p.policyname
    from pg_policies p
    where p.schemaname = 'public' and p.tablename = 'fazatak_push_subscriptions'
  loop
    execute format('drop policy %I on public.fazatak_push_subscriptions', policy_name);
  end loop;
end
$$;
