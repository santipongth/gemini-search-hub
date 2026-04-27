-- Add latency tracking + vector flag to search_events
ALTER TABLE public.search_events
  ADD COLUMN IF NOT EXISTS latency_ms integer,
  ADD COLUMN IF NOT EXISTS used_vector boolean,
  ADD COLUMN IF NOT EXISTS top_similarity double precision;

-- Ground-truth relevance judgments for evaluation
CREATE TABLE IF NOT EXISTS public.ground_truth_relevance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  query_text text NOT NULL,
  item_id uuid NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  is_relevant boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (query_text, item_id)
);

ALTER TABLE public.ground_truth_relevance ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage ground truth"
  ON public.ground_truth_relevance
  FOR ALL
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

-- Vector search metrics RPC (admin only)
CREATE OR REPLACE FUNCTION public.get_vector_metrics(days_back integer DEFAULT 7)
RETURNS json
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  since timestamptz := now() - (days_back || ' days')::interval;
  result json;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT json_build_object(
    'total', (SELECT count(*) FROM search_events WHERE created_at >= since),
    'vector_count', (SELECT count(*) FROM search_events WHERE created_at >= since AND used_vector = true),
    'lexical_count', (SELECT count(*) FROM search_events WHERE created_at >= since AND used_vector = false),
    'zero_result_rate', (
      SELECT CASE WHEN count(*) = 0 THEN 0
        ELSE (count(*) FILTER (WHERE result_count = 0))::float / count(*)
      END FROM search_events WHERE created_at >= since
    ),
    'avg_latency_ms', (SELECT coalesce(avg(latency_ms),0)::int FROM search_events WHERE created_at >= since AND latency_ms IS NOT NULL),
    'p50_latency_ms', (SELECT coalesce(percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms),0)::int FROM search_events WHERE created_at >= since AND latency_ms IS NOT NULL),
    'p95_latency_ms', (SELECT coalesce(percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms),0)::int FROM search_events WHERE created_at >= since AND latency_ms IS NOT NULL),
    'avg_top_similarity', (SELECT coalesce(avg(top_similarity),0)::float FROM search_events WHERE created_at >= since AND top_similarity IS NOT NULL),
    'latency_by_day', (
      SELECT coalesce(json_agg(t ORDER BY t.day ASC), '[]'::json) FROM (
        SELECT date_trunc('day', created_at)::date AS day,
               coalesce(avg(latency_ms),0)::int AS avg_ms,
               count(*)::int AS cnt
        FROM search_events
        WHERE created_at >= since AND latency_ms IS NOT NULL
        GROUP BY 1 ORDER BY 1
      ) t
    ),
    'gt_total', (SELECT count(*) FROM ground_truth_relevance)
  ) INTO result;

  RETURN result;
END;
$$;