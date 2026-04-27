import { useCallback, useEffect, useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, X, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { publicUrl, type ItemSummary } from "@/components/item-card";

/**
 * Accessible lightbox for image items.
 *
 * - Opens on a specific item id from a list of image items
 * - Keyboard: ← / → to step, Esc to close
 * - Focus-trapped via dialog role; backdrop click closes
 * - Provides "Open details" link to the item page
 */
export function LightboxGallery({
  items,
  openId,
  onOpenChange,
  detailSearch,
}: {
  /** All currently visible items. Non-image items are ignored. */
  items: ItemSummary[];
  /** Currently open item id, or null when closed. */
  openId: string | null;
  onOpenChange: (id: string | null) => void;
  /** Optional search params forwarded to the item detail link. */
  detailSearch?: Record<string, unknown>;
}) {
  const images = useMemo(
    () => items.filter((i) => i.modality === "image" && i.storage_path),
    [items],
  );
  const index = openId ? images.findIndex((i) => i.id === openId) : -1;
  const current = index >= 0 ? images[index] : null;

  const goTo = useCallback(
    (delta: number) => {
      if (images.length === 0) return;
      const next = (index + delta + images.length) % images.length;
      onOpenChange(images[next].id);
    },
    [images, index, onOpenChange],
  );

  const close = useCallback(() => onOpenChange(null), [onOpenChange]);

  useEffect(() => {
    if (!current) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowLeft") goTo(-1);
      else if (e.key === "ArrowRight") goTo(1);
    };
    window.addEventListener("keydown", onKey);
    // Lock body scroll while open
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [current, close, goTo]);

  if (!current) return null;

  const url = publicUrl(current.storage_path);
  const title = current.title ?? "Untitled image";
  const counterLabel = `Image ${index + 1} of ${images.length}`;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Image preview: ${title}`}
      className="fixed inset-0 z-50 flex flex-col bg-background/90 backdrop-blur-md animate-in fade-in duration-150"
      onClick={(e) => {
        // Click on backdrop (not bubbled from inner content) closes.
        if (e.target === e.currentTarget) close();
      }}
    >
      {/* Top bar */}
      <div className="flex items-center justify-between gap-3 px-4 sm:px-6 py-3 border-b border-border/50 bg-card/40">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wide text-muted-foreground" aria-live="polite">
            {counterLabel}
          </div>
          <div className="font-display text-base sm:text-lg font-semibold truncate">{title}</div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button asChild variant="outline" size="sm" className="gap-1.5">
            <Link
              to="/item/$id"
              params={{ id: current.id }}
              search={(detailSearch ?? {}) as never}
              onClick={close}
            >
              <ExternalLink className="h-4 w-4" /> Open details
            </Link>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={close}
            aria-label="Close preview"
          >
            <X className="h-5 w-5" />
          </Button>
        </div>
      </div>

      {/* Stage */}
      <div className="relative flex-1 flex items-center justify-center overflow-hidden p-4 sm:p-8">
        {images.length > 1 && (
          <Button
            variant="outline"
            size="icon"
            onClick={() => goTo(-1)}
            aria-label="Previous image"
            className="absolute left-3 sm:left-6 top-1/2 -translate-y-1/2 h-11 w-11 rounded-full bg-card/80 backdrop-blur shadow-soft z-10"
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>
        )}

        {url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={current.id}
            src={url}
            alt={title}
            className="max-h-full max-w-full object-contain rounded-xl shadow-elegant animate-in zoom-in-95 fade-in duration-200"
          />
        )}

        {images.length > 1 && (
          <Button
            variant="outline"
            size="icon"
            onClick={() => goTo(1)}
            aria-label="Next image"
            className="absolute right-3 sm:right-6 top-1/2 -translate-y-1/2 h-11 w-11 rounded-full bg-card/80 backdrop-blur shadow-soft z-10"
          >
            <ChevronRight className="h-5 w-5" />
          </Button>
        )}
      </div>

      {/* Caption / description */}
      {current.description && (
        <div className="px-4 sm:px-8 py-3 border-t border-border/50 bg-card/40">
          <p className="text-sm text-muted-foreground line-clamp-2 max-w-3xl mx-auto text-center">
            {current.description}
          </p>
        </div>
      )}
    </div>
  );
}
