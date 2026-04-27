import { Link } from "@tanstack/react-router";
import { FileText, ImageIcon, AudioLines, Maximize2 } from "lucide-react";
import {
  highlightText,
  findSnippet,
  countMatchedTerms,
} from "@/lib/highlight";
import { AudioWaveformPreview } from "@/components/library/audio-waveform-preview";

export type ItemSummary = {
  id: string;
  modality: string;
  title: string | null;
  description: string | null;
  text_content: string | null;
  storage_path: string | null;
  mime_type: string | null;
  similarity?: number;
  created_at?: string;
};

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;

export function publicUrl(path: string | null) {
  if (!path) return null;
  return `${SUPABASE_URL}/storage/v1/object/public/library/${path}`;
}

function ModalityBadge({ modality }: { modality: string }) {
  const Icon = modality === "image" ? ImageIcon : modality === "audio" ? AudioLines : FileText;
  const colors: Record<string, string> = {
    text: "bg-primary/10 text-primary",
    image: "bg-accent/15 text-accent-foreground",
    audio: "bg-emerald-500/10 text-emerald-700",
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${colors[modality] ?? "bg-muted"}`}>
      <Icon className="h-3 w-3" />
      {modality}
    </span>
  );
}

export function ItemCard({
  item,
  queryTerms = [],
  queryType,
  rawQuery,
  onClick,
  onImageZoom,
}: {
  item: ItemSummary;
  queryTerms?: string[];
  queryType?: "text" | "image" | "audio";
  /** Original raw search query string from the URL — used to round-trip back to /results exactly. */
  rawQuery?: string;
  onClick?: () => void;
  /** When provided and the item is an image, shows a zoom button that opens a lightbox instead of navigating. */
  onImageZoom?: (id: string) => void;
}) {
  const url = publicUrl(item.storage_path);
  const title = item.title ?? "Untitled";

  // Build a snippet from the most relevant field (description or text_content),
  // preferring whichever actually contains a query term.
  const snippet =
    findSnippet(item.description, queryTerms) ??
    findSnippet(item.text_content, queryTerms) ??
    null;

  const matchCount = countMatchedTerms(
    [item.title, item.description, item.text_content],
    queryTerms,
  );

  // Pass query context onward so the item page can build its similarity panel
  // AND restore the exact /results page on Back.
  const linkSearch =
    rawQuery || queryTerms.length > 0 || queryType
      ? {
          q: rawQuery ?? (queryTerms.join(" ") || undefined),
          qt: queryType,
          sim:
            typeof item.similarity === "number"
              ? Number(item.similarity.toFixed(4))
              : undefined,
        }
      : undefined;

  return (
    <Link
      to="/item/$id"
      params={{ id: item.id }}
      search={linkSearch as never}
      onClick={onClick}
      aria-label={`Open ${item.modality} item: ${title}`}
      className="group block rounded-2xl border border-border/60 bg-card overflow-hidden hover:shadow-elegant hover:border-primary/40 hover:-translate-y-0.5 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <div className="aspect-[4/3] bg-muted/40 flex items-center justify-center overflow-hidden relative">
        {item.modality === "image" && url ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={url}
              alt={item.title ?? "Library image"}
              loading="lazy"
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
            />
            {onImageZoom && (
              <button
                type="button"
                aria-label={`Zoom image: ${title}`}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onImageZoom(item.id);
                }}
                className="absolute top-2 right-2 inline-flex h-8 w-8 items-center justify-center rounded-full bg-background/80 backdrop-blur text-foreground shadow-soft opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background hover:bg-background"
              >
                <Maximize2 className="h-4 w-4" />
              </button>
            )}
          </>
        ) : item.modality === "audio" && url ? (
          <div className="h-full w-full bg-gradient-to-br from-primary/8 via-card to-accent/8">
            <AudioWaveformPreview src={url} seed={item.id} />
          </div>
        ) : (
          <div className="p-5 text-sm line-clamp-6 text-foreground/80 font-serif italic leading-relaxed">
            {queryTerms.length > 0 && item.text_content
              ? highlightText(item.text_content, queryTerms)
              : item.text_content ?? item.description ?? "Text snippet"}
          </div>
        )}
      </div>
      <div className="p-3 space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <ModalityBadge modality={item.modality} />
          {typeof item.similarity === "number" && (
            <span className="text-xs font-mono text-muted-foreground">
              {(item.similarity * 100).toFixed(1)}%
            </span>
          )}
        </div>
        <div className="font-medium text-sm line-clamp-1">
          {queryTerms.length > 0 ? highlightText(title, queryTerms) : title}
        </div>
        {item.description && (
          <div className="text-xs text-muted-foreground line-clamp-2">
            {queryTerms.length > 0
              ? highlightText(item.description, queryTerms)
              : item.description}
          </div>
        )}
        {snippet && (
          <div className="mt-1 rounded-md border border-primary/20 bg-primary/5 px-2 py-1.5 text-xs text-foreground/80 line-clamp-3">
            <span className="text-[10px] uppercase tracking-wide text-primary font-medium mr-1">
              Match
            </span>
            {highlightText(snippet, queryTerms)}
          </div>
        )}
        {queryTerms.length > 0 && matchCount > 0 && (
          <div className="text-[10px] text-muted-foreground">
            {matchCount} matching term{matchCount === 1 ? "" : "s"}
          </div>
        )}
      </div>
    </Link>
  );
}
