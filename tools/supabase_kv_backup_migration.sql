-- Run after creating the free BACKUP_KV namespace and before archiving old rows.
-- Source JSON remains in place until each KV copy is read back and verified.
begin;

alter table public.fazatak_backups
  add column if not exists backup_kv_key text;

alter table public.fazatak_backups
  alter column backup_data drop not null;

-- Customer tables remain available only through the authenticated Worker.
alter table public.fazatak_users enable row level security;
alter table public.fazatak_user_data enable row level security;
alter table public.fazatak_backups enable row level security;

drop policy if exists "Allow all operations for anon on fazatak_users" on public.fazatak_users;
drop policy if exists "Allow all operations for anon on fazatak_user_data" on public.fazatak_user_data;
drop policy if exists "Allow all operations for anon key" on public.fazatak_backups;

revoke all on table public.fazatak_users, public.fazatak_user_data, public.fazatak_backups from anon, authenticated;

-- Push subscriptions are also accessed through the authenticated Worker.
-- The table may not exist in projects where push setup has not been run.
do $$
begin
  if to_regclass('public.fazatak_push_subscriptions') is not null then
    alter table public.fazatak_push_subscriptions enable row level security;
    drop policy if exists "Allow all operations for anon on push subscriptions"
      on public.fazatak_push_subscriptions;
    revoke all on table public.fazatak_push_subscriptions from anon, authenticated;
  end if;
end;
$$;

commit;
