
-- Enable pgvector
create extension if not exists vector;

-- Items table for the shared multimodal library
create table public.items (
  id uuid primary key default gen_random_uuid(),
  modality text not null check (modality in ('text','image','audio')),
  title text,
  description text,
  text_content text,
  storage_path text,
  mime_type text,
  embedding vector(768),
  created_at timestamptz not null default now()
);

create index items_embedding_idx on public.items using ivfflat (embedding vector_cosine_ops) with (lists = 100);
create index items_modality_idx on public.items (modality);

alter table public.items enable row level security;

-- Open access (no auth, demo)
create policy "anyone can read items" on public.items for select using (true);
create policy "anyone can insert items" on public.items for insert with check (true);
create policy "anyone can delete items" on public.items for delete using (true);

-- Similarity search RPC
create or replace function public.match_items(
  query_embedding vector(768),
  match_count int default 20,
  modality_filter text default null,
  min_similarity float default 0.0
)
returns table (
  id uuid,
  modality text,
  title text,
  description text,
  text_content text,
  storage_path text,
  mime_type text,
  similarity float,
  created_at timestamptz
)
language sql stable
as $$
  select
    i.id, i.modality, i.title, i.description, i.text_content,
    i.storage_path, i.mime_type,
    1 - (i.embedding <=> query_embedding) as similarity,
    i.created_at
  from public.items i
  where i.embedding is not null
    and (modality_filter is null or i.modality = modality_filter)
    and (1 - (i.embedding <=> query_embedding)) >= min_similarity
  order by i.embedding <=> query_embedding
  limit match_count;
$$;

-- Storage bucket for image and audio files
insert into storage.buckets (id, name, public) values ('library', 'library', true)
on conflict (id) do nothing;

create policy "public read library" on storage.objects for select using (bucket_id = 'library');
create policy "anyone upload library" on storage.objects for insert with check (bucket_id = 'library');
create policy "anyone delete library" on storage.objects for delete using (bucket_id = 'library');
