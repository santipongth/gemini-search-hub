import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { searchItems } from "@/server/items.functions";
import { ItemCard, type ItemSummary } from "@/components/item-card";
import { FileDropZone, AudioRecorder, type FilePayload } from "@/components/media-input";
import { Search, Sparkles, Loader2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Lumen — Multimodal Search" },
      { name: "description", content: "Search a shared library across text, images, and audio using Gemini embeddings." },
    ],
  }),
  component: SearchPage,
});

function SearchPage() {
  const [tab, setTab] = useState("text");
  const [text, setText] = useState("");
  const [file, setFile] = useState<FilePayload | null>(null);
  const [results, setResults] = useState<ItemSummary[]>([]);
  const [interpreted, setInterpreted] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  const onSearch = async () => {
    setBusy(true);
    setInterpreted(null);
    try {
      const payload: {
        query_type: "text" | "image" | "audio";
        modality_filter: "all";
        min_similarity: number;
        limit: number;
        text?: string;
        data_url?: string;
        mime_type?: string;
      } = {
        query_type: tab as "text" | "image" | "audio",
        modality_filter: "all",
        min_similarity: 0,
        limit: 24,
      };
      if (tab === "text") {
        if (!text.trim()) { toast.error("Type a query"); setBusy(false); return; }
        payload.text = text;
      } else {
        if (!file) { toast.error("Add a file"); setBusy(false); return; }
        payload.data_url = file.data_url;
        payload.mime_type = file.mime_type;
      }
      const res = await searchItems({ data: payload });
      setResults(res.results as ItemSummary[]);
      setInterpreted(res.interpreted_query);
      setHasSearched(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Search failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="container mx-auto px-6 py-12 max-w-5xl">
      <div className="text-center space-y-3 mb-10">
        <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground">
          <Sparkles className="h-3 w-3" /> Powered by Gemini embeddings
        </div>
        <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight">
          Search across <span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">text, images & audio</span>
        </h1>
        <p className="text-muted-foreground max-w-xl mx-auto">
          Type a question, drop an image, or record audio. Lumen finds semantically similar items across every modality.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-card shadow-sm p-4 sm:p-6 space-y-4">
        <Tabs value={tab} onValueChange={(v) => { setTab(v); setFile(null); }}>
          <TabsList className="grid grid-cols-3 w-full max-w-sm">
            <TabsTrigger value="text">Text</TabsTrigger>
            <TabsTrigger value="image">Image</TabsTrigger>
            <TabsTrigger value="audio">Audio</TabsTrigger>
          </TabsList>

          <TabsContent value="text" className="mt-4">
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="e.g., a peaceful sunset over mountains, or rainy day jazz..."
              rows={3}
              className="resize-none text-base"
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onSearch(); }}
            />
          </TabsContent>
          <TabsContent value="image" className="mt-4">
            <FileDropZone accept="image/*" kind="image" hint="JPG, PNG, WEBP, or GIF · max 8 MB" value={file} onFile={setFile} onClear={() => setFile(null)} />
          </TabsContent>
          <TabsContent value="audio" className="mt-4 space-y-3">
            <FileDropZone accept="audio/*" kind="audio" hint="MP3, WAV, M4A, OGG, or WEBM · max 15 MB · 2 min" value={file} onFile={setFile} onClear={() => setFile(null)} />
            {!file && <AudioRecorder onFile={setFile} />}
          </TabsContent>
        </Tabs>

        <div className="flex justify-end">
          <Button onClick={onSearch} disabled={busy} size="lg" className="gap-2">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            Search
          </Button>
        </div>
      </div>

      {interpreted && tab !== "text" && (
        <div className="mt-6 rounded-lg bg-muted/50 border border-border p-3 text-sm">
          <span className="font-medium">Interpreted as:</span>{" "}
          <span className="text-muted-foreground">{interpreted}</span>
        </div>
      )}

      <div className="mt-8">
        {busy ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="rounded-xl border border-border bg-card overflow-hidden animate-pulse">
                <div className="aspect-[4/3] bg-muted" />
                <div className="p-3 space-y-2">
                  <div className="h-3 bg-muted rounded w-1/3" />
                  <div className="h-4 bg-muted rounded w-2/3" />
                </div>
              </div>
            ))}
          </div>
        ) : hasSearched && results.length === 0 ? (
          <div className="text-center text-muted-foreground py-16">
            No matches. Try broadening your query.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {results.map((r) => <ItemCard key={r.id} item={r} />)}
          </div>
        )}
      </div>
    </div>
  );
}
