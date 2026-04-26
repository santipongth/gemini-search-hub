import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { describeImage, transcribeAudio } from "./ai.server";
import {
  validateUploadedFile,
  makeAudioDurationFailure,
  MAX_AUDIO_SECONDS,
  type ValidationErrorPayload,
  type ValidationFailure,
} from "@/lib/file-validation";
import { parseAudioDurationSeconds } from "./audio-duration.server";

const Modality = z.enum(["text", "image", "audio"]);

// Throw a plain Error whose .message is JSON so TanStack serializes it cleanly
// across the RPC boundary. Client parses it back into ValidationErrorPayload.
function throwValidationError(failures: ValidationFailure[]): never {
  const payload: ValidationErrorPayload = {
    code: "FILE_VALIDATION_FAILED",
    failures,
  };
  throw new Error(JSON.stringify(payload));
}

// Decode a data URL into bytes, returning [bytes, base64Body] or null on a
// malformed URL (validateUploadedFile already returns a structured failure
// in that case, so we treat null here as "skip the deeper checks").
function decodeDataUrl(dataUrl: string): Uint8Array | null {
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) return null;
  try {
    return Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

// Centralized server-side validation for image/audio uploads. Runs the
// shared rules, then — for audio — decodes the file bytes and verifies the
// duration against MAX_AUDIO_SECONDS. Returns the decoded bytes on success
// so callers can reuse them for storage upload, avoiding a second decode.
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

  // Authoritative server-side audio duration check (when we can parse it).
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
    // Validation passed but we couldn't decode — should never happen, but
    // surface it as a structured failure rather than crashing.
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
  // for text
  text_content: z.string().max(8000).optional(),
  // for image/audio
  data_url: z.string().optional(),
  mime_type: z.string().max(100).optional(),
  filename: z.string().max(200).optional(),
  // Optional client-measured audio duration (seconds). Server still
  // re-derives from file bytes when possible.
  audio_duration_seconds: z.number().min(0).max(60 * 60).optional(),
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
      // Structured server-side validation — collect ALL rule failures
      // (mime, size, audio duration) and tag each with the filename so
      // the UI can show which upload attempt failed.
      const { bytes } = runServerFileValidation({
        data_url: data.data_url,
        mime_type: data.mime_type,
        kind: data.modality,
        filename: data.filename,
        duration_hint: data.audio_duration_seconds,
      });

      const ext = (data.filename?.split(".").pop() || "bin").toLowerCase();
      const path = `${data.modality}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabaseAdmin.storage
        .from("library")
        .upload(path, bytes, { contentType: data.mime_type!, upsert: false });
      if (upErr) throw new Error(`Upload failed: ${upErr.message}`);
      storage_path = path;

      // Generate text representation for embedding
      const aiText =
        data.modality === "image"
          ? await describeImage(data.data_url!)
          : await transcribeAudio(data.data_url!, data.mime_type!);
      text_content = aiText;
      embeddingSource = [data.title, data.description, aiText].filter(Boolean).join("\n");
    }

    const { data: row, error } = await supabaseAdmin
      .from("items")
      .insert({
        modality: data.modality,
        title: data.title ?? null,
        description: data.description ?? null,
        text_content,
        storage_path,
        mime_type: data.mime_type ?? null,
        search_text: embeddingSource,
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
    } else {
      const kind = data.query_type; // "image" | "audio"
      const failures = validateUploadedFile({
        data_url: data.data_url,
        mime_type: data.mime_type,
        kind,
      });
      if (failures.length > 0) throwValidationError(failures);
      queryText =
        kind === "image"
          ? await describeImage(data.data_url!)
          : await transcribeAudio(data.data_url!, data.mime_type!);
    }

    const { data: rows, error } = await supabaseAdmin.rpc("match_items", {
      query_text: queryText,
      match_count: data.limit,
      modality_filter: data.modality_filter === "all" ? undefined : data.modality_filter,
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
      .select("id, search_text")
      .eq("id", data.id)
      .single();
    if (error || !item) throw new Error("Item not found");

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
    // Bucket is private; issue a short-lived signed URL.
    const { data: signed, error } = await supabaseAdmin
      .storage
      .from("library")
      .createSignedUrl(data.path, 60 * 60); // 1 hour
    if (error || !signed) throw new Error(error?.message ?? "Failed to sign URL");
    return { url: signed.signedUrl };
  });
