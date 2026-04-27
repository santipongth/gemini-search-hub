-- Enable pgvector
create extension if not exists vector with schema extensions;

-- Add embedding column (Gemini text-embedding-004 = 768 dims)
alter table public.items
  add column if not exists embedding extensions.vector(768);

-- HNSW index for cosine distance (fast ANN)
create index if not exists items_embedding_hnsw
  on public.items
  using hnsw (embedding extensions.vector_cosine_ops);

-- Vector search RPC: respects visibility (public OR owner OR admin)
create or replace function public.match_items_vec(
  query_embedding extensions.vector(768),
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
language sql
stable
security invoker
set search_path = public, extensions
as $$
  select
    i.id, i.modality, i.title, i.description, i.text_content,
    i.storage_path, i.mime_type,
    (1 - (i.embedding <=> query_embedding))::float as similarity,
    i.created_at
  from public.items i
  where i.embedding is not null
    and (modality_filter is null or i.modality = modality_filter)
    and (
      i.visibility = 'public'
      or i.owner_id = auth.uid()
      or public.has_role(auth.uid(), 'admin'::public.app_role)
    )
    and (1 - (i.embedding <=> query_embedding)) >= min_similarity
  order by i.embedding <=> query_embedding
  limit match_count;
$$;

-- Count items missing embeddings (admin-only via RLS-aware admin check)
create or replace function public.count_missing_embeddings()
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int from public.items where embedding is null;
$$;

-- Admin-only: list ids of items needing embeddings (paged)
create or replace function public.list_missing_embedding_ids(batch_size int default 20)
returns table (id uuid, search_text text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_role(auth.uid(), 'admin'::public.app_role) then
    raise exception 'Not authorized';
  end if;
  return query
    select i.id, coalesce(i.search_text,'') as search_text
    from public.items i
    where i.embedding is null
    order by i.created_at desc
    limit greatest(1, least(batch_size, 100));
end;
$$;