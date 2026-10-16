-- =========================================================
-- فزتك (Fazatak) — إعداد جداول الحسابات والاشتراكات والمزامنة السحابية
-- قم بنسخ هذا الكود بالكامل وتنفيذه في SQL Editor في Supabase
-- =========================================================

-- 1. جدول حسابات المستخدمين (مرتبط برقم الهاتف)
create sequence if not exists fazatak_account_number_seq start with 10000001;

create table if not exists fazatak_users (
  id uuid default gen_random_uuid() primary key,
  account_number text unique not null default lpad(nextval('fazatak_account_number_seq')::text, 8, '0'),
  phone text unique not null,
  name text not null,
  password_hash text not null,
  pin_hash text not null,
  subscription_status text default 'trial' check (subscription_status in ('trial', 'active', 'expired')),
  subscription_expiry timestamp with time zone default (now() + interval '35 days'),
  created_at timestamp with time zone default timezone('utc'::text, now()),
  last_login_at timestamp with time zone default timezone('utc'::text, now()),
  metadata jsonb default '{}'::jsonb
);

-- إنشاء فهرس لرقم الهاتف لسرعة البحث وتسجيل الدخول
create index if not exists idx_fazatak_users_phone on fazatak_users(phone);

-- 2. جدول حفظ ومزامنة بيانات ومعاملات العميل (العقود، الأقساط، العملاء، السندات)
create table if not exists fazatak_user_data (
  id uuid default gen_random_uuid() primary key,
  user_account_number text unique not null references fazatak_users(account_number) on delete cascade,
  user_phone text unique not null references fazatak_users(phone) on delete cascade,
  backup_payload jsonb not null,
  records_count integer default 0,
  updated_at timestamp with time zone default timezone('utc'::text, now())
);

alter table fazatak_user_data
  add column if not exists user_account_number text;

update fazatak_user_data d
set user_account_number = u.account_number
from fazatak_users u
where d.user_phone = u.phone
  and (d.user_account_number is null or btrim(d.user_account_number) = '');

create unique index if not exists idx_fazatak_user_data_account_number
  on fazatak_user_data(user_account_number);

create index if not exists idx_fazatak_user_data_phone on fazatak_user_data(user_phone);

-- 3. جدول النسخ الاحتياطية العام (إن لم يكن منشأ مسبقاً)
create table if not exists fazatak_backups (
  id uuid default gen_random_uuid() primary key,
  file_name text,
  version text,
  records_count integer,
  tables_count integer,
  backup_data jsonb,
  backup_kv_key text,
  created_at timestamp with time zone default timezone('utc'::text, now())
);

-- 4. تفعيل سياسات الأمان (Row Level Security - RLS)
alter table fazatak_users enable row level security;
alter table fazatak_user_data enable row level security;
alter table fazatak_backups enable row level security;

-- These tables are accessed through the authenticated Worker, not directly by browser clients.
drop policy if exists "Allow all operations for anon on fazatak_users" on fazatak_users;
drop policy if exists "Allow all operations for anon on fazatak_user_data" on fazatak_user_data;
drop policy if exists "Allow all operations for anon key" on fazatak_backups;
revoke all on table public.fazatak_users, public.fazatak_user_data, public.fazatak_backups from anon, authenticated;
