import { FileText, ImageIcon, AudioLines, Upload } from "lucide-react";

export function MultimodalEmptyState({
  activeTab,
}: {
  activeTab: "text" | "image" | "audio";
}) {
  const steps: Array<{
    icon: typeof FileText;
    title: string;
    body: string;
    active: boolean;
  }> = [
    {
      icon: FileText,
      title: "Type a question",
      body: "Describe what you're looking for in plain language — concepts, moods, or topics.",
      active: activeTab === "text",
    },
    {
      icon: ImageIcon,
      title: "Drop an image",
      body: "Upload a JPG, PNG, WEBP, or GIF (max 8 MB). Gemini describes it, then we match across every modality.",
      active: activeTab === "image",
    },
    {
      icon: AudioLines,
      title: "Add audio",
      body: "Upload or record up to 2 minutes (MP3, WAV, M4A, OGG, WEBM). We transcribe it and rank similar items.",
      active: activeTab === "audio",
    },
  ];

  return (
    <div className="rounded-2xl border border-dashed border-border bg-card/50 px-6 py-12 text-center">
      <div className="mx-auto h-14 w-14 rounded-full bg-gradient-to-br from-primary/15 to-accent/20 flex items-center justify-center mb-4">
        <Upload className="h-6 w-6 text-primary" />
      </div>
      <h2 className="text-lg font-semibold">Start a multimodal search</h2>
      <p className="mt-1 text-sm text-muted-foreground max-w-md mx-auto">
        Mix text, images, and audio. Lumen embeds your query with Gemini and ranks
        every item in the library by semantic similarity.
      </p>

      <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-3 text-left">
        {steps.map((s) => {
          const Icon = s.icon;
          return (
            <div
              key={s.title}
              className={`rounded-xl border p-4 transition ${
                s.active
                  ? "border-primary/40 bg-primary/5 shadow-sm"
                  : "border-border bg-card"
              }`}
            >
              <div
                className={`inline-flex h-8 w-8 items-center justify-center rounded-lg mb-2 ${
                  s.active
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                <Icon className="h-4 w-4" />
              </div>
              <div className="text-sm font-medium">{s.title}</div>
              <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                {s.body}
              </p>
            </div>
          );
        })}
      </div>

      <p className="mt-6 text-xs text-muted-foreground">
        Tip: results are ranked by cosine similarity — the closer to 100%, the
        stronger the semantic match.
      </p>
    </div>
  );
}
