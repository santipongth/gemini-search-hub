
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
set search_path = public
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
