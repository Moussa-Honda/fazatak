-- إضافة رقم حساب ثابت للحسابات الحالية والجديدة.
-- نفّذ هذا الملف مرة واحدة في Supabase SQL Editor قبل نشر النسخة الجديدة.

begin;

create sequence if not exists fazatak_account_number_seq start with 10000001;

alter table fazatak_users
  add column if not exists account_number text;

update fazatak_users
set account_number = lpad(nextval('fazatak_account_number_seq')::text, 8, '0')
where account_number is null or btrim(account_number) = '';

select setval(
  'fazatak_account_number_seq',
  greatest(
    10000000,
    coalesce((select max(account_number::bigint) from fazatak_users), 10000000)
  ),
  true
);

alter table fazatak_users
  alter column account_number set default lpad(nextval('fazatak_account_number_seq')::text, 8, '0'),
  alter column account_number set not null;

create unique index if not exists idx_fazatak_users_account_number
  on fazatak_users(account_number);

commit;
