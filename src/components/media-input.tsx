import { useState, useRef } from "react";
import { Mic, Square, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export type FilePayload = {
  data_url: string;
  mime_type: string;
  filename: string;
};

export function FileDropZone({
  accept,
  onFile,
  value,
  onClear,
  hint,
}: {
  accept: string;
  onFile: (f: FilePayload) => void;
  value?: FilePayload | null;
  onClear?: () => void;
  hint: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);

  const handle = async (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      onFile({
        data_url: reader.result as string,
        mime_type: file.type,
        filename: file.name,
      });
    };
    reader.readAsDataURL(file);
  };

  if (value) {
    return (
      <div className="relative rounded-xl border border-border bg-card p-4 flex items-center gap-3">
        {value.mime_type.startsWith("image/") ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value.data_url} alt="preview" className="h-20 w-20 rounded-md object-cover" />
        ) : (
          <audio controls src={value.data_url} className="flex-1" />
        )}
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate">{value.filename}</div>
          <div className="text-xs text-muted-foreground">{value.mime_type}</div>
        </div>
        {onClear && (
          <Button variant="ghost" size="icon" onClick={onClear}>
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>
    );
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        const f = e.dataTransfer.files?.[0];
        if (f) handle(f);
      }}
      onClick={() => inputRef.current?.click()}
      className={`cursor-pointer rounded-xl border-2 border-dashed p-8 text-center transition ${
        drag ? "border-primary bg-primary/5" : "border-border bg-muted/30 hover:bg-muted/60"
      }`}
    >
      <Upload className="mx-auto h-8 w-8 text-muted-foreground" />
      <div className="mt-2 text-sm font-medium">Drop a file or click to browse</div>
      <div className="text-xs text-muted-foreground mt-1">{hint}</div>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handle(f);
        }}
      />
    </div>
  );
}

export function AudioRecorder({ onFile }: { onFile: (f: FilePayload) => void }) {
  const [recording, setRecording] = useState(false);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => chunksRef.current.push(e.data);
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        const reader = new FileReader();
        reader.onload = () => {
          onFile({
            data_url: reader.result as string,
            mime_type: blob.type,
            filename: `recording-${Date.now()}.webm`,
          });
        };
        reader.readAsDataURL(blob);
        stream.getTracks().forEach((t) => t.stop());
      };
      rec.start();
      recRef.current = rec;
      setRecording(true);
    } catch {
      alert("Microphone access denied");
    }
  };

  const stop = () => {
    recRef.current?.stop();
    setRecording(false);
  };

  return (
    <Button
      type="button"
      variant={recording ? "destructive" : "outline"}
      onClick={recording ? stop : start}
      className="gap-2"
    >
      {recording ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
      {recording ? "Stop recording" : "Record audio"}
    </Button>
  );
}
