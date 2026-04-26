import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { embedText, describeImage } from "@/server/ai.server";

const TEXTS: Array<{ title: string; description?: string; content: string }> = [
  { title: "Mountain solitude", description: "A short reflection", content: "There is a stillness on a mountain ridge at dawn that no city ever offers — the air thin, the light pale gold, the only sound your own breathing folding into the silence." },
  { title: "Rainy afternoon jazz", content: "Saxophone leaks from a corner café while the street outside turns to mirrors. Somebody laughs. The rain keeps perfect tempo with the bass." },
  { title: "Recipe — lemon risotto", content: "Toast arborio rice in butter, deglaze with white wine, ladle warm stock until creamy. Finish with parmesan, lemon zest, and a generous crack of black pepper." },
  { title: "On focus", content: "Attention is a finite, renewable resource. Spend it on things that pay you back in clarity, not anxiety." },
  { title: "Ocean waves at night", content: "Phosphorescence under each breaker. The sand glows briefly where the foam dissolves, then forgets." },
  { title: "Quiet code review", content: "The pull request reads like a poem: each commit a stanza, the diff a quiet argument for a smaller, cleaner abstraction." },
  { title: "Forest after rain", content: "Petrichor, moss bright as paint, every leaf doubled in the puddles below. The forest exhales slowly all afternoon." },
  { title: "Late-night bus ride", content: "Yellow lights skating across the window. The driver hums something old. A teenager dreams against a backpack." },
  { title: "Productive afternoon", description: "A small win", content: "Closed three browser tabs, finished one chapter, watered the plants. Sometimes a productive day is just compounding small acts of care." },
  { title: "Italian summer", content: "Cicadas at noon, marble cool underfoot, a slice of cold watermelon eaten on a balcony above terracotta rooftops." },
];

const IMAGES: Array<{ title: string; description: string; url: string }> = [
  { title: "Misty mountain dawn", description: "Layers of mountains in soft morning light", url: "https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=1024&q=80" },
  { title: "Forest path", description: "Sunlight filtering through tall trees", url: "https://images.unsplash.com/photo-1448375240586-882707db888b?w=1024&q=80" },
  { title: "Ocean waves", description: "Turquoise waves curling on a sandy beach", url: "https://images.unsplash.com/photo-1505142468610-359e7d316be0?w=1024&q=80" },
  { title: "City at night", description: "Neon-lit street with rain reflections", url: "https://images.unsplash.com/photo-1480714378408-67cf0d13bc1b?w=1024&q=80" },
  { title: "Cup of coffee", description: "Latte art on a wooden table", url: "https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=1024&q=80" },
];

async function urlToDataUrl(url: string): Promise<{ dataUrl: string; mime: string; bytes: Uint8Array }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}`);
  const mime = res.headers.get("content-type") ?? "image/jpeg";
  const buf = new Uint8Array(await res.arrayBuffer());
  let binary = "";
  for (let i = 0; i < buf.length; i++) binary += String.fromCharCode(buf[i]);
  const b64 = btoa(binary);
  return { dataUrl: `data:${mime};base64,${b64}`, mime, bytes: buf };
}

export const Route = createFileRoute("/api/seed")({
  server: {
    handlers: {
      POST: async () => {
        const log: string[] = [];

        // Skip if already seeded
        const { count } = await supabaseAdmin.from("items").select("*", { count: "exact", head: true });
        if ((count ?? 0) > 0) {
          return Response.json({ skipped: true, existing: count });
        }

        // Text items
        for (const t of TEXTS) {
          try {
            const source = [t.title, t.description, t.content].filter(Boolean).join("\n");
            const emb = await embedText(source);
            await supabaseAdmin.from("items").insert({
              modality: "text",
              title: t.title,
              description: t.description ?? null,
              text_content: t.content,
              embedding: emb as unknown as string,
            });
            log.push(`text: ${t.title}`);
          } catch (e) {
            log.push(`text FAIL: ${t.title} — ${e instanceof Error ? e.message : "err"}`);
          }
        }

        // Image items
        for (const img of IMAGES) {
          try {
            const { dataUrl, mime, bytes } = await urlToDataUrl(img.url);
            const path = `image/${crypto.randomUUID()}.jpg`;
            const { error: upErr } = await supabaseAdmin.storage.from("library").upload(path, bytes, { contentType: mime });
            if (upErr) throw upErr;
            const aiText = await describeImage(dataUrl);
            const emb = await embedText([img.title, img.description, aiText].join("\n"));
            await supabaseAdmin.from("items").insert({
              modality: "image",
              title: img.title,
              description: img.description,
              text_content: aiText,
              storage_path: path,
              mime_type: mime,
              embedding: emb as unknown as string,
            });
            log.push(`image: ${img.title}`);
          } catch (e) {
            log.push(`image FAIL: ${img.title} — ${e instanceof Error ? e.message : "err"}`);
          }
        }

        return Response.json({ ok: true, log });
      },
    },
  },
});
