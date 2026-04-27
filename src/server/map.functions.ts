import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const STOPWORDS = new Set([
  "the","a","an","and","or","but","of","in","on","at","to","for","with","by","from",
  "is","are","was","were","be","been","being","it","this","that","these","those","as",
  "i","me","my","you","your","we","our","they","them","their","what","which","who",
  "all","any","both","each","few","more","most","other","some","such","no","not",
  "only","own","same","so","than","too","very","can","will","just","now","about",
]);

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

export type MapNode = {
  id: string;
  title: string | null;
  modality: string;
  x: number;
  y: number;
  cluster: number;
  degree: number;
};

export type MapEdge = { source: string; target: string; weight: number };

export const getSimilarityMap = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        scope: z.enum(["mine", "all"]).default("mine"),
        limit: z.number().int().min(10).max(500).default(200),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { data: roleRow } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle();
    const isAdmin = !!roleRow;

    let q = supabaseAdmin
      .from("items")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .select("id, modality, title, search_text, owner_id, embedding" as any)
      .order("created_at", { ascending: false })
      .limit(data.limit);

    if (data.scope === "mine" || !isAdmin) {
      q = q.eq("owner_id", userId);
    }

    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    type Row = {
      id: string;
      modality: string;
      title: string | null;
      search_text: string | null;
      owner_id: string | null;
      embedding: number[] | string | null;
    };
    const items = ((rows ?? []) as unknown) as Row[];
    if (items.length === 0) {
      return { nodes: [] as MapNode[], edges: [] as MapEdge[], mode: "empty" as const };
    }

    const embeddings: (number[] | null)[] = items.map((it) => {
      const e = it.embedding;
      if (!e) return null;
      if (Array.isArray(e)) return e as number[];
      if (typeof e === "string") {
        try {
          const parsed = JSON.parse(e);
          return Array.isArray(parsed) ? parsed : null;
        } catch {
          return null;
        }
      }
      return null;
    });
    const hasAnyEmbedding = embeddings.some((e) => e !== null);

    if (hasAnyEmbedding) {
      const norms = embeddings.map((v) => {
        if (!v) return 0;
        let s = 0;
        for (let k = 0; k < v.length; k++) s += v[k] * v[k];
        return Math.sqrt(s);
      });
      const cosine = (i: number, j: number) => {
        const a = embeddings[i], b = embeddings[j];
        if (!a || !b || norms[i] === 0 || norms[j] === 0) return 0;
        const len = Math.min(a.length, b.length);
        let dot = 0;
        for (let k = 0; k < len; k++) dot += a[k] * b[k];
        return dot / (norms[i] * norms[j]);
      };

      const edges: MapEdge[] = [];
      const degree = new Map<string, number>();
      for (let i = 0; i < items.length; i++) {
        for (let j = i + 1; j < items.length; j++) {
          const sim = cosine(i, j);
          if (sim > 0.55) {
            edges.push({ source: items[i].id, target: items[j].id, weight: sim });
            degree.set(items[i].id, (degree.get(items[i].id) ?? 0) + 1);
            degree.set(items[j].id, (degree.get(items[j].id) ?? 0) + 1);
          }
        }
      }
      edges.sort((a, b) => b.weight - a.weight);
      const cappedEdges = edges.slice(0, Math.min(edges.length, items.length * 4));

      // PCA via power iteration on embedding matrix
      const D = embeddings.find((v) => v)?.length ?? 0;
      const mean = new Array(D).fill(0);
      let counted = 0;
      for (const v of embeddings) {
        if (!v) continue;
        for (let k = 0; k < D; k++) mean[k] += v[k];
        counted++;
      }
      if (counted > 0) for (let k = 0; k < D; k++) mean[k] /= counted;

      const centered: (number[] | null)[] = embeddings.map((v) => {
        if (!v) return null;
        const c = new Array(D);
        for (let k = 0; k < D; k++) c[k] = v[k] - mean[k];
        return c;
      });

      const normalize = (x: number[]): number[] => {
        let s = 0;
        for (let k = 0; k < D; k++) s += x[k] * x[k];
        const n = Math.sqrt(s) || 1;
        for (let k = 0; k < D; k++) x[k] /= n;
        return x;
      };
      const powerIter = (excludeDir: number[] | null): number[] => {
        let u = new Array(D).fill(0).map((_, k) => Math.sin(k * 12.9898 + 78.233));
        u = normalize(u);
        for (let iter = 0; iter < 12; iter++) {
          const proj = centered.map((c) => {
            if (!c) return 0;
            let d = 0;
            for (let k = 0; k < D; k++) d += c[k] * u[k];
            return d;
          });
          const y = new Array(D).fill(0);
          for (let i = 0; i < centered.length; i++) {
            const c = centered[i];
            if (!c) continue;
            const p = proj[i];
            for (let k = 0; k < D; k++) y[k] += c[k] * p;
          }
          if (excludeDir) {
            let d = 0;
            for (let k = 0; k < D; k++) d += y[k] * excludeDir[k];
            for (let k = 0; k < D; k++) y[k] -= d * excludeDir[k];
          }
          u = normalize(y);
        }
        return u;
      };

      const pc1 = D > 0 ? powerIter(null) : [];
      const pc2 = D > 0 ? powerIter(pc1) : [];

      const raw = items.map((it, i) => {
        const c = centered[i];
        let xa = 0, yb = 0;
        if (c) {
          for (let k = 0; k < D; k++) {
            xa += c[k] * pc1[k];
            yb += c[k] * pc2[k];
          }
        } else {
          let h = 2166136261;
          for (let k = 0; k < it.id.length; k++) {
            h ^= it.id.charCodeAt(k);
            h = Math.imul(h, 16777619);
          }
          xa = (((h >>> 0) & 0xffff) / 0xffff) * 2 - 1;
          yb = (((h >>> 16) & 0xffff) / 0xffff) * 2 - 1;
        }
        return { id: it.id, modality: it.modality, title: it.title, xa, yb };
      });

      const xs = raw.map((r) => r.xa);
      const ys = raw.map((r) => r.yb);
      const minX = Math.min(...xs), maxX = Math.max(...xs);
      const minY = Math.min(...ys), maxY = Math.max(...ys);
      const sx = maxX - minX || 1;
      const sy = maxY - minY || 1;
      const modalityIdx: Record<string, number> = { text: 0, image: 1, audio: 2 };
      const nodes: MapNode[] = raw.map((r) => ({
        id: r.id,
        title: r.title,
        modality: r.modality,
        x: (r.xa - minX) / sx,
        y: (r.yb - minY) / sy,
        cluster: modalityIdx[r.modality] ?? 0,
        degree: degree.get(r.id) ?? 0,
      }));

      return { nodes, edges: cappedEdges, mode: "vector" as const };
    }

    // Fallback: token-overlap (when no embeddings yet)
    const tokenSets = items.map((it) => new Set(tokenize(it.search_text ?? "")));
    const df = new Map<string, number>();
    for (const set of tokenSets) for (const t of set) df.set(t, (df.get(t) ?? 0) + 1);
    const N = items.length;
    const idf = (t: string) => Math.log(1 + N / (1 + (df.get(t) ?? 0)));
    const edges: MapEdge[] = [];
    const degree = new Map<string, number>();
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = tokenSets[i], b = tokenSets[j];
        if (a.size === 0 || b.size === 0) continue;
        let inter = 0, union = 0;
        const seen = new Set<string>();
        for (const t of a) {
          seen.add(t);
          const w = idf(t);
          union += w;
          if (b.has(t)) inter += w;
        }
        for (const t of b) {
          if (seen.has(t)) continue;
          union += idf(t);
        }
        const sim = union > 0 ? inter / union : 0;
        if (sim > 0.08) {
          edges.push({ source: items[i].id, target: items[j].id, weight: sim });
          degree.set(items[i].id, (degree.get(items[i].id) ?? 0) + 1);
          degree.set(items[j].id, (degree.get(items[j].id) ?? 0) + 1);
        }
      }
    }
    edges.sort((a, b) => b.weight - a.weight);
    const cappedEdges = edges.slice(0, Math.min(edges.length, items.length * 4));
    const axisA = new Map<string, number>();
    const axisB = new Map<string, number>();
    const hash = (s: string) => {
      let h = 2166136261;
      for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      return h >>> 0;
    };
    for (const t of df.keys()) {
      const h = hash(t);
      axisA.set(t, ((h & 0xffff) / 0xffff) * 2 - 1);
      axisB.set(t, (((h >>> 16) & 0xffff) / 0xffff) * 2 - 1);
    }
    const raw = items.map((it, i) => {
      const set = tokenSets[i];
      let xa = 0, yb = 0, norm = 0;
      for (const t of set) {
        const w = idf(t);
        xa += (axisA.get(t) ?? 0) * w;
        yb += (axisB.get(t) ?? 0) * w;
        norm += w;
      }
      if (norm > 0) { xa /= norm; yb /= norm; }
      if (set.size === 0) {
        const h = hash(it.id);
        xa = ((h & 0xff) / 0xff) * 2 - 1;
        yb = (((h >>> 8) & 0xff) / 0xff) * 2 - 1;
      }
      return { id: it.id, modality: it.modality, title: it.title, xa, yb };
    });
    const xs = raw.map((r) => r.xa);
    const ys = raw.map((r) => r.yb);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const sx = maxX - minX || 1;
    const sy = maxY - minY || 1;
    const modalityIdx: Record<string, number> = { text: 0, image: 1, audio: 2 };
    const nodes: MapNode[] = raw.map((r) => ({
      id: r.id,
      title: r.title,
      modality: r.modality,
      x: (r.xa - minX) / sx,
      y: (r.yb - minY) / sy,
      cluster: modalityIdx[r.modality] ?? 0,
      degree: degree.get(r.id) ?? 0,
    }));
    return { nodes, edges: cappedEdges, mode: "lexical" as const };
  });
