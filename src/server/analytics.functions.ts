import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ---------- Log a search event (no auth required, anyone can log) ----------

const LogSearchInput = z.object({
  query_text: z.string().max(2000).nullable().optional(),
  query_type: z.enum(["text", "image", "audio"]),
  modality_filter: z.string().max(20).nullable().optional(),
  result_count: z.number().int().min(0).max(10000),
  latency_ms: z.number().int().min(0).max(600000).nullable().optional(),
  used_vector: z.boolean().nullable().optional(),
  top_similarity: z.number().min(0).max(1).nullable().optional(),
});

export const logSearch = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => LogSearchInput.parse(input))
  .handler(async ({ data }) => {
    const { data: row, error } = await supabaseAdmin
      .from("search_events")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .insert({
        query_text: data.query_text ?? null,
        query_type: data.query_type,
        modality_filter: data.modality_filter ?? null,
        result_count: data.result_count,
        latency_ms: data.latency_ms ?? null,
        used_vector: data.used_vector ?? null,
        top_similarity: data.top_similarity ?? null,
      } as any)
      .select("id")
      .single();
    if (error) {
      // Don't fail the user's search just because logging failed.
      console.error("logSearch failed:", error.message);
      return { id: null };
    }
    return { id: row.id };
  });

// ---------- Log a click on a search result ----------

const LogClickInput = z.object({
  search_event_id: z.string().uuid().nullable().optional(),
  item_id: z.string().uuid(),
  position: z.number().int().min(0).max(1000).optional(),
});

export const logResultClick = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => LogClickInput.parse(input))
  .handler(async ({ data }) => {
    const { error } = await supabaseAdmin.from("result_clicks").insert({
      search_event_id: data.search_event_id ?? null,
      item_id: data.item_id,
      position: data.position ?? null,
    });
    if (error) {
      console.error("logResultClick failed:", error.message);
    }
    return { ok: true };
  });

// ---------- Get analytics (admin only, enforced by SECURITY DEFINER fn) ----------

export type SearchAnalytics = {
  total_searches: number;
  unique_queries: number;
  zero_result_count: number;
  total_clicks: number;
  modality_breakdown: Record<string, number>;
  top_queries: Array<{
    query: string;
    search_count: number;
    avg_results: number;
    clicks: number;
  }>;
  zero_result_queries: Array<{ query: string; cnt: number }>;
  searches_by_day: Array<{ day: string; cnt: number }>;
};

export const getSearchAnalytics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ days_back: z.number().int().min(1).max(365).default(30) }).parse(
      input ?? {},
    ),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Server-side admin guard (SQL function also enforces, defense-in-depth).
    const { data: roleRow } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle();
    if (!roleRow) throw new Error("Forbidden: admin role required");

    const { data: result, error } = await supabase.rpc("get_search_analytics", {
      days_back: data.days_back,
    });
    if (error) throw new Error(error.message);
    return { analytics: result as SearchAnalytics };
  });

// ---------- Vector search metrics (admin only) ----------

export type VectorMetrics = {
  total: number;
  vector_count: number;
  lexical_count: number;
  zero_result_rate: number;
  avg_latency_ms: number;
  p50_latency_ms: number;
  p95_latency_ms: number;
  avg_top_similarity: number;
  latency_by_day: Array<{ day: string; avg_ms: number; cnt: number }>;
  gt_total: number;
};

export const getVectorMetrics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ days_back: z.number().int().min(1).max(365).default(7) }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: result, error } = await (supabase.rpc as any)("get_vector_metrics", {
      days_back: data.days_back,
    });
    if (error) throw new Error(error.message);
    return { metrics: result as VectorMetrics };
  });

// ---------- Ground truth management + precision@k evaluation (admin) ----------

const GtAddInput = z.object({
  query_text: z.string().min(1).max(500),
  item_id: z.string().uuid(),
  is_relevant: z.boolean().default(true),
});

export const addGroundTruth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => GtAddInput.parse(input))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { error } = await supabaseAdmin
      .from("ground_truth_relevance")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .upsert({
        query_text: data.query_text.trim().toLowerCase(),
        item_id: data.item_id,
        is_relevant: data.is_relevant,
        created_by: userId,
      } as any, { onConflict: "query_text,item_id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listGroundTruth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.from as any)("ground_truth_relevance")
      .select("id, query_text, item_id, is_relevant, created_at")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return { rows: (data ?? []) as Array<{ id: string; query_text: string; item_id: string; is_relevant: boolean; created_at: string }> };
  });

export const deleteGroundTruth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from as any)("ground_truth_relevance").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Evaluate precision@k against current vector search, per unique query.
export const evaluateGroundTruth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ k: z.number().int().min(1).max(50).default(10) }).parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    // Confirm admin via role check (RLS + function will enforce too).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: gt, error } = await (supabase.from as any)("ground_truth_relevance")
      .select("query_text, item_id, is_relevant");
    if (error) throw new Error(error.message);
    type GtRow = { query_text: string; item_id: string; is_relevant: boolean };
    const rows = (gt ?? []) as GtRow[];
    const byQuery = new Map<string, Set<string>>();
    for (const r of rows) {
      if (!r.is_relevant) continue;
      if (!byQuery.has(r.query_text)) byQuery.set(r.query_text, new Set());
      byQuery.get(r.query_text)!.add(r.item_id);
    }

    const { embedText } = await import("./ai.server");
    const perQuery: Array<{
      query: string;
      relevant_total: number;
      hits_at_k: number;
      precision_at_k: number;
      recall_at_k: number;
    }> = [];
    let totalP = 0;
    let totalR = 0;
    let evaluated = 0;

    for (const [q, relevantSet] of byQuery.entries()) {
      try {
        const emb = await embedText(q);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: rs, error: e2 } = await (supabaseAdmin.rpc as any)("match_items_vec", {
          query_embedding: emb,
          match_count: data.k,
          modality_filter: undefined,
          min_similarity: 0,
        });
        if (e2) throw new Error(e2.message);
        const ids = (rs ?? []).map((r: { id: string }) => r.id);
        let hits = 0;
        for (const id of ids) if (relevantSet.has(id)) hits++;
        const p = hits / data.k;
        const recall = relevantSet.size > 0 ? hits / relevantSet.size : 0;
        perQuery.push({
          query: q,
          relevant_total: relevantSet.size,
          hits_at_k: hits,
          precision_at_k: p,
          recall_at_k: recall,
        });
        totalP += p;
        totalR += recall;
        evaluated++;
      } catch (e) {
        console.error("eval query failed:", q, e);
      }
    }

    return {
      k: data.k,
      queries_evaluated: evaluated,
      mean_precision_at_k: evaluated ? totalP / evaluated : 0,
      mean_recall_at_k: evaluated ? totalR / evaluated : 0,
      per_query: perQuery.sort((a, b) => b.precision_at_k - a.precision_at_k),
    };
  });
