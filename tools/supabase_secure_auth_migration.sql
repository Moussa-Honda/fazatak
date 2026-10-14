-- Account-scoped access for Supabase Phone Auth.
-- Prerequisite: enable Phone provider and configure an SMS provider in Supabase.
-- Back up the database before running this migration. Existing cloud rows are
-- assigned only after the matching phone is verified by SMS.

begin;

alter table public.fazatak_users
  add column if not exists auth_user_id uuid unique references auth.users(id) on delete set null;
alter table public.fazatak_users alter column password_hash drop not null;
alter table public.fazatak_users alter column pin_hash drop not null;

alter table public.fazatak_user_data
  add column if not exists owner_user_id uuid references auth.users(id) on delete cascade;
alter table public.fazatak_backups
  add column if not exists owner_user_id uuid references auth.users(id) on delete cascade;
alter table public.fazatak_push_subscriptions
  add column if not exists owner_user_id uuid references auth.users(id) on delete cascade;
alter table public.fazatak_push_subscriptions alter column user_phone drop not null;

create index if not exists idx_fazatak_user_data_owner on public.fazatak_user_data(owner_user_id);
create index if not exists idx_fazatak_backups_owner on public.fazatak_backups(owner_user_id);
create index if not exists idx_fazatak_push_owner on public.fazatak_push_subscriptions(owner_user_id);

create or replace function public.fazatak_normalize_phone(p_phone text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  digits text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
begin
  if digits = '' then return ''; end if;
  if left(digits, 2) = '00' then return '+' || substring(digits from 3); end if;
  if left(digits, 3) = '966' then return '+' || digits; end if;
  if left(digits, 1) = '0' and length(digits) = 10 then return '+966' || substring(digits from 2); end if;
  if left(digits, 1) = '5' and length(digits) = 9 then return '+966' || digits; end if;
  if left(coalesce(p_phone, ''), 1) = '+' then return '+' || digits; end if;
  return '+' || digits;
end
$$;

create or replace function public.fazatak_finish_phone_signin(p_display_name text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_auth_phone text;
  v_phone text;
  v_confirmed boolean;
  v_new_account boolean := false;
  v_name text := left(btrim(coalesce(p_display_name, '')), 120);
  v_user public.fazatak_users%rowtype;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;

  select u.phone, u.phone_confirmed_at is not null,
         coalesce(nullif(v_name, ''), nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''))
    into v_auth_phone, v_confirmed, v_name
    from auth.users u
   where u.id = v_uid;

  if v_auth_phone is null or not coalesce(v_confirmed, false) then
    raise exception 'A verified phone number is required';
  end if;
  v_phone := public.fazatak_normalize_phone(v_auth_phone);

  select * into v_user
    from public.fazatak_users u
   where u.auth_user_id = v_uid
   for update;

  if not found then
    if (select count(*) from public.fazatak_users u
         where public.fazatak_normalize_phone(u.phone) = v_phone) > 1 then
      raise exception 'Multiple legacy accounts use this phone; support must review the account';
    end if;

    select * into v_user
      from public.fazatak_users u
     where public.fazatak_normalize_phone(u.phone) = v_phone
     for update;

    if found then
      if v_user.auth_user_id is not null and v_user.auth_user_id <> v_uid then
        raise exception 'This account is already linked to another verified identity';
      end if;

      if exists (
        select 1 from public.fazatak_user_data d
         where d.user_account_number = v_user.account_number
           and d.owner_user_id is not null and d.owner_user_id <> v_uid
      ) then raise exception 'Account data is linked to another identity'; end if;

      if exists (
        select 1 from public.fazatak_push_subscriptions p
         where public.fazatak_normalize_phone(p.user_phone) = v_phone
           and p.owner_user_id is not null and p.owner_user_id <> v_uid
      ) then raise exception 'Push subscriptions are linked to another identity'; end if;

      update public.fazatak_users u
         set auth_user_id = v_uid,
             password_hash = null,
             pin_hash = null,
             name = coalesce(nullif(v_name, ''), u.name),
             last_login_at = timezone('utc', now())
       where u.id = v_user.id
       returning * into v_user;

      update public.fazatak_user_data d
         set owner_user_id = v_uid
       where d.user_account_number = v_user.account_number
         and d.owner_user_id is null;

      update public.fazatak_push_subscriptions p
         set owner_user_id = v_uid
       where public.fazatak_normalize_phone(p.user_phone) = v_phone
         and p.owner_user_id is null;
    else
      if length(v_name) < 2 then raise exception 'Name is required for a new account'; end if;
      insert into public.fazatak_users (auth_user_id, phone, name, password_hash, pin_hash)
      values (v_uid, v_auth_phone, v_name, null, null)
      returning * into v_user;
      v_new_account := true;
    end if;
  else
    update public.fazatak_users u
       set last_login_at = timezone('utc', now())
     where u.id = v_user.id
     returning * into v_user;
  end if;

  return jsonb_build_object(
    'id', v_user.id,
    'auth_user_id', v_uid,
    'account_number', v_user.account_number,
    'phone', v_user.phone,
    'name', v_user.name,
    'subscription_status', v_user.subscription_status,
    'subscription_expiry', v_user.subscription_expiry,
    'created_at', v_user.created_at,
    'is_new_account', v_new_account
  );
end
$$;

create or replace function public.fazatak_get_my_profile()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', u.id,
    'auth_user_id', u.auth_user_id,
    'account_number', u.account_number,
    'phone', u.phone,
    'name', u.name,
    'subscription_status', u.subscription_status,
    'subscription_expiry', u.subscription_expiry,
    'created_at', u.created_at
  )
  from public.fazatak_users u
  where u.auth_user_id = auth.uid()
$$;

do $$
declare
  table_name text;
  policy_name text;
begin
  foreach table_name in array array[
    'fazatak_users', 'fazatak_user_data', 'fazatak_backups', 'fazatak_push_subscriptions'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('alter table public.%I force row level security', table_name);
    for policy_name in
      select p.policyname from pg_policies p
       where p.schemaname = 'public' and p.tablename = table_name
    loop
      execute format('drop policy %I on public.%I', policy_name, table_name);
    end loop;
    execute format('revoke all privileges on table public.%I from public, anon, authenticated', table_name);
  end loop;
end
$$;

grant select, insert, update, delete on table public.fazatak_user_data to authenticated;
grant select, insert, update, delete on table public.fazatak_backups to authenticated;
grant select on table public.fazatak_user_data to service_role;
grant select, insert, update, delete on table public.fazatak_push_subscriptions to service_role;

create policy fazatak_user_data_owner_all
  on public.fazatak_user_data for all to authenticated
  using (owner_user_id = (select auth.uid()))
  with check (owner_user_id = (select auth.uid()));

create policy fazatak_backups_owner_all
  on public.fazatak_backups for all to authenticated
  using (owner_user_id = (select auth.uid()))
  with check (owner_user_id = (select auth.uid()));

revoke all on function public.fazatak_normalize_phone(text) from public, anon, authenticated;
revoke all on function public.fazatak_finish_phone_signin(text) from public, anon;
revoke all on function public.fazatak_get_my_profile() from public, anon;
grant execute on function public.fazatak_finish_phone_signin(text) to authenticated;
grant execute on function public.fazatak_get_my_profile() to authenticated;

commit;
