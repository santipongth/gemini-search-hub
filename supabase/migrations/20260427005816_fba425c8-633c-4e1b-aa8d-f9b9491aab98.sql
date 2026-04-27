-- =========================================================================
-- 1. Roles & profiles
-- =========================================================================

create type public.app_role as enum ('admin', 'user');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);
alter table public.user_roles enable row level security;

-- Security-definer role check (avoids RLS recursion)
create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = _user_id and role = _role
  )
$$;

-- updated_at helper (idempotent)
create or replace function public.update_updated_at_column()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_profiles_updated_at
before update on public.profiles
for each row execute function public.update_updated_at_column();

-- Auto-create profile + role on signup. First signup => admin.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  is_first_user boolean;
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;

  select not exists (select 1 from public.user_roles) into is_first_user;

  insert into public.user_roles (user_id, role)
  values (new.id, case when is_first_user then 'admin'::public.app_role else 'user'::public.app_role end)
  on conflict do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Profiles RLS: everyone can read profiles (display name is public-ish);
-- users can update their own.
create policy "Profiles are viewable by everyone"
on public.profiles for select using (true);

create policy "Users can update own profile"
on public.profiles for update using (auth.uid() = id);

create policy "Users can insert own profile"
on public.profiles for insert with check (auth.uid() = id);

-- user_roles RLS: a user can read their own roles; admins can read all.
create policy "Users can view own roles"
on public.user_roles for select using (auth.uid() = user_id);

create policy "Admins can view all roles"
on public.user_roles for select using (public.has_role(auth.uid(), 'admin'));

create policy "Admins can manage roles"
on public.user_roles for all
using (public.has_role(auth.uid(), 'admin'))
with check (public.has_role(auth.uid(), 'admin'));

-- =========================================================================
-- 2. Items: ownership, visibility, content hash
-- =========================================================================

alter table public.items
  add column if not exists owner_id uuid references auth.users(id) on delete set null,
  add column if not exists visibility text not null default 'public',
  add column if not exists content_hash text;

alter table public.items
  add constraint items_visibility_check check (visibility in ('public', 'private'));

create index if not exists items_owner_id_idx on public.items(owner_id);
create index if not exists items_visibility_idx on public.items(visibility);
create index if not exists items_content_hash_idx on public.items(content_hash);

-- Replace open RLS
drop policy if exists "anyone can read items" on public.items;

create policy "View public items or own items or admin"
on public.items for select
using (
  visibility = 'public'
  or owner_id = auth.uid()
  or public.has_role(auth.uid(), 'admin')
);

create policy "Authenticated users can insert as owner"
on public.items for insert
with check (
  auth.uid() is not null
  and owner_id = auth.uid()
);

create policy "Owners or admins can update"
on public.items for update
using (
  owner_id = auth.uid()
  or public.has_role(auth.uid(), 'admin')
);

create policy "Owners or admins can delete"
on public.items for delete
using (
  owner_id = auth.uid()
  or public.has_role(auth.uid(), 'admin')
);

-- =========================================================================
-- 3. Storage RLS for the `library` bucket
-- Files are stored at `{owner_uid}/{modality}/{uuid}.{ext}`
-- =========================================================================

create policy "Anyone can read library files"
on storage.objects for select
using (bucket_id = 'library');

create policy "Authenticated users can upload to own folder"
on storage.objects for insert
with check (
  bucket_id = 'library'
  and auth.uid() is not null
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "Owners or admins can update library files"
on storage.objects for update
using (
  bucket_id = 'library'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.has_role(auth.uid(), 'admin')
  )
);

create policy "Owners or admins can delete library files"
on storage.objects for delete
using (
  bucket_id = 'library'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.has_role(auth.uid(), 'admin')
  )
);
