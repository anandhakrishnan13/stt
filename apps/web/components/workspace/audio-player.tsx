"use client";

import { Pause, Play, RotateCcw, Volume2, VolumeX } from "lucide-react";
import { useRef, useState } from "react";
import { formatClock } from "@/lib/transcripts";

type AudioPlayerProps = {
  src: string;
  durationMs: number;
};

export function AudioPlayer({ src, durationMs }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [muted, setMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);

  // Fallback to recorded duration if audio element hasn't loaded metadata or is streaming WebM
  const totalSeconds = Math.max(0.1, durationMs / 1000);

  function togglePlay() {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
    } else {
      audio.play().catch(() => {});
    }
  }

  function onSeek(e: React.ChangeEvent<HTMLInputElement>) {
    const newTime = Number(e.target.value);
    setCurrentTime(newTime);
    if (audioRef.current) {
      audioRef.current.currentTime = newTime;
    }
  }

  function cycleSpeed() {
    const next = playbackRate === 1 ? 1.5 : playbackRate === 1.5 ? 2 : 1;
    setPlaybackRate(next);
    if (audioRef.current) {
      audioRef.current.playbackRate = next;
    }
  }

  function toggleMute() {
    const next = !muted;
    setMuted(next);
    if (audioRef.current) {
      audioRef.current.muted = next;
    }
  }

  function restart() {
    if (audioRef.current) {
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(() => {});
    }
  }

  return (
    <section
      aria-label="Recording playback"
      className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-slate-900"
    >
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        crossOrigin="use-credentials"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setCurrentTime(0);
        }}
        onTimeUpdate={() => {
          if (audioRef.current) {
            setCurrentTime(audioRef.current.currentTime);
          }
        }}
      />

      <div className="flex items-center gap-3">
        {/* Play / Pause button */}
        <button
          type="button"
          onClick={togglePlay}
          className="flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-full bg-slate-900 text-white transition hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200"
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? <Pause className="size-4 fill-current" /> : <Play className="size-4 fill-current ml-0.5" />}
        </button>

        {/* Restart button */}
        <button
          type="button"
          onClick={restart}
          className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none dark:hover:bg-slate-800 dark:hover:text-slate-100"
          aria-label="Restart from beginning"
          title="Restart"
        >
          <RotateCcw className="size-3.5" />
        </button>

        {/* Current Time / Progress Slider / Total Time */}
        <div className="flex flex-1 items-center gap-2.5 min-w-0">
          <span className="w-10 text-right text-xs tabular-nums text-slate-500 dark:text-slate-400">
            {formatClock(currentTime * 1000)}
          </span>

          <input
            type="range"
            min={0}
            max={totalSeconds}
            step={0.1}
            value={Math.min(currentTime, totalSeconds)}
            onChange={onSeek}
            className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-slate-200 accent-slate-900 transition dark:bg-slate-700 dark:accent-slate-100"
            aria-label="Audio progress slider"
          />

          <span className="w-10 text-xs tabular-nums text-slate-500 dark:text-slate-400">
            {formatClock(durationMs)}
          </span>
        </div>

        {/* Speed button */}
        <button
          type="button"
          onClick={cycleSpeed}
          className="rounded px-2 py-1 text-xs font-semibold tabular-nums text-slate-600 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          title="Playback speed"
        >
          {playbackRate}x
        </button>

        {/* Mute button */}
        <button
          type="button"
          onClick={toggleMute}
          className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none dark:hover:bg-slate-800 dark:hover:text-slate-100"
          aria-label={muted ? "Unmute" : "Mute"}
        >
          {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
        </button>
      </div>
    </section>
  );
}
