"use client";

import type { SegmentDTO } from "@stt/shared";
import { Loader2, Mic, Square } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { VoiceRecorder } from "@/lib/recorder";
import { cn } from "@/lib/utils";

type ComposerState =
  | { phase: "idle" }
  | { phase: "starting" }
  | { phase: "recording" }
  | { phase: "finishing" }
  | { phase: "error"; message: string };

export function Composer() {
  const router = useRouter();
  const [state, setState] = useState<ComposerState>({ phase: "idle" });
  const [elapsedMs, setElapsedMs] = useState(0);
  const [lines, setLines] = useState<SegmentDTO[]>([]);
  const [interim, setInterim] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const recorderRef = useRef<VoiceRecorder | null>(null);

  useEffect(() => {
    if (state.phase !== "recording") return;
    setElapsedMs(0);
    const timer = window.setInterval(() => {
      setElapsedMs(recorderRef.current?.elapsedMs ?? 0);
    }, 250);
    return () => window.clearInterval(timer);
  }, [state.phase]);

  useEffect(
    () => () => {
      void recorderRef.current?.cancel();
      recorderRef.current = null;
    },
    [],
  );

  async function start() {
    setState({ phase: "starting" });
    setLines([]);
    setInterim("");
    setNotice(null);
    try {
      recorderRef.current = await VoiceRecorder.start({
        onSegment: (segment) => {
          setLines((current) =>
            current.some((line) => line.id === segment.id)
              ? current.map((line) => (line.id === segment.id ? segment : line))
              : [...current, segment],
          );
          setInterim("");
        },
        onInterim: setInterim,
        onTranscriptionError: (message) => setNotice(message),
      });
      setState({ phase: "recording" });
    } catch (error) {
      setState({ phase: "error", message: error instanceof Error ? error.message : "Recording failed." });
    }
  }

  async function stop() {
    const recorder = recorderRef.current;
    if (!recorder) return;
    setState({ phase: "finishing" });
    try {
      const result = await recorder.stop();
      recorderRef.current = null;
      router.push(`/t/${result.id}`);
    } catch (error) {
      recorderRef.current = null;
      setState({
        phase: "error",
        message: error instanceof Error ? error.message : "Could not save the recording.",
      });
    }
  }

  async function cancel() {
    const recorder = recorderRef.current;
    recorderRef.current = null;
    setState({ phase: "idle" });
    await recorder?.cancel();
  }

  const recording = state.phase === "recording";
  const busy = state.phase === "starting" || state.phase === "finishing";

  const note = notice ?? (
    state.phase === "recording"
      ? `Recording · ${formatClock(elapsedMs)} — audio uploads as you speak`
      : state.phase === "starting"
        ? "Waiting for the microphone…"
        : state.phase === "finishing"
          ? "Saving the recording…"
          : state.phase === "error"
            ? state.message
            : "Hindi, English, or both — the mic is live");

  return (
    <div className="mx-auto w-full max-w-3xl shrink-0 px-4 pb-5">
      <div
        className={cn(
          "rounded-[26px] border bg-white p-2 shadow-sm transition-colors dark:bg-slate-900",
          recording
            ? "border-rose-300 ring-2 ring-rose-100 dark:border-rose-500/50 dark:ring-rose-500/10"
            : "border-slate-200 dark:border-slate-800",
        )}
      >
        {lines.length > 0 ? (
          <div
            aria-live="polite"
            aria-label="Live transcript"
            className="max-h-40 space-y-1 overflow-y-auto px-3 pb-2 pt-1 text-sm"
          >
            {lines.map((line) => (
              <p key={line.id} className="text-slate-800 dark:text-slate-200">
                {line.text}
              </p>
            ))}
            {interim ? (
              <p className="text-slate-400 dark:text-slate-500">{interim}</p>
            ) : null}
          </div>
        ) : null}
        <div className="flex items-end gap-2 px-2">
          <label htmlFor="spoken-input" className="sr-only">
            Spoken input
          </label>
          <textarea
            id="spoken-input"
            rows={1}
            readOnly
            value={recording ? formatClock(elapsedMs) : ""}
            aria-describedby="composer-note"
            placeholder="Speak in Hindi, English, or both…"
            className="max-h-32 min-h-10 flex-1 resize-none bg-transparent py-2 text-sm tabular-nums outline-none placeholder:text-slate-400 dark:placeholder:text-slate-500"
          />
          {recording ? (
            <button
              type="button"
              onClick={() => void stop()}
              aria-label="Stop and save recording"
              className="mb-1 grid size-9 shrink-0 place-items-center rounded-full bg-rose-600 text-white transition hover:bg-rose-500"
            >
              <Square className="size-3.5 fill-current" aria-hidden />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void start()}
              disabled={busy}
              aria-label="Start recording"
              className="mb-1 grid size-9 shrink-0 place-items-center rounded-full bg-slate-900 text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Mic className="size-4" aria-hidden />
              )}
            </button>
          )}
        </div>
        <p
          id="composer-note"
          aria-live="polite"
          className={cn(
            "px-3 pb-1 text-center text-[11px]",
            state.phase === "error"
              ? "text-rose-600 dark:text-rose-400"
              : "text-slate-500 dark:text-slate-400",
          )}
        >
          {note}
          {recording ? (
            <button
              type="button"
              onClick={() => void cancel()}
              className="ml-2 underline underline-offset-2 hover:text-slate-900 dark:hover:text-slate-200"
            >
              Discard
            </button>
          ) : null}
        </p>
      </div>
    </div>
  );
}

function formatClock(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  return `${minutes}:${String(totalSeconds % 60).padStart(2, "0")}`;
}
