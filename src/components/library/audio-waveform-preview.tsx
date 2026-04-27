import { useEffect, useRef, useState } from "react";
import { Play, Pause } from "lucide-react";

const BAR_COUNT = 32;

// Deterministic pseudo-random heights so the same item always renders the
// same shape — gives the impression of a real waveform without decoding audio.
function seededHeights(seed: string): number[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const out: number[] = [];
  for (let i = 0; i < BAR_COUNT; i++) {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    const v = ((h >>> 0) % 1000) / 1000;
    // bias toward middle heights, occasional tall bars
    out.push(0.25 + v * 0.75);
  }
  return out;
}

export function AudioWaveformPreview({
  src,
  seed,
}: {
  src: string;
  seed: string;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const heights = seededHeights(seed);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onTime = () =>
      setProgress(a.duration ? a.currentTime / a.duration : 0);
    const onEnd = () => {
      setPlaying(false);
      setProgress(0);
    };
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("ended", onEnd);
    return () => {
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("ended", onEnd);
    };
  }, []);

  const toggle = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const a = audioRef.current;
    if (!a) return;
    if (playing) {
      a.pause();
      setPlaying(false);
    } else {
      a.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    }
  };

  return (
    <div
      className="flex h-full w-full items-center gap-3 px-4"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? "Pause" : "Play"}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm transition hover:scale-105 active:scale-95"
      >
        {playing ? (
          <Pause className="h-4 w-4" />
        ) : (
          <Play className="h-4 w-4 translate-x-0.5" />
        )}
      </button>
      <div className="flex h-12 flex-1 items-center gap-[2px]">
        {heights.map((h, i) => {
          const passed = i / BAR_COUNT < progress;
          return (
            <div
              key={i}
              className={`flex-1 rounded-full transition-colors ${
                passed
                  ? "bg-primary"
                  : "bg-primary/30"
              } ${playing ? "animate-pulse" : ""}`}
              style={{
                height: `${Math.round(h * 100)}%`,
                animationDelay: playing ? `${i * 30}ms` : undefined,
              }}
            />
          );
        })}
      </div>
      <audio ref={audioRef} src={src} preload="metadata" className="hidden" />
    </div>
  );
}
