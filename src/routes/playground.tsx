import { createFileRoute, Link } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { searchItems } from "@/server/items.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Loader2, Search as SearchIcon, ImageIcon, AudioLines, ArrowLeft, Upload, Gauge, Sparkles } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/playground")({
  head: () => ({
    meta: [
      { title: "Vector Search Playground — Lumen" },
      { name: "description", content: "Test multimodal vector search with real text, image, or audio queries." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PlaygroundPage,
});

type SearchResult = {
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

type RunOutcome = {
  results: SearchResult[];
  interpreted_query: string;
  used_vector: boolean;
  latency_ms: number;
  top_similarity: number | null;
  query_type: "text" | "image" | "audio";
  query_label: string;
};

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

function similarityColor(s: number) {
  if (s >= 0.8) return "bg-emerald-500";
  if (s >= 0.6) return "bg-lime-500";
  if (s >= 0.4) return "bg-amber-500";
  return "bg-rose-500";
}

function rationale(s: number, usedVector: boolean) {
  if (!usedVector) return "Lexical/trigram fallback (vector pipeline unavailable).";
  if (s >= 0.85) return "Near-identical semantic vector (cosine ≥ 0.85).";
  if (s >= 0.7) return "Strongly aligned in embedding space.";
  if (s >= 0.5) return "Topically related — overlapping concepts.";
  if (s >= 0.3) return "Loosely related; weaker semantic overlap.";
  return "Marginal match — vectors are far apart.";
}

function PlaygroundPage() {
  const [tab, setTab] = useState<"text" | "image" | "audio">("text");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<RunOutcome | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const reset = () => {
    setFile(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const onRun = async () => {
    setBusy(true);
    setOutcome(null);
    try {
      let res;
      let label = "";
      if (tab === "text") {
        if (!text.trim()) {
          toast.error("Enter a text query");
          setBusy(false);
          return;
        }
        label = text.trim();
        res = await searchItems({
          data: { query_type: "text", text: text.trim(), modality_filter: "all", min_similarity: 0, limit: 20 },
        });
      } else {
        if (!file) {
          toast.error("Select a file");
          setBusy(false);
          return;
        }
        label = file.name;
        const dataUrl = await fileToDataUrl(file);
        res = await searchItems({
          data: {
            query_type: tab,
            data_url: dataUrl,
            mime_type: file.type,
            filename: file.name,
            modality_filter: "all",
            min_similarity: 0,
            limit: 20,
          },
        });
      }
      setOutcome({
        results: res.results as SearchResult[],
        interpreted_query: res.interpreted_query,
        used_vector: res.used_vector,
        latency_ms: res.latency_ms,
        top_similarity: res.top_similarity ?? null,
        query_type: tab,
        query_label: label,
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Search failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="container mx-auto px-6 py-8 max-w-5xl">
      <Link to="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
        <ArrowLeft className="h-4 w-4" /> Back
      </Link>

      <div className="mb-6">
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" /> Vector Search Playground
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Real Gemini embeddings → pgvector cosine ANN. Upload text, image, or audio and see ranked
          results with similarity scores and reasoning.
        </p>
      </div>

      <div className="rounded-xl border border-border p-5 bg-card">
        <Tabs value={tab} onValueChange={(v) => { setTab(v as "text" | "image" | "audio"); reset(); }}>
          <TabsList>
            <TabsTrigger value="text" className="gap-1.5"><SearchIcon className="h-4 w-4" /> Text</TabsTrigger>
            <TabsTrigger value="image" className="gap-1.5"><ImageIcon className="h-4 w-4" /> Image</TabsTrigger>
            <TabsTrigger value="audio" className="gap-1.5"><AudioLines className="h-4 w-4" /> Audio</TabsTrigger>
          </TabsList>
          <TabsContent value="text" className="mt-4">
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Type a natural-language query… e.g. 'sunset over the ocean with warm tones'"
              rows={3}
            />
          </TabsContent>
          <TabsContent value="image" className="mt-4">
            <Input
              ref={fileRef}
              type="file"
              accept="image/*"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <p className="text-xs text-muted-foreground mt-1.5">
              Image is described by Gemini multimodal, then embedded into the shared text vector space.
            </p>
          </TabsContent>
          <TabsContent value="audio" className="mt-4">
            <Input
              ref={fileRef}
              type="file"
              accept="audio/*"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <p className="text-xs text-muted-foreground mt-1.5">
              Audio is transcribed/summarized by Gemini, then embedded.
            </p>
          </TabsContent>
        </Tabs>

        <div className="mt-4 flex justify-end">
          <Button onClick={onRun} disabled={busy} className="gap-2">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Run search
          </Button>
        </div>
      </div>

      {outcome && (
        <div className="mt-6">
          <div className="rounded-xl border border-border p-4 bg-muted/30 mb-4">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
              <span className="inline-flex items-center gap-1.5 font-medium">
                <Gauge className="h-4 w-4 text-primary" /> {outcome.latency_ms} ms
              </span>
              <span>
                Pipeline:&nbsp;
                <span className={outcome.used_vector ? "text-emerald-600 font-medium" : "text-amber-600 font-medium"}>
                  {outcome.used_vector ? "vector (Gemini + pgvector cosine ANN)" : "lexical fallback"}
                </span>
              </span>
              <span>
                Results: <span className="font-medium">{outcome.results.length}</span>
              </span>
              {outcome.top_similarity !== null && (
                <span>
                  Top similarity: <span className="font-medium">{outcome.top_similarity.toFixed(3)}</span>
                </span>
              )}
            </div>
            <div className="mt-2 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Interpreted query:</span>{" "}
              {outcome.interpreted_query.slice(0, 240)}
              {outcome.interpreted_query.length > 240 ? "…" : ""}
            </div>
          </div>

          {outcome.results.length === 0 ? (
            <div className="text-center py-12 border border-dashed border-border rounded-xl text-sm text-muted-foreground">
              No matches found.
            </div>
          ) : (
            <ol className="space-y-3">
              {outcome.results.map((r, i) => (
                <li key={r.id} className="rounded-xl border border-border p-4 bg-card">
                  <div className="flex items-start gap-4">
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-muted flex items-center justify-center text-sm font-medium">
                      {i + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Link
                          to="/item/$id"
                          params={{ id: r.id }}
                          className="font-medium hover:underline truncate"
                        >
                          {r.title ?? `Untitled (${r.modality})`}
                        </Link>
                        <span className="text-[10px] uppercase tracking-wide rounded bg-muted px-1.5 py-0.5">
                          {r.modality}
                        </span>
                      </div>
                      {r.description && (
                        <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{r.description}</p>
                      )}

                      <div className="mt-3 flex items-center gap-3">
                        <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                          <div
                            className={`h-full ${similarityColor(r.similarity)}`}
                            style={{ width: `${Math.max(2, Math.min(100, r.similarity * 100))}%` }}
                          />
                        </div>
                        <span className="text-sm font-mono w-16 text-right">{r.similarity.toFixed(3)}</span>
                      </div>
                      <p className="mt-1.5 text-xs text-muted-foreground">
                        {rationale(r.similarity, outcome.used_vector)}
                      </p>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
