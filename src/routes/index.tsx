import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { searchItems } from "@/server/items.functions";
import { logSearch } from "@/server/analytics.functions";
import { ItemCard, type ItemSummary } from "@/components/item-card";
import {
  FileDropZone,
  AudioRecorder,
  type FilePayload,
  ALLOWED_IMAGE_MIME,
  ALLOWED_AUDIO_MIME,
  MAX_IMAGE_BYTES,
  MAX_AUDIO_BYTES,
} from "@/components/media-input";
import {
  isValidationErrorPayload,
  type ValidationFailure,
  type ValidationErrorPayload,
} from "@/lib/file-validation";
import { Search, Sparkles, Loader2, CheckCircle2, AlertCircle, ArrowDownWideNarrow, X, FileText, ImageIcon, AudioLines, Upload } from "lucide-react";
import { toast } from "sonner";
import { extractTerms } from "@/lib/highlight";
import { InlineRuleFailures } from "@/components/inline-rule-failures";
import { MultimodalEmptyState } from "@/components/multimodal-empty-state";

// Try to parse a server function error into structured validation failures.
function parseServerError(err: unknown): ValidationErrorPayload | null {
  if (!(err instanceof Error)) return null;
  try {
    const parsed: unknown = JSON.parse(err.message);
    return isValidationErrorPayload(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

const RULE_LABELS: Record<ValidationFailure["rule"], string> = {
  mime_type: "File type",
  file_size: "File size",
  audio_duration: "Audio duration",
  data_url_format: "File encoding",
  missing_data: "Missing data",
};

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Lumen — Multimodal Search" },
      { name: "description", content: "Search a shared library across text, images, and audio using Gemini embeddings." },
    ],
  }),
  component: SearchPage,
});

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

// Approximate decoded byte length from a data URL (base64 = 4/3 of bytes).
function dataUrlByteLength(dataUrl: string): number {
  const i = dataUrl.indexOf(",");
  if (i < 0) return 0;
  const b64 = dataUrl.slice(i + 1);
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - padding;
}

type Validation = {
  ok: boolean;
  size: number;
  maxSize: number;
  mimeOk: boolean;
  sizeOk: boolean;
  allowed: readonly string[];
};

function validate(file: FilePayload | null, kind: "image" | "audio"): Validation | null {
  if (!file) return null;
  const allowed = kind === "image" ? ALLOWED_IMAGE_MIME : ALLOWED_AUDIO_MIME;
  const maxSize = kind === "image" ? MAX_IMAGE_BYTES : MAX_AUDIO_BYTES;
  const size = dataUrlByteLength(file.data_url);
  const mimeOk = (allowed as readonly string[]).includes(file.mime_type);
  const sizeOk = size <= maxSize;
  return { ok: mimeOk && sizeOk, size, maxSize, mimeOk, sizeOk, allowed };
}

