import { Link } from "@tanstack/react-router";
import { FileText, ImageIcon, AudioLines } from "lucide-react";
import {
  highlightText,
  findSnippet,
  countMatchedTerms,
} from "@/lib/highlight";

export type ItemSummary = {
  id: string;
  modality: string;
  title: string | null;
  description: string | null;
  text_content: string | null;
  storage_path: string | null;
  mime_type: string | null;
  similarity?: number;
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
}: {
  item: ItemSummary;
  queryTerms?: string[];
  queryType?: "text" | "image" | "audio";
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

  // Pass query context onward so the item page can build its similarity panel.
  const linkSearch =
    queryTerms.length > 0 || queryType
      ? {
          q: queryTerms.join(" ") || undefined,
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
      className="group block rounded-xl border border-border bg-card overflow-hidden hover:shadow-lg hover:border-primary/40 transition"
    >
      <div className="aspect-[4/3] bg-muted/40 flex items-center justify-center overflow-hidden">
        {item.modality === "image" && url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={item.title ?? ""} className="h-full w-full object-cover group-hover:scale-105 transition" />
        ) : item.modality === "audio" ? (
          <div className="p-4 w-full">
            <AudioLines className="h-10 w-10 mx-auto text-muted-foreground mb-2" />
            {url && <audio controls src={url} className="w-full" onClick={(e) => e.preventDefault()} />}
          </div>
        ) : (
          <div className="p-4 text-sm line-clamp-6 text-foreground/80 font-serif italic">
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
