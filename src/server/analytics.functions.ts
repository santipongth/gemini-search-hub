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