function SearchPage() {
  const [tab, setTab] = useState("text");
  const [text, setText] = useState("");
  const [file, setFile] = useState<FilePayload | null>(null);
  const [results, setResults] = useState<ItemSummary[]>([]);
  const [interpreted, setInterpreted] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [serverFailures, setServerFailures] = useState<ValidationFailure[] | null>(null);
  const [sortBy, setSortBy] = useState<"similarity" | "newest" | "oldest" | "title">("similarity");
  // Track the in-flight request so the user can cancel and immediately
  // re-enable inputs. The server still runs to completion, but the client
  // discards the response.
  const requestIdRef = useRef(0);

  const fileKind = tab === "image" ? "image" : tab === "audio" ? "audio" : null;
  const validation = useMemo(
    () => (fileKind ? validate(file, fileKind) : null),
    [file, fileKind],
  );

  const canSearch = (() => {
    if (busy) return false;
    if (tab === "text") return text.trim().length > 0;
    if (!file || !validation) return false;
    return validation.ok;
  })();

  // Auto-reset server failures whenever the inputs change so the user can
  // immediately retry without refreshing. Tracks file identity (data_url),
  // text query, and the active tab.
  useEffect(() => {
    setServerFailures(null);
  }, [file?.data_url, text, tab]);

  const onSearch = async () => {
    if (!canSearch) return;
    const myId = ++requestIdRef.current;
    setBusy(true);
    setInterpreted(null);
    setServerFailures(null);
    try {
      const payload: {
        query_type: "text" | "image" | "audio";
        modality_filter: "all";
        min_similarity: number;
        limit: number;
        text?: string;
        data_url?: string;
        mime_type?: string;
        filename?: string;
        audio_duration_seconds?: number;
      } = {
        query_type: tab as "text" | "image" | "audio",
        modality_filter: "all",
        min_similarity: 0,
        limit: 24,
      };
      if (tab === "text") {
        payload.text = text;
      } else {
        payload.data_url = file!.data_url;
        payload.mime_type = file!.mime_type;
        payload.filename = file!.filename;
        if (typeof file!.duration_seconds === "number") {
          payload.audio_duration_seconds = file!.duration_seconds;
        }
      }
      const res = await searchItems({ data: payload });
      // Stale-response guard: ignore if the user cancelled or started a new search.
      if (myId !== requestIdRef.current) return;
      setResults(res.results as ItemSummary[]);
      setInterpreted(res.interpreted_query);
      setHasSearched(true);

      // Fire-and-forget analytics log.
      logSearch({
        data: {
          query_text: tab === "text" ? text : res.interpreted_query,
          query_type: tab as "text" | "image" | "audio",
          modality_filter: "all",
          result_count: res.results.length,
        },
      }).catch(() => {});
    } catch (e) {
      if (myId !== requestIdRef.current) return;
      const structured = parseServerError(e);
      if (structured) {
        setServerFailures(structured.failures);
        toast.error("File rejected by server — see details below");
      } else {
        toast.error(e instanceof Error ? e.message : "Search failed");
      }
    } finally {
      if (myId === requestIdRef.current) setBusy(false);
    }
  };

  const onCancel = () => {
    // Bump the request id so any in-flight response is discarded, and
    // re-enable inputs immediately.
    requestIdRef.current++;
    setBusy(false);
    toast.message("Search cancelled");
  };

  return (
    <div className="relative">
      {/* Decorative mesh gradient backdrop */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[520px] bg-gradient-mesh opacity-70 [mask-image:linear-gradient(to_bottom,black,transparent)]"
      />

      <div className="container relative mx-auto px-6 pt-16 pb-16 max-w-5xl">
        <div className="text-center space-y-5 mb-12">
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card/70 backdrop-blur px-3 py-1 text-xs text-muted-foreground">
            <Sparkles className="h-3 w-3 text-primary" /> Powered by Gemini embeddings
          </div>
          <h1 className="font-display text-5xl sm:text-6xl font-semibold leading-[1.05] tracking-tight">
            Search anything,
            <br />
            <span className="text-gradient-primary">in any language of media.</span>
          </h1>
          <p className="text-muted-foreground text-lg max-w-2xl mx-auto leading-relaxed">
            Type a question, drop an image, or record audio. Lumen finds semantically similar items across every modality.
          </p>
        </div>

      <div className="rounded-3xl border border-border/60 bg-card/80 backdrop-blur shadow-elegant p-4 sm:p-6 space-y-5">
        <Tabs value={tab} onValueChange={(v) => { if (busy) return; setTab(v); setFile(null); }}>
          <TabsList className="grid grid-cols-3 w-full max-w-sm mx-auto">
            <TabsTrigger value="text" disabled={busy}>Text</TabsTrigger>
            <TabsTrigger value="image" disabled={busy}>Image</TabsTrigger>
            <TabsTrigger value="audio" disabled={busy}>Audio</TabsTrigger>
          </TabsList>

          {/* Inline failures attached to the type picker (mime mismatch). */}
          <InlineRuleFailures
            failures={serverFailures}
            rules={["mime_type"]}
            className="max-w-sm mx-auto"
          />

          <TabsContent value="text" className="mt-4">
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={busy ? "Searching..." : "e.g., a peaceful sunset over mountains, or rainy day jazz..."}
              rows={3}
              disabled={busy}
              aria-busy={busy}
              className="resize-none text-base disabled:opacity-60 disabled:cursor-not-allowed"
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onSearch(); }}
            />
          </TabsContent>
          <TabsContent value="image" className="mt-4">
            <FileDropZone accept="image/*" kind="image" hint="JPG, PNG, WEBP, or GIF · max 8 MB" value={file} onFile={setFile} onClear={() => setFile(null)} />
            {/* File-size failures rendered next to the image dropzone. */}
            <InlineRuleFailures
              failures={serverFailures}
              rules={["file_size", "data_url_format", "missing_data"]}
            />
          </TabsContent>
          <TabsContent value="audio" className="mt-4 space-y-3">
            <FileDropZone accept="audio/*" kind="audio" hint="MP3, WAV, M4A, OGG, or WEBM · max 15 MB · 2 min" value={file} onFile={setFile} onClear={() => setFile(null)} />
            {/* Size + duration failures rendered next to the audio inputs. */}
            <InlineRuleFailures
              failures={serverFailures}
              rules={["file_size", "audio_duration", "data_url_format", "missing_data"]}
            />
            {!file && <AudioRecorder onFile={setFile} />}
          </TabsContent>
        </Tabs>

        {fileKind && validation && (
          <ValidationSummary kind={fileKind} file={file!} v={validation} />
        )}

        {serverFailures && serverFailures.length > 0 && (
          <ServerFailurePanel
            failures={serverFailures}
            onDismiss={() => setServerFailures(null)}
          />
        )}

        <div className="flex flex-col items-center gap-2 pt-1">
          <div className="flex items-center gap-3">
            <Button
              onClick={onSearch}
              disabled={!canSearch}
              size="lg"
              className="gap-2 px-10 h-12 rounded-full text-base font-medium bg-gradient-primary text-primary-foreground shadow-elegant hover:shadow-glow hover:opacity-95 transition disabled:opacity-50 disabled:shadow-none disabled:cursor-not-allowed"
            >
              {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Search className="h-5 w-5" />}
              {busy ? "Searching..." : "Search"}
            </Button>
            {busy && (
              <Button
                onClick={onCancel}
                variant="outline"
                size="lg"
                className="gap-2 h-12 rounded-full px-6 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                <X className="h-4 w-4" />
                Cancel
              </Button>
            )}
          </div>
          {!canSearch && !busy && tab !== "text" && (
            <p className="text-xs text-muted-foreground">
              {!file
                ? `Add ${tab === "image" ? "an image" : "audio"} to search`
                : "Fix the issues above to enable search"}
            </p>
          )}
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
        ) : results.length > 0 ? (
          <>
            <SortToolbar
              count={results.length}
              sortBy={sortBy}
              onChange={setSortBy}
              hasSimilarity={results.some((r) => typeof r.similarity === "number")}
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {sortResults(results, sortBy).map((r) => (
                <ItemCard
                  key={r.id}
                  item={r}
                  queryTerms={extractTerms(
                    tab === "text" ? text : interpreted ?? "",
                  )}
                  queryType={tab as "text" | "image" | "audio"}
                />
              ))}
            </div>
          </>
        ) : (
          <MultimodalEmptyState activeTab={tab as "text" | "image" | "audio"} />
        )}
      </div>
      </div>
    </div>
  );
}

