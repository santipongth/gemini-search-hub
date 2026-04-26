import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { embedText, describeImage, transcribeAudio } from "./ai.server";

const Modality = z.enum(["text", "image", "audio"]);

// ---------- Add an item ----------

const AddInput = z.object({
  modality: Modality,
  title: z.string().max(200).optional(),
  description: z.string().max(1000).optional(),
  // for text
  text_content: z.string().max(8000).optional(),
  // for image/audio
  data_url: z.string().optional(), // base64 data URL of the file
  mime_type: z.string().max(100).optional(),
  filename: z.string().max(200).optional(),
});

export const addItem = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => AddInput.parse(input))
  .handler(async ({ data }) => {
    let embeddingSource = "";
    let storage_path: string | null = null;
    let text_content: string | null = null;

    if (data.modality === "text") {
      if (!data.text_content?.trim()) throw new Error("Text content is required");
      text_content = data.text_content.trim();
      embeddingSource = [data.title, data.description, text_content]
        .filter(Boolean)
        .join("\n");
    } else {
      if (!data.data_url || !data.mime_type) {
        throw new Error("File data is required for image/audio");
      }
      // Decode data URL → upload to storage
      const match = data.data_url.match(/^data:([^;]+);base64,(.+)$/);
      if (!match) throw new Error("Invalid data URL");
      const bytes = Uint8Array.from(atob(match[2]), (c) => c.charCodeAt(0));
      const ext = (data.filename?.split(".").pop() || "bin").toLowerCase();
      const path = `${data.modality}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabaseAdmin.storage
        .from("library")
        .upload(path, bytes, { contentType: data.mime_type, upsert: false });
      if (upErr) throw new Error(`Upload failed: ${upErr.message}`);
      storage_path = path;

      // Generate text representation for embedding
      const aiText =
        data.modality === "image"
          ? await describeImage(data.data_url)
          : await transcribeAudio(data.data_url, data.mime_type);
      text_content = aiText;
      embeddingSource = [data.title, data.description, aiText].filter(Boolean).join("\n");
    }

    const embedding = await embedText(embeddingSource);

    const { data: row, error } = await supabaseAdmin
      .from("items")
      .insert({
        modality: data.modality,
        title: data.title ?? null,
        description: data.description ?? null,
        text_content,
        storage_path,
        mime_type: data.mime_type ?? null,
        embedding: embedding as unknown as string,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    return { id: row.id };
  });

// ---------- Search ----------

const SearchInput = z.object({
  query_type: Modality,
  text: z.string().max(2000).optional(),
  data_url: z.string().optional(),
  mime_type: z.string().max(100).optional(),
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
    } else if (data.query_type === "image") {
      if (!data.data_url) throw new Error("Image required");
      queryText = await describeImage(data.data_url);
    } else {
      if (!data.data_url || !data.mime_type) throw new Error("Audio required");
      queryText = await transcribeAudio(data.data_url, data.mime_type);
    }

    const embedding = await embedText(queryText);

    const { data: rows, error } = await supabaseAdmin.rpc("match_items", {
      query_embedding: embedding as unknown as string,
      match_count: data.limit,
      modality_filter: data.modality_filter === "all" ? null : data.modality_filter,
      min_similarity: data.min_similarity,
    });
    if (error) throw new Error(error.message);

    return { results: rows ?? [], interpreted_query: queryText };
  });

// ---------- Find similar by item id ----------

export const findSimilar = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid(), limit: z.number().int().min(1).max(50).default(10) }).parse(input))
  .handler(async ({ data }) => {
    const { data: item, error } = await supabaseAdmin
      .from("items")
      .select("id, embedding")
      .eq("id", data.id)
      .single();
    if (error || !item) throw new Error("Item not found");

    const { data: rows, error: e2 } = await supabaseAdmin.rpc("match_items", {
      query_embedding: item.embedding as unknown as string,
      match_count: data.limit + 1,
      modality_filter: null,
      min_similarity: 0,
    });
    if (e2) throw new Error(e2.message);
    return { results: (rows ?? []).filter((r: { id: string }) => r.id !== data.id).slice(0, data.limit) };
  });

// ---------- List & delete ----------

export const listItems = createServerFn({ method: "GET" })
  .handler(async () => {
    const { data, error } = await supabaseAdmin
      .from("items")
      .select("id, modality, title, description, text_content, storage_path, mime_type, created_at")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return { items: data ?? [] };
  });

export const getItem = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { data: row, error } = await supabaseAdmin
      .from("items")
      .select("id, modality, title, description, text_content, storage_path, mime_type, created_at")
      .eq("id", data.id)
      .single();
    if (error || !row) throw new Error("Item not found");
    return { item: row };
  });

export const deleteItem = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
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

// ---------- Public file URL helper (server) ----------

export const getPublicUrl = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => z.object({ path: z.string() }).parse(input))
  .handler(async ({ data }) => {
    const { data: u } = supabaseAdmin.storage.from("library").getPublicUrl(data.path);
    return { url: u.publicUrl };
  });
