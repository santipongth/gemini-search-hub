
-- Drop old vector-based function & column
drop function if exists public.match_items(vector, int, text, float);
alter table public.items drop column if exists embedding;

-- Add searchable text column
alter table public.items add column if not exists search_text text;

create extension if not exists pg_trgm;

create index if not exists items_search_trgm on public.items using gin (search_text gin_trgm_ops);
create index if not exists items_search_fts on public.items using gin (to_tsvector('english', coalesce(search_text,'')));

create or replace function public.match_items(
  query_text text,
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
set search_path = public
as $$
  with scored as (
    select
      i.*,
      greatest(
        similarity(coalesce(i.search_text,''), query_text),
        ts_rank_cd(to_tsvector('english', coalesce(i.search_text,'')), plainto_tsquery('english', query_text)) * 0.5
      ) as score
    from public.items i
    where (modality_filter is null or i.modality = modality_filter)
  )
  select id, modality, title, description, text_content, storage_path, mime_type,
         score::float as similarity, created_at
  from scored
  where score >= min_similarity
  order by score desc
  limit match_count;
$$;
