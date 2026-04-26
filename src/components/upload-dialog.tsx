import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { FileDropZone, AudioRecorder, type FilePayload } from "./media-input";
import { addItem } from "@/server/items.functions";
import { toast } from "sonner";
import { Plus, Loader2 } from "lucide-react";

export function UploadDialog({ onAdded }: { onAdded?: () => void }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("text");
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [text, setText] = useState("");
  const [file, setFile] = useState<FilePayload | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setTitle(""); setDesc(""); setText(""); setFile(null); setTab("text");
  };

  const submit = async () => {
    setBusy(true);
    try {
      if (tab === "text") {
        if (!text.trim()) throw new Error("Enter some text");
        await addItem({ data: { modality: "text", title: title || undefined, description: desc || undefined, text_content: text } });
      } else {
        if (!file) throw new Error("Select a file");
        await addItem({
          data: {
            modality: tab as "image" | "audio",
            title: title || undefined,
            description: desc || undefined,
            data_url: file.data_url,
            mime_type: file.mime_type,
            filename: file.filename,
          },
        });
      }
      toast.success("Added to library");
      reset();
      setOpen(false);
      onAdded?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add");
    } finally {
      setBusy(false);
    }
  };

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
                hint="JPG, PNG, or WEBP"
                value={file}
                onFile={setFile}
                onClear={() => setFile(null)}
              />
            </TabsContent>
            <TabsContent value="audio" className="mt-2 space-y-3">
              <FileDropZone
                accept="audio/*"
                hint="MP3, WAV, M4A, or WEBM"
                value={file}
                onFile={setFile}
                onClear={() => setFile(null)}
              />
              {!file && <AudioRecorder onFile={setFile} />}
            </TabsContent>
          </div>
        </Tabs>

        <Button onClick={submit} disabled={busy} className="mt-4 gap-2">
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {busy ? "Embedding..." : "Add to library"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
