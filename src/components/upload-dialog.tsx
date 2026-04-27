import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { FileDropZone, AudioRecorder, type FilePayload } from "./media-input";
import { addItem } from "@/server/items.functions";
import { toast } from "sonner";
import { Plus, Loader2, AlertCircle } from "lucide-react";
import {
  isValidationErrorPayload,
  type ValidationFailure,
} from "@/lib/file-validation";
import { InlineRuleFailures, RULE_LABELS } from "@/components/inline-rule-failures";

export function UploadDialog({ onAdded }: { onAdded?: () => void }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("text");
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [text, setText] = useState("");
  const [file, setFile] = useState<FilePayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [serverFailures, setServerFailures] = useState<ValidationFailure[] | null>(null);
  const [visibility, setVisibility] = useState<"public" | "private">("public");
  const [duplicate, setDuplicate] = useState<{ id: string; title: string | null } | null>(null);

  const reset = () => {
    setTitle(""); setDesc(""); setText(""); setFile(null); setTab("text");
    setServerFailures(null); setDuplicate(null); setVisibility("public");
  };

  useEffect(() => {
    setServerFailures(null);
    setDuplicate(null);
  }, [file?.data_url, tab, text]);

  const doSubmit = async (allowDuplicate: boolean) => {
    setBusy(true);
    setServerFailures(null);
    setDuplicate(null);
    try {
      const base = {
        title: title || undefined,
        description: desc || undefined,
        visibility,
        allow_duplicate: allowDuplicate,
      };
      if (tab === "text") {
        if (!text.trim()) throw new Error("Enter some text");
        await addItem({ data: { ...base, modality: "text", text_content: text } });
      } else {
        if (!file) throw new Error("Select a file");
        await addItem({
          data: {
            ...base,
            modality: tab as "image" | "audio",
            data_url: file.data_url,
            mime_type: file.mime_type,
            filename: file.filename,
            audio_duration_seconds: file.duration_seconds,
          },
        });
      }
      toast.success("Added to library");
      reset();
      setOpen(false);
      onAdded?.();
    } catch (e) {
      // Try to parse structured error payloads.
      if (e instanceof Error) {
        try {
          const obj: unknown = JSON.parse(e.message);
          if (isValidationErrorPayload(obj)) {
            setServerFailures(obj.failures);
            toast.error("File rejected — see details below");
            return;
          }
          if (
            obj && typeof obj === "object" && "code" in obj &&
            (obj as { code: string }).code === "DUPLICATE_ITEM"
          ) {
            const d = obj as { existing_id: string; existing_title: string | null };
            setDuplicate({ id: d.existing_id, title: d.existing_title });
            toast.warning("Duplicate detected");
            return;
          }
        } catch {
          // not JSON
        }
      }
      const msg = e instanceof Error ? e.message : "Failed to add";
      if (msg.includes("Unauthorized")) {
        toast.error("Please sign in to upload");
      } else {
        toast.error(msg);
      }
    } finally {
      setBusy(false);
    }
  };

  const submit = () => doSubmit(false);
  const submitForce = () => doSubmit(true);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2">
          <Plus className="h-4 w-4" /> Add to library
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Add an item</DialogTitle>
        </DialogHeader>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="grid grid-cols-3 w-full">
            <TabsTrigger value="text">Text</TabsTrigger>
            <TabsTrigger value="image">Image</TabsTrigger>
            <TabsTrigger value="audio">Audio</TabsTrigger>
          </TabsList>

          {/* MIME-type failures rendered next to the type picker. */}
          <InlineRuleFailures
            failures={serverFailures}
            rules={["mime_type"]}
          />

          <div className="mt-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Title (optional)</Label>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
              </div>
              <div>
                <Label>Description (optional)</Label>
                <Input value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={1000} />
              </div>
            </div>

            <TabsContent value="text" className="mt-2">
              <Label>Text content</Label>
              <Textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Paste an article excerpt, quote, note..."
                rows={6}
                maxLength={8000}
              />
            </TabsContent>
            <TabsContent value="image" className="mt-2">
              <FileDropZone
                accept="image/*"
                kind="image"
                hint="JPG, PNG, WEBP, or GIF · max 8 MB"
                value={file}
                onFile={setFile}
                onClear={() => setFile(null)}
              />
              <InlineRuleFailures
                failures={serverFailures}
                rules={["file_size", "data_url_format", "missing_data"]}
              />
            </TabsContent>
            <TabsContent value="audio" className="mt-2 space-y-3">
              <FileDropZone
                accept="audio/*"
                kind="audio"
                hint="MP3, WAV, M4A, OGG, or WEBM · max 15 MB · 2 min"
                value={file}
                onFile={setFile}
                onClear={() => setFile(null)}
              />
              <InlineRuleFailures
                failures={serverFailures}
                rules={["file_size", "audio_duration", "data_url_format", "missing_data"]}
              />
              {!file && <AudioRecorder onFile={setFile} />}
            </TabsContent>
          </div>
        </Tabs>

        {serverFailures && serverFailures.length > 0 && (
          <div className="mt-4 rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-sm">
            <div className="flex items-center gap-2 font-medium text-destructive">
              <AlertCircle className="h-4 w-4" />
              Server rejected the file
              {serverFailures[0]?.details?.filename && (
                <span className="ml-1 text-xs font-normal text-muted-foreground font-mono truncate">
                  · {serverFailures[0].details.filename}
                </span>
              )}
            </div>
            <ul className="mt-2 space-y-1.5">
              {serverFailures.map((f, i) => (
                <li key={i} className="flex gap-2">
                  <span className="inline-flex shrink-0 items-center rounded-md border border-destructive/30 bg-destructive/10 px-2 py-0.5 text-xs font-mono font-medium text-destructive">
                    {RULE_LABELS[f.rule] ?? f.rule}
                  </span>
                  <span className="text-foreground">{f.message}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <Button onClick={submit} disabled={busy} className="mt-4 gap-2">
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {busy ? "Embedding..." : "Add to library"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
