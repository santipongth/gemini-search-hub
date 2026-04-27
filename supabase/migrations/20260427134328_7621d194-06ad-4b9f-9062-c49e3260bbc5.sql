CREATE OR REPLACE FUNCTION public.get_search_analytics(days_back integer DEFAULT 30)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  result json;
  since timestamptz := now() - (days_back || ' days')::interval;
begin
  if not has_role(auth.uid(), 'admin'::app_role) then
    raise exception 'Not authorized';
  end if;

  select json_build_object(
    'total_searches', (select count(*) from search_events where created_at >= since),
    'unique_queries', (select count(distinct lower(coalesce(query_text,''))) from search_events where created_at >= since and query_text is not null),
    'zero_result_count', (select count(*) from search_events where created_at >= since and result_count = 0),
    'total_clicks', (select count(*) from result_clicks where created_at >= since),
    'modality_breakdown', (
      select coalesce(json_object_agg(query_type, c), '{}'::json) from (
        select query_type, count(*) c
        from search_events
        where created_at >= since
        group by query_type
      ) m
    ),
    'top_queries', (
      select coalesce(json_agg(t order by t.search_count desc), '[]'::json) from (
        with q as (
          select lower(query_text) as query,
                 count(*)::int as search_count,
                 avg(result_count)::float as avg_results
          from search_events
          where created_at >= since
            and query_text is not null
            and length(trim(query_text)) > 0
          group by lower(query_text)
          order by count(*) desc
          limit 20
        ),
        c as (
          select lower(se2.query_text) as query, count(*)::int as clicks
          from result_clicks rc
          join search_events se2 on se2.id = rc.search_event_id
          where se2.created_at >= since
            and se2.query_text is not null
          group by lower(se2.query_text)
        )
        select q.query, q.search_count, q.avg_results, coalesce(c.clicks, 0) as clicks
        from q
        left join c on c.query = q.query
      ) t
    ),
    'zero_result_queries', (
      select coalesce(json_agg(t order by t.cnt desc), '[]'::json) from (
        select lower(query_text) as query, count(*)::int as cnt
        from search_events
        where created_at >= since and result_count = 0 and query_text is not null and length(trim(query_text)) > 0
        group by lower(query_text)
        order by count(*) desc
        limit 20
      ) t
    ),
    'searches_by_day', (
      select coalesce(json_agg(t order by t.day asc), '[]'::json) from (
        select date_trunc('day', created_at)::date as day, count(*)::int as cnt
        from search_events
        where created_at >= since
        group by 1
        order by 1
      ) t
    )
  ) into result;

  return result;
end;
$function$;