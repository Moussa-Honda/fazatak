-- Emergency containment: remove all RLS policies from sensitive tables and revoke
-- direct client grants. Cloud features remain paused until secure auth is deployed.
-- No table data is deleted or modified.

begin;

do $$
declare
  table_name text;
  policy_name text;
begin
  foreach table_name in array array[
    'fazatak_users',
    'fazatak_user_data',
    'fazatak_backups',
    'fazatak_push_subscriptions'
  ] loop
    if to_regclass(format('public.%I', table_name)) is null then
      continue;
    end if;

    execute format('alter table public.%I enable row level security', table_name);
    execute format('alter table public.%I force row level security', table_name);

    for policy_name in
      select p.policyname
      from pg_policies p
      where p.schemaname = 'public' and p.tablename = table_name
    loop
      execute format('drop policy %I on public.%I', policy_name, table_name);
    end loop;

    execute format(
      'revoke all privileges on table public.%I from public, anon, authenticated',
      table_name
    );
  end loop;
end
$$;

commit;
