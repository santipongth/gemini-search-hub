create or replace function public.explain_match(item_id uuid, query_text text)
returns table(
  field text,
  source_text text,
  trigram_similarity double precision,
  lexical_rank double precision,
  combined_score double precision
)
language sql
stable
set search_path to 'public', 'extensions'
as $function$
  with parts as (
    select 'title'::text as field, coalesce(i.title,'') as source_text from public.items i where i.id = item_id
    union all
    select 'description', coalesce(i.description,'') from public.items i where i.id = item_id
    union all
    select 'ai_text', coalesce(i.text_content,'') from public.items i where i.id = item_id
    union all
    select 'search_text', coalesce(i.search_text,'') from public.items i where i.id = item_id
  )
  select
    p.field,
    p.source_text,
    extensions.similarity(p.source_text, query_text)::float as trigram_similarity,
    (ts_rank_cd(to_tsvector('english', p.source_text), plainto_tsquery('english', query_text)))::float as lexical_rank,
    greatest(
      extensions.similarity(p.source_text, query_text),
      ts_rank_cd(to_tsvector('english', p.source_text), plainto_tsquery('english', query_text)) * 0.5
    )::float as combined_score
  from parts p;
$function$;