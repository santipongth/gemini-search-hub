import { Link } from "@tanstack/react-router";
import { FileText, ImageIcon, AudioLines } from "lucide-react";

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

export function ItemCard({ item }: { item: ItemSummary }) {
  const url = publicUrl(item.storage_path);
  return (
    <Link
      to="/item/$id"
      params={{ id: item.id }}
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
            {item.text_content ?? item.description ?? "Text snippet"}
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
        <div className="font-medium text-sm line-clamp-1">{item.title ?? "Untitled"}</div>
        {item.description && (
          <div className="text-xs text-muted-foreground line-clamp-2">{item.description}</div>
        )}
      </div>
    </Link>
  );
}
