import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const TagName = z
  .string()
  .min(1)
  .max(40)
  .regex(/^[\p{L}\p{N} _-]+$/u, "Tag may contain letters, numbers, spaces, _ and -");

// List all tags belonging to the current user (or all if admin).
export const listTags = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ scope: z.enum(["mine", "all"]).default("mine") }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;
    let q = supabaseAdmin
      .from("tags")
      .select("id, name, owner_id, created_at")
      .order("name", { ascending: true });

    if (data.scope === "mine") q = q.eq("owner_id", userId);

    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return { tags: rows ?? [] };
  });

// Get tags for a single item (anyone can read if item is visible).
export const getItemTags = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ item_id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data }) => {
    const { data: rows, error } = await supabaseAdmin
      .from("item_tags")
      .select("tag_id, tags(id, name)")
      .eq("item_id", data.item_id);
    if (error) throw new Error(error.message);
    const tags = (rows ?? [])
      .map((r) => (r.tags as unknown) as { id: string; name: string } | null)
      .filter((t): t is { id: string; name: string } => !!t);
    return { tags };
  });

// Create or fetch a tag by name for the current user.
async function ensureTag(userId: string, name: string): Promise<string> {
  const trimmed = name.trim();
  const { data: existing } = await supabaseAdmin
    .from("tags")
    .select("id")
    .eq("owner_id", userId)
    .eq("name", trimmed)
    .maybeSingle();
  if (existing) return existing.id;
  const { data: row, error } = await supabaseAdmin
    .from("tags")
    .insert({ name: trimmed, owner_id: userId })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return row.id;
}

// Replace the full tag set for a single item.
export const setItemTags = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        item_id: z.string().uuid(),
        tag_names: z.array(TagName).max(20),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;

    // Verify caller owns the item or is admin.
    const { data: itemRow } = await supabaseAdmin
      .from("items")
      .select("owner_id")
      .eq("id", data.item_id)
      .maybeSingle();
    if (!itemRow) throw new Error("Item not found");
    if (itemRow.owner_id !== userId) {
      const { data: roleRow } = await supabaseAdmin
        .from("user_roles")
        .select("role")
        .eq("user_id", userId)
        .eq("role", "admin")
        .maybeSingle();
      if (!roleRow) throw new Error("Not authorized");
    }

    // Resolve tag IDs (creating tags as needed under caller's account).
    const tagIds: string[] = [];
    for (const name of data.tag_names) {
      const id = await ensureTag(userId, name);
      tagIds.push(id);
    }

    // Wipe & re-insert join rows for this item.
    await supabaseAdmin.from("item_tags").delete().eq("item_id", data.item_id);
    if (tagIds.length > 0) {
      const { error } = await supabaseAdmin.from("item_tags").insert(
        tagIds.map((tag_id) => ({ item_id: data.item_id, tag_id })),
      );
      if (error) throw new Error(error.message);
    }

    return { count: tagIds.length };
  });
