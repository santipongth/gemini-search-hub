import { useState, useRef } from "react";
import { Mic, Square, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  ALLOWED_IMAGE_MIME,
  ALLOWED_AUDIO_MIME,
  MAX_IMAGE_BYTES,
  MAX_AUDIO_BYTES,
  MAX_AUDIO_SECONDS,
  formatBytes,
} from "@/lib/file-validation";

// Re-export so existing imports from "@/components/media-input" still work.
export {
  ALLOWED_IMAGE_MIME,
  ALLOWED_AUDIO_MIME,
  MAX_IMAGE_BYTES,
  MAX_AUDIO_BYTES,
  MAX_AUDIO_SECONDS,
};

export type FilePayload = {
  data_url: string;
  mime_type: string;
  filename: string;
  // For audio: duration measured client-side. Sent to the server as a
  // hint; the server still re-derives from the bytes when possible.
  duration_seconds?: number;
};


async function getAudioDuration(dataUrl: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const a = document.createElement("audio");
    a.preload = "metadata";
    a.onloadedmetadata = () => {
      // Some browsers report Infinity for webm blobs; fall back to seeking.
      if (!isFinite(a.duration)) {
        a.currentTime = 1e10;
        a.ontimeupdate = () => {
          a.ontimeupdate = null;
          resolve(a.duration);
        };
      } else {
        resolve(a.duration);
      }
    };
    a.onerror = () => reject(new Error("Could not read audio metadata"));
    a.src = dataUrl;
  });
}

type Kind = "image" | "audio";

async function validateFile(file: File, kind: Kind): Promise<string | null> {
  if (kind === "image") {
    if (!(ALLOWED_IMAGE_MIME as readonly string[]).includes(file.type)) {
      return `Unsupported image type "${file.type || "unknown"}". Use JPG, PNG, WEBP, or GIF.`;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      return `Image is ${formatBytes(file.size)}. Max ${formatBytes(MAX_IMAGE_BYTES)}.`;
    }
  } else {
    if (file.type && !(ALLOWED_AUDIO_MIME as readonly string[]).includes(file.type)) {
      return `Unsupported audio type "${file.type}". Use MP3, WAV, M4A, OGG, or WEBM.`;
    }
    if (file.size > MAX_AUDIO_BYTES) {
      return `Audio is ${formatBytes(file.size)}. Max ${formatBytes(MAX_AUDIO_BYTES)}.`;
    }
  }
  return null;
}

export function FileDropZone({
  accept,
  kind,
  onFile,
  value,
  onClear,
  hint,
}: {
  accept: string;
  kind: Kind;
  onFile: (f: FilePayload) => void;
  value?: FilePayload | null;
  onClear?: () => void;
  hint: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);

  const handle = async (file: File) => {
    const err = await validateFile(file, kind);
    if (err) {
      toast.error(err);
      return;
    }

    let dataUrl = "";
    try {
      dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error("Could not read file"));
        reader.readAsDataURL(file);
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not read file");
      return;
    }
    if (!dataUrl) return;

    let durationSeconds: number | undefined;
    if (kind === "audio") {
      try {
        const duration = await getAudioDuration(dataUrl);
        durationSeconds = duration;
        if (duration > MAX_AUDIO_SECONDS) {
          toast.error(
            `Audio is ${duration.toFixed(0)}s. Max ${MAX_AUDIO_SECONDS}s (${Math.floor(
              MAX_AUDIO_SECONDS / 60,
            )} min).`,
          );
          return;
        }
      } catch {
        toast.error("Could not read audio duration. Try a different file.");
        return;
      }
    }

    onFile({
      data_url: dataUrl,
      mime_type: file.type,
      filename: file.name,
      duration_seconds: durationSeconds,
    });
  };

  if (value) {
    return (
      <div className="relative rounded-xl border border-border bg-card p-4 flex items-center gap-3">
        {value.mime_type.startsWith("image/") ? (
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
          e.target.value = "";
        }}
      />
    </div>
  );
}

export function AudioRecorder({ onFile }: { onFile: (f: FilePayload) => void }) {
  const [recording, setRecording] = useState(false);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef<number>(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const finalize = () => {
    const rec = recRef.current;
    if (!rec) return;
    rec.onstop = async () => {
      const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
      if (blob.size > MAX_AUDIO_BYTES) {
        toast.error(`Recording is ${(blob.size / 1024 / 1024).toFixed(1)} MB. Max 15 MB.`);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        onFile({
          data_url: reader.result as string,
          mime_type: blob.type,
          filename: `recording-${Date.now()}.webm`,
        });
      };
      reader.readAsDataURL(blob);
    };
  };

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => chunksRef.current.push(e.data);
      const cleanup = () => {
        stream.getTracks().forEach((t) => t.stop());
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      };
      rec.onstop = () => cleanup(); // overwritten by finalize below
      recRef.current = rec;
      finalize();
      const originalOnStop = rec.onstop;
      rec.onstop = (ev) => {
        cleanup();
        originalOnStop?.call(rec, ev);
      };
      rec.start();
      startedAtRef.current = Date.now();
      setRecording(true);
      // Hard cap at MAX_AUDIO_SECONDS
      timeoutRef.current = setTimeout(() => {
        if (recRef.current?.state === "recording") {
          toast.message(`Reached ${MAX_AUDIO_SECONDS}s limit, stopping.`);
          recRef.current.stop();
          setRecording(false);
        }
      }, MAX_AUDIO_SECONDS * 1000);
    } catch {
      toast.error("Microphone access denied");
    }
  };

  const stop = () => {
    const elapsed = (Date.now() - startedAtRef.current) / 1000;
    if (elapsed < 0.5) {
      toast.error("Recording too short");
    }
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
