-- 1) Move extensions out of public schema
CREATE SCHEMA IF NOT EXISTS extensions;
ALTER EXTENSION pg_trgm SET SCHEMA extensions;
ALTER EXTENSION vector SET SCHEMA extensions;
GRANT USAGE ON SCHEMA extensions TO postgres, anon, authenticated, service_role;

-- Recreate match_items to reference relocated functions via search_path
CREATE OR REPLACE FUNCTION public.match_items(
  query_text text,
  match_count integer DEFAULT 20,
  modality_filter text DEFAULT NULL::text,
  min_similarity double precision DEFAULT 0.0
)
RETURNS TABLE(id uuid, modality text, title text, description text, text_content text, storage_path text, mime_type text, similarity double precision, created_at timestamp with time zone)
LANGUAGE sql
STABLE
SET search_path TO 'public', 'extensions'
AS $function$
  with scored as (
    select
      i.*,
      greatest(
        extensions.similarity(coalesce(i.search_text,''), query_text),
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
$function$;

-- 2) Tighten RLS on items: keep public SELECT, remove permissive INSERT/DELETE.
-- Writes go through server functions that use the service role (bypassing RLS).
DROP POLICY IF EXISTS "anyone can insert items" ON public.items;
DROP POLICY IF EXISTS "anyone can delete items" ON public.items;

-- 3) Tighten storage: allow public read of individual files, but disallow listing.
-- Drop any broad SELECT policy and replace with a no-op SELECT policy.
-- Public bucket means files remain accessible by direct URL via getPublicUrl.
DO $$
DECLARE p record;
BEGIN
  FOR p IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname IN (
        'Public read library', 'public can read library', 'Public Access',
        'Allow public read on library', 'Library public read'
      )
  LOOP
    EXECUTE format('DROP POLICY %I ON storage.objects', p.policyname);
  END LOOP;
END $$;

-- No SELECT policy on storage.objects for the library bucket means anon cannot
-- list. Public bucket files are still served via the public CDN URL.
