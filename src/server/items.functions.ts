import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { describeImage, transcribeAudio, embedText } from "./ai.server";
import {
  validateUploadedFile,
  makeAudioDurationFailure,
  MAX_AUDIO_SECONDS,
  type ValidationErrorPayload,
  type ValidationFailure,
} from "@/lib/file-validation";
import { parseAudioDurationSeconds } from "./audio-duration.server";

const Modality = z.enum(["text", "image", "audio"]);
const Visibility = z.enum(["public", "private"]);

function throwValidationError(failures: ValidationFailure[]): never {
  const payload: ValidationErrorPayload = {
    code: "FILE_VALIDATION_FAILED",
    failures,
  };
  throw new Error(JSON.stringify(payload));
}

function decodeDataUrl(dataUrl: string): Uint8Array | null {
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) return null;
  try {
    return Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

async function sha256Hex(bytes: Uint8Array | string): Promise<string> {
  const data =
    typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  // Coerce to a fresh ArrayBuffer to satisfy the BufferSource type across runtimes.
  const buf = new Uint8Array(data).buffer;
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function runServerFileValidation(args: {
  data_url: string | undefined;
  mime_type: string | undefined;
  kind: "image" | "audio";
  filename: string | undefined;
  duration_hint?: number;
}): { bytes: Uint8Array } {
  const extra: ValidationFailure[] = [];
  const bytes =
    args.data_url && args.mime_type ? decodeDataUrl(args.data_url) : null;

  if (args.kind === "audio" && bytes && args.mime_type) {
    const seconds = parseAudioDurationSeconds(bytes, args.mime_type);
    if (seconds !== null && seconds > MAX_AUDIO_SECONDS) {
      extra.push(makeAudioDurationFailure(seconds));
    }
  }

  const failures = validateUploadedFile(
    {
      data_url: args.data_url,
      mime_type: args.mime_type,
      kind: args.kind,
      filename: args.filename,
      audio_duration_seconds: args.duration_hint,
    },
    extra,
  );
  if (failures.length > 0) throwValidationError(failures);
  if (!bytes) {
    throwValidationError([
      {
        rule: "data_url_format",
        message: "File could not be decoded after validation.",
        details: { filename: args.filename },
      },
    ]);
  }
  return { bytes };
}

// ---------- Add an item ----------

const AddInput = z.object({
  modality: Modality,
  title: z.string().max(200).optional(),
  description: z.string().max(1000).optional(),
  visibility: Visibility.default("public"),
  text_content: z.string().max(8000).optional(),
  data_url: z.string().optional(),
  mime_type: z.string().max(100).optional(),
  filename: z.string().max(200).optional(),
  audio_duration_seconds: z.number().min(0).max(60 * 60).optional(),
  // If true, skip duplicate-hash blocking and insert anyway.
  allow_duplicate: z.boolean().default(false),
});

export const addItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => AddInput.parse(input))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    let embeddingSource = "";
    let storage_path: string | null = null;
    let text_content: string | null = null;
    let content_hash: string | null = null;

    if (data.modality === "text") {
      if (!data.text_content?.trim()) throw new Error("Text content is required");
      text_content = data.text_content.trim();
      content_hash = await sha256Hex(text_content.toLowerCase().replace(/\s+/g, " "));
      embeddingSource = [data.title, data.description, text_content]
        .filter(Boolean)
        .join("\n");
    } else {
      const { bytes } = runServerFileValidation({
        data_url: data.data_url,
        mime_type: data.mime_type,
        kind: data.modality,
        filename: data.filename,
        duration_hint: data.audio_duration_seconds,
      });

      content_hash = await sha256Hex(bytes);

      const ext = (data.filename?.split(".").pop() || "bin").toLowerCase();
      // Per-user folder so storage RLS can scope writes.
      const path = `${userId}/${data.modality}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabaseAdmin.storage
        .from("library")
        .upload(path, bytes, { contentType: data.mime_type!, upsert: false });
      if (upErr) throw new Error(`Upload failed: ${upErr.message}`);
      storage_path = path;

      const aiText =
        data.modality === "image"
          ? await describeImage(data.data_url!)
          : await transcribeAudio(data.data_url!, data.mime_type!);
      text_content = aiText;
      embeddingSource = [data.title, data.description, aiText].filter(Boolean).join("\n");
    }

    // Duplicate check (exact hash, scoped to this user).
    if (content_hash && !data.allow_duplicate) {
      const { data: dup } = await supabaseAdmin
        .from("items")
        .select("id, title")
        .eq("owner_id", userId)
        .eq("content_hash", content_hash)
        .limit(1)
        .maybeSingle();
      if (dup) {
        // Clean up uploaded file before signaling duplicate.
        if (storage_path) {
          await supabaseAdmin.storage.from("library").remove([storage_path]);
        }
        const err = new Error(
          JSON.stringify({
            code: "DUPLICATE_ITEM",
            existing_id: dup.id,
            existing_title: dup.title,
          }),
        );
        throw err;
      }
    }

    // Compute embedding (best-effort: don't fail insert if AI is unavailable)
    let embedding: number[] | null = null;
    try {
      if (embeddingSource.trim()) {
        embedding = await embedText(embeddingSource);
      }
    } catch (e) {
      console.error("Embedding failed during insert (item will be backfilled later):", e);
    }

    const insertPayload: Record<string, unknown> = {
      modality: data.modality,
      title: data.title ?? null,
      description: data.description ?? null,
      text_content,
      storage_path,
      mime_type: data.mime_type ?? null,
      search_text: embeddingSource,
      owner_id: userId,
      visibility: data.visibility,
      content_hash,
    };
    if (embedding) insertPayload.embedding = embedding;

    const { data: row, error } = await supabaseAdmin
      .from("items")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .insert(insertPayload as any)
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    return { id: row.id, embedded: !!embedding };
  });

// ---------- Search ----------

const SearchInput = z.object({
  query_type: Modality,
  text: z.string().max(2000).optional(),
  data_url: z.string().optional(),
  mime_type: z.string().max(100).optional(),
  filename: z.string().max(200).optional(),
  audio_duration_seconds: z.number().min(0).max(60 * 60).optional(),
  modality_filter: z.union([Modality, z.literal("all")]).default("all"),
  min_similarity: z.number().min(0).max(1).default(0),
  limit: z.number().int().min(1).max(50).default(20),
});

export const searchItems = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => SearchInput.parse(input))
  .handler(async ({ data }) => {
    let queryText = "";
    if (data.query_type === "text") {
      if (!data.text?.trim()) throw new Error("Query text required");
      queryText = data.text.trim();
    } else {
      const kind = data.query_type;
      runServerFileValidation({
        data_url: data.data_url,
        mime_type: data.mime_type,
        kind,
        filename: data.filename,
        duration_hint: data.audio_duration_seconds,
      });
      queryText =
        kind === "image"
          ? await describeImage(data.data_url!)
          : await transcribeAudio(data.data_url!, data.mime_type!);
    }

    // Embed the query, then use vector search.
    // Fall back to lexical/trigram search only if embedding fails.
    type SearchRow = {
      id: string;
      modality: string;
      title: string | null;
      description: string | null;
      text_content: string | null;
      storage_path: string | null;
      mime_type: string | null;
      similarity: number;
      created_at: string;
    };
    let results: SearchRow[] = [];
    let usedVector = false;
    try {
      const queryEmbedding = await embedText(queryText);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: rows, error } = await (supabaseAdmin.rpc as any)("match_items_vec", {
        query_embedding: queryEmbedding,
        match_count: data.limit,
        modality_filter: data.modality_filter === "all" ? undefined : data.modality_filter,
        min_similarity: data.min_similarity,
      });
      if (error) throw new Error(error.message);
      results = (rows ?? []) as SearchRow[];
      usedVector = true;
    } catch (e) {
      console.warn("Vector search failed, falling back to lexical:", e);
      const { data: rows, error } = await supabaseAdmin.rpc("match_items", {
        query_text: queryText,
        match_count: data.limit,
        modality_filter: data.modality_filter === "all" ? undefined : data.modality_filter,
        min_similarity: data.min_similarity,
      });
      if (error) throw new Error(error.message);
      results = (rows ?? []) as SearchRow[];
    }

    return { results, interpreted_query: queryText, used_vector: usedVector };
  });

// ---------- Find similar by item id ----------

export const findSimilar = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid(), limit: z.number().int().min(1).max(50).default(10) }).parse(input))
  .handler(async ({ data }) => {
    const { data: itemRaw, error } = await supabaseAdmin
      .from("items")
      .select("id, search_text")
      .eq("id", data.id)
      .single();
    if (error || !itemRaw) throw new Error("Item not found");
    // Fetch embedding via raw SQL-style cast (column not in generated types yet).
    const { data: embRow } = await supabaseAdmin
      .from("items")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .select("embedding" as any)
      .eq("id", data.id)
      .single();
    const item = { ...itemRaw, embedding: (embRow as { embedding?: number[] | string | null } | null)?.embedding ?? null };

    // Prefer existing embedding; fall back to lexical when missing.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const existingEmb = (item as any).embedding as number[] | string | null;
    if (existingEmb) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: rows, error: e2 } = await (supabaseAdmin.rpc as any)("match_items_vec", {
        query_embedding: existingEmb,
        match_count: data.limit + 1,
        modality_filter: undefined,
        min_similarity: 0,
      });
      if (e2) throw new Error(e2.message);
      return { results: (rows ?? []).filter((r: { id: string }) => r.id !== data.id).slice(0, data.limit) };
    }

    const { data: rows, error: e2 } = await supabaseAdmin.rpc("match_items", {
      query_text: item.search_text ?? "",
      match_count: data.limit + 1,
      modality_filter: undefined,
      min_similarity: 0,
    });
    if (e2) throw new Error(e2.message);
    return { results: (rows ?? []).filter((r: { id: string }) => r.id !== data.id).slice(0, data.limit) };
  });

// ---------- List & delete ----------

// Public listing (anonymous-safe): returns only public items.
export const listPublicItems = createServerFn({ method: "GET" })
  .handler(async () => {
    const { data, error } = await supabaseAdmin
      .from("items")
      .select("id, modality, title, description, text_content, storage_path, mime_type, created_at, visibility")
      .eq("visibility", "public")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return { items: data ?? [] };
  });

// Admin/owner listing with cursor pagination + filters.
const ListInput = z.object({
  cursor: z.string().nullish(),
  limit: z.number().int().min(1).max(100).default(24),
  modality: z.union([Modality, z.literal("all")]).default("all"),
  visibility: z.union([Visibility, z.literal("all")]).default("all"),
  search: z.string().max(200).optional(),
  scope: z.enum(["mine", "all"]).default("mine"),
});

export const listItems = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ListInput.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    // Check admin via has_role (service-role client).
    const { data: roleRow } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle();
    const isAdmin = !!roleRow;

    let q = supabaseAdmin
      .from("items")
      .select("id, modality, title, description, text_content, storage_path, mime_type, created_at, visibility, owner_id, content_hash")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(data.limit + 1);

    if (data.scope === "mine" || !isAdmin) {
      q = q.eq("owner_id", userId);
    }
    if (data.modality !== "all") q = q.eq("modality", data.modality);
    if (data.visibility !== "all") q = q.eq("visibility", data.visibility);
    if (data.search?.trim()) {
      const term = data.search.trim().replace(/[%_]/g, " ");
      q = q.or(
        `title.ilike.%${term}%,description.ilike.%${term}%,text_content.ilike.%${term}%`,
      );
    }
    if (data.cursor) {
      // Cursor format: "<iso>|<uuid>"
      const [ts, id] = data.cursor.split("|");
      if (ts && id) {
        q = q.or(`created_at.lt.${ts},and(created_at.eq.${ts},id.lt.${id})`);
      }
    }

    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    const items = rows ?? [];
    const hasMore = items.length > data.limit;
    const page = hasMore ? items.slice(0, data.limit) : items;
    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last ? `${last.created_at}|${last.id}` : null;

    return { items: page, nextCursor, isAdmin };
  });

export const getItem = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { data: row, error } = await supabaseAdmin
      .from("items")
      .select("id, modality, title, description, text_content, storage_path, mime_type, created_at, visibility, owner_id")
      .eq("id", data.id)
      .single();
    if (error || !row) throw new Error("Item not found");
    return { item: row };
  });

async function isAdmin(userId: string): Promise<boolean> {
  const { data: roleRow } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  return !!roleRow;
}

async function assertAdmin(userId: string): Promise<void> {
  if (!(await isAdmin(userId))) {
    throw new Error("Forbidden: admin role required");
  }
}

async function assertCanMutate(itemId: string, userId: string): Promise<void> {
  const { data: row } = await supabaseAdmin
    .from("items")
    .select("owner_id")
    .eq("id", itemId)
    .maybeSingle();
  if (!row) throw new Error("Item not found");
  if (row.owner_id === userId) return;
  const { data: roleRow } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (!roleRow) throw new Error("Not authorized to modify this item");
}

export const deleteItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertCanMutate(data.id, context.userId);
    const { data: row } = await supabaseAdmin
      .from("items")
      .select("storage_path")
      .eq("id", data.id)
      .single();
    if (row?.storage_path) {
      await supabaseAdmin.storage.from("library").remove([row.storage_path]);
    }
    const { error } = await supabaseAdmin.from("items").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const UpdateInput = z.object({
  id: z.string().uuid(),
  title: z.string().max(200).nullable().optional(),
  description: z.string().max(1000).nullable().optional(),
  visibility: Visibility.optional(),
});

export const updateItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => UpdateInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertCanMutate(data.id, context.userId);

    const patch: {
      title?: string | null;
      description?: string | null;
      visibility?: "public" | "private";
      search_text?: string;
    } = {};
    if (data.title !== undefined) patch.title = data.title;
    if (data.description !== undefined) patch.description = data.description;
    if (data.visibility !== undefined) patch.visibility = data.visibility;

    // If title or description changed, recompute search_text.
    if (patch.title !== undefined || patch.description !== undefined) {
      const { data: row } = await supabaseAdmin
        .from("items")
        .select("title, description, text_content")
        .eq("id", data.id)
        .single();
      if (row) {
        const title = patch.title !== undefined ? patch.title : row.title;
        const description =
          patch.description !== undefined ? patch.description : row.description;
        patch.search_text = [title, description, row.text_content]
          .filter(Boolean)
          .join("\n");
      }
    }

    const { error } = await supabaseAdmin
      .from("items")
      .update(patch)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Bulk delete (owner or admin per item).
export const bulkDeleteItems = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ ids: z.array(z.string().uuid()).min(1).max(200) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    // Server-side admin guard for bulk destructive ops. Single-item delete
    // still allows owners (handled by assertCanMutate inside the loop).
    await assertAdmin(context.userId);

    let deleted = 0;
    const errors: string[] = [];
    for (const id of data.ids) {
      try {
        await assertCanMutate(id, context.userId);
        const { data: row } = await supabaseAdmin
          .from("items")
          .select("storage_path")
          .eq("id", id)
          .maybeSingle();
        if (row?.storage_path) {
          await supabaseAdmin.storage.from("library").remove([row.storage_path]);
        }
        await supabaseAdmin.from("items").delete().eq("id", id);
        deleted++;
      } catch (e) {
        errors.push(`${id}: ${e instanceof Error ? e.message : "failed"}`);
      }
    }
    return { deleted, errors };
  });

// ---------- Public file URL helper (server) ----------

export const getPublicUrl = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => z.object({ path: z.string() }).parse(input))
  .handler(async ({ data }) => {
    const { data: signed, error } = await supabaseAdmin
      .storage
      .from("library")
      .createSignedUrl(data.path, 60 * 60);
    if (error || !signed) throw new Error(error?.message ?? "Failed to sign URL");
    return { url: signed.signedUrl };
  });

// ---------- Explain match: per-field similarity breakdown ----------

const STOPWORDS = new Set([
  "the","a","an","and","or","but","of","in","on","at","to","for","with","by","from",
  "is","are","was","were","be","been","being","it","this","that","these","those","as",
  "i","me","my","you","your","we","our","they","them","their","what","which","who",
  "whom","where","when","why","how","all","any","both","each","few","more","most",
  "other","some","such","no","not","only","own","same","so","than","too","very","can",
  "will","just","don","should","now","about",
]);

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

function rankContributingTokens(
  queryTokens: string[],
  fields: Array<{ field: string; source_text: string }>,
): Array<{ token: string; weight: number; fields: string[] }> {
  const out: Array<{ token: string; weight: number; fields: string[] }> = [];
  const seen = new Set<string>();
  for (const t of queryTokens) {
    if (seen.has(t)) continue;
    seen.add(t);
    let weight = 0;
    const matchedFields: string[] = [];
    for (const f of fields) {
      const text = f.source_text.toLowerCase();
      if (!text) continue;
      let count = 0;
      let idx = text.indexOf(t);
      while (idx !== -1) {
        count++;
        idx = text.indexOf(t, idx + t.length);
      }
      if (count > 0) {
        matchedFields.push(f.field);
        const fieldBoost =
          f.field === "title" ? 3 : f.field === "description" ? 2 : 1;
        weight += count * fieldBoost;
      }
    }
    if (weight > 0) out.push({ token: t, weight, fields: matchedFields });
  }
  return out.sort((a, b) => b.weight - a.weight);
}

export const explainMatch = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        query_text: z.string().min(1).max(2000),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { data: rows, error } = await supabaseAdmin.rpc("explain_match", {
      item_id: data.id,
      query_text: data.query_text,
    });
    if (error) throw new Error(error.message);

    const fields = (rows ?? []) as Array<{
      field: string;
      source_text: string;
      trigram_similarity: number;
      lexical_rank: number;
      combined_score: number;
    }>;

    const overall = fields.find((f) => f.field === "search_text");
    const breakdown = fields.filter((f) => f.field !== "search_text");

    const queryTokens = tokenize(data.query_text);
    const contributingTokens = rankContributingTokens(
      queryTokens,
      breakdown.map((f) => ({ field: f.field, source_text: f.source_text })),
    ).slice(0, 8);

    return {
      overall_score: overall?.combined_score ?? null,
      breakdown,
      contributing_tokens: contributingTokens,
      query_tokens: queryTokens,
    };
  });

// ---------- Embedding backfill (admin-only) ----------

export const getEmbeddingStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const { count: total } = await supabaseAdmin
      .from("items")
      .select("id", { head: true, count: "exact" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { count: missing } = await (supabaseAdmin
      .from("items")
      .select("id", { head: true, count: "exact" }) as any)
      .is("embedding", null);
    return { total: total ?? 0, missing: missing ?? 0 };
  });

export const backfillEmbeddings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ batch_size: z.number().int().min(1).max(50).default(10) }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);

    // Fetch a batch of items missing embeddings
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: rows, error } = await (supabaseAdmin
      .from("items")
      .select("id, search_text") as any)
      .is("embedding", null)
      .order("created_at", { ascending: false })
      .limit(data.batch_size);
    if (error) throw new Error(error.message);

    const items = (rows ?? []) as Array<{ id: string; search_text: string | null }>;
    let processed = 0;
    const errors: string[] = [];

    for (const it of items) {
      const text = (it.search_text ?? "").trim();
      if (!text) {
        errors.push(`${it.id}: empty search_text`);
        continue;
      }
      try {
        const emb = await embedText(text);
        const { error: upErr } = await supabaseAdmin
          .from("items")
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .update({ embedding: emb as any } as any)
          .eq("id", it.id);
        if (upErr) {
          errors.push(`${it.id}: ${upErr.message}`);
        } else {
          processed++;
        }
      } catch (e) {
        errors.push(`${it.id}: ${e instanceof Error ? e.message : "embed failed"}`);
      }
    }

    return { processed, attempted: items.length, errors };
  });