function ValidationSummary({
  kind,
  file,
  v,
}: {
  kind: "image" | "audio";
  file: FilePayload;
  v: Validation;
}) {
  const pct = Math.min(100, (v.size / v.maxSize) * 100);
  const sizeColor = v.sizeOk ? (pct > 80 ? "bg-amber-500" : "bg-emerald-500") : "bg-destructive";
  return (
    <div
      className={`rounded-xl border p-3 text-sm transition ${
        v.ok
          ? "border-emerald-500/30 bg-emerald-500/5"
          : "border-destructive/40 bg-destructive/5"
      }`}
    >
      <div className="flex items-center gap-2 font-medium">
        {v.ok ? (
          <>
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            <span>Ready to search</span>
          </>
        ) : (
          <>
            <AlertCircle className="h-4 w-4 text-destructive" />
            <span>File needs attention</span>
          </>
        )}
      </div>

      <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* Mime type */}
        <div className="flex items-start gap-2">
          {v.mimeOk ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />
          ) : (
            <AlertCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
          )}
          <div className="min-w-0">
            <div className="text-xs text-muted-foreground">Type</div>
            <div className="font-mono text-xs truncate">{file.mime_type || "unknown"}</div>
            {!v.mimeOk && (
              <div className="text-xs text-destructive mt-0.5">
                Allowed: {kind === "image" ? "JPG, PNG, WEBP, GIF" : "MP3, WAV, M4A, OGG, WEBM"}
              </div>
            )}
          </div>
        </div>

        {/* Size */}
        <div className="flex items-start gap-2">
          {v.sizeOk ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />
          ) : (
            <AlertCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            <div className="text-xs text-muted-foreground flex justify-between">
              <span>Size</span>
              <span>
                {formatBytes(v.size)} / {formatBytes(v.maxSize)}
              </span>
            </div>
            <div className="mt-1 h-1.5 w-full rounded-full bg-muted overflow-hidden">
              <div
                className={`h-full ${sizeColor} transition-all`}
                style={{ width: `${pct}%` }}
              />
            </div>
            {!v.sizeOk && (
              <div className="text-xs text-destructive mt-0.5">
                Exceeds max by {formatBytes(v.size - v.maxSize)}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ServerFailurePanel({
  failures,
  onDismiss,
}: {
  failures: ValidationFailure[];
  onDismiss: () => void;
}) {
  return (
    <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 font-medium text-destructive min-w-0">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>Server rejected the file</span>
          {failures[0]?.details?.filename && (
            <span className="text-xs font-normal text-muted-foreground font-mono truncate">
              · {failures[0].details.filename}
            </span>
          )}
        </div>
        <button
          onClick={onDismiss}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Dismiss
        </button>
      </div>
      <ul className="mt-3 space-y-2">
        {failures.map((f, i) => (
          <li key={i} className="flex gap-3">
            <span className="inline-flex shrink-0 items-center rounded-md border border-destructive/30 bg-destructive/10 px-2 py-0.5 text-xs font-mono font-medium text-destructive">
              {RULE_LABELS[f.rule] ?? f.rule}
            </span>
            <div className="min-w-0">
              <div className="text-foreground">{f.message}</div>
              {f.details?.allowed && (
                <div className="text-xs text-muted-foreground mt-0.5">
                  Allowed: {f.details.allowed.join(", ")}
                </div>
              )}
              {f.details?.actual !== undefined && f.details?.limit !== undefined && (
                <div className="text-xs text-muted-foreground mt-0.5">
                  Got <span className="font-mono">{f.details.actual}</span>, limit{" "}
                  <span className="font-mono">{f.details.limit}</span>
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

type SortKey = "similarity" | "newest" | "oldest" | "title";

function sortResults(results: ItemSummary[], sortBy: SortKey): ItemSummary[] {
  const arr = [...results];
  switch (sortBy) {
    case "similarity":
      return arr.sort((a, b) => (b.similarity ?? -1) - (a.similarity ?? -1));
    case "newest":
      return arr.sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
    case "oldest":
      return arr.sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? ""));
    case "title":
      return arr.sort((a, b) =>
        (a.title ?? "Untitled").localeCompare(b.title ?? "Untitled"),
      );
  }
}

function SortToolbar({
  count,
  sortBy,
  onChange,
  hasSimilarity,
}: {
  count: number;
  sortBy: SortKey;
  onChange: (s: SortKey) => void;
  hasSimilarity: boolean;
}) {
  const options: Array<{ key: SortKey; label: string; disabled?: boolean }> = [
    { key: "similarity", label: "Best match", disabled: !hasSimilarity },
    { key: "newest", label: "Newest" },
    { key: "oldest", label: "Oldest" },
    { key: "title", label: "Title" },
  ];

  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div className="text-sm text-muted-foreground">
        <span className="font-medium text-foreground">{count}</span>{" "}
        result{count === 1 ? "" : "s"}
      </div>
      <div className="flex items-center gap-2">
        <ArrowDownWideNarrow className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs text-muted-foreground mr-1">Sort by</span>
        <div className="inline-flex rounded-full border border-border bg-card p-0.5 text-xs">
          {options.map((o) => {
            const active = sortBy === o.key;
            return (
              <button
                key={o.key}
                disabled={o.disabled}
                onClick={() => onChange(o.key)}
                className={`px-3 py-1.5 rounded-full transition ${
                  active
                    ? "bg-gradient-to-r from-primary to-accent text-primary-foreground shadow-sm"
                    : o.disabled
                      ? "text-muted-foreground/50 cursor-not-allowed"
                      : "text-muted-foreground hover:text-foreground"
                }`}
                title={o.disabled ? "Similarity scores not available" : undefined}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

