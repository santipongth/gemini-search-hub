-- ===== Tags & item_tags =====
create table public.tags (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (owner_id, name)
);

alter table public.tags enable row level security;

create policy "View own tags or admin"
on public.tags for select
using (owner_id = auth.uid() or has_role(auth.uid(), 'admin'::app_role));

create policy "Insert own tags"
on public.tags for insert
with check (auth.uid() is not null and owner_id = auth.uid());

create policy "Update own tags or admin"
on public.tags for update
using (owner_id = auth.uid() or has_role(auth.uid(), 'admin'::app_role));

create policy "Delete own tags or admin"
on public.tags for delete
using (owner_id = auth.uid() or has_role(auth.uid(), 'admin'::app_role));

create table public.item_tags (
  item_id uuid not null references public.items(id) on delete cascade,
  tag_id uuid not null references public.tags(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (item_id, tag_id)
);

alter table public.item_tags enable row level security;

create policy "View item_tags follows item visibility"
on public.item_tags for select
using (
  exists (
    select 1 from public.items i
    where i.id = item_tags.item_id
      and (i.visibility = 'public' or i.owner_id = auth.uid() or has_role(auth.uid(), 'admin'::app_role))
  )
);

create policy "Manage item_tags if owner of item or admin"
on public.item_tags for all
using (
  exists (
    select 1 from public.items i
    where i.id = item_tags.item_id
      and (i.owner_id = auth.uid() or has_role(auth.uid(), 'admin'::app_role))
  )
)
with check (
  exists (
    select 1 from public.items i
    where i.id = item_tags.item_id
      and (i.owner_id = auth.uid() or has_role(auth.uid(), 'admin'::app_role))
  )
);

create index idx_item_tags_tag on public.item_tags(tag_id);

-- ===== Analytics: search_events & result_clicks =====
create table public.search_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  query_text text,
  query_type text not null check (query_type in ('text','image','audio')),
  modality_filter text,
  result_count integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.search_events enable row level security;

-- Anyone (incl. anon) may insert a search event.
create policy "Anyone can log a search"
on public.search_events for insert
with check (true);

-- Only admins can read aggregate analytics.
create policy "Admins can read search events"
on public.search_events for select
using (has_role(auth.uid(), 'admin'::app_role));

create index idx_search_events_created on public.search_events(created_at desc);
create index idx_search_events_query on public.search_events(query_text);

create table public.result_clicks (
  id uuid primary key default gen_random_uuid(),
  search_event_id uuid references public.search_events(id) on delete set null,
  item_id uuid references public.items(id) on delete set null,
  position integer,
  user_id uuid,
  created_at timestamptz not null default now()
);

alter table public.result_clicks enable row level security;

create policy "Anyone can log a click"
on public.result_clicks for insert
with check (true);

create policy "Admins can read clicks"
on public.result_clicks for select
using (has_role(auth.uid(), 'admin'::app_role));

create index idx_result_clicks_event on public.result_clicks(search_event_id);
create index idx_result_clicks_created on public.result_clicks(created_at desc);

-- ===== Analytics aggregation function (admin-only via RLS at call sites) =====
create or replace function public.get_search_analytics(days_back integer default 30)
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result json;
  since timestamptz := now() - (days_back || ' days')::interval;
begin
  -- Only admins may call this.
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
        select
          lower(query_text) as query,
          count(*)::int as search_count,
          avg(result_count)::float as avg_results,
          (
            select count(*) from result_clicks rc
            join search_events se2 on se2.id = rc.search_event_id
            where lower(se2.query_text) = lower(se.query_text)
              and se2.created_at >= since
          )::int as clicks
        from search_events se
        where created_at >= since and query_text is not null and length(trim(query_text)) > 0
        group by lower(query_text)
        order by count(*) desc
        limit 20
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
$$;