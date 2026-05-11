
-- profiles table
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  subscription_status text not null default 'free' check (subscription_status in ('free','premium')),
  total_documents_used int not null default 0,
  pay_per_use_credits int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles_select_own" on public.profiles for select using (auth.uid() = id);
create policy "profiles_update_own" on public.profiles for update using (auth.uid() = id);
create policy "profiles_insert_own" on public.profiles for insert with check (auth.uid() = id);

-- documents table
create table public.documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  original_file_path text,
  normalized_pdf_path text,
  filled_file_path text,
  fields_json jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.documents enable row level security;

create policy "documents_select_own" on public.documents for select using (auth.uid() = user_id);
create policy "documents_insert_own" on public.documents for insert with check (auth.uid() = user_id);
create policy "documents_update_own" on public.documents for update using (auth.uid() = user_id);
create policy "documents_delete_own" on public.documents for delete using (auth.uid() = user_id);

-- updated_at trigger
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end; $$;

create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger documents_updated_at before update on public.documents
  for each row execute function public.set_updated_at();

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', '')
  );
  return new;
end; $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Storage buckets (private)
insert into storage.buckets (id, name, public) values
  ('originals','originals', false),
  ('normalized','normalized', false),
  ('filled','filled', false);

-- Storage policies: users can manage objects in their own folder (path prefix = user id)
create policy "originals_select_own" on storage.objects for select
  using (bucket_id = 'originals' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "originals_insert_own" on storage.objects for insert
  with check (bucket_id = 'originals' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "originals_delete_own" on storage.objects for delete
  using (bucket_id = 'originals' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "normalized_select_own" on storage.objects for select
  using (bucket_id = 'normalized' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "normalized_insert_own" on storage.objects for insert
  with check (bucket_id = 'normalized' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "normalized_delete_own" on storage.objects for delete
  using (bucket_id = 'normalized' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "filled_select_own" on storage.objects for select
  using (bucket_id = 'filled' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "filled_insert_own" on storage.objects for insert
  with check (bucket_id = 'filled' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "filled_delete_own" on storage.objects for delete
  using (bucket_id = 'filled' and auth.uid()::text = (storage.foldername(name))[1]);
