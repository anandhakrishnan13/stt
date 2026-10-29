"use client";

import type { SegmentDTO } from "@stt/shared";
import { AudioLines, Loader2, Mic, Square, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AudioWave } from "@/components/workspace/audio-wave";
import { showToast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { VoiceRecorder } from "@/lib/recorder";
import { useSession } from "@/lib/session";
import { formatClock, TRANSCRIPTS_CHANGED } from "@/lib/transcripts";
import { useTypewriter } from "@/lib/use-typewriter";
import { cn } from "@/lib/utils";

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

const MODEL_LABELS: Record<string, string> = {
  gemini: "Gemini",
  whisper: "Whisper (Groq)",
  whistle: "Whistle (self-hosted)",
};

type RecordingState =
  | { phase: "idle" }
  | { phase: "starting" }
  | { phase: "recording" }
  | { phase: "finishing" }
  | { phase: "error"; message: string };

export default function WorkspacePage() {
  const { user } = useSession();
  const router = useRouter();

  const [state, setState] = useState<RecordingState>({ phase: "idle" });
  const [elapsedMs, setElapsedMs] = useState(0);
  const [lines, setLines] = useState<SegmentDTO[]>([]);
  const [interim, setInterim] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [audioStream, setAudioStream] = useState<MediaStream | null>(null);

  const [model, setModel] = useState<"gemini" | "whisper" | "whistle">(() => {
    if (typeof window === "undefined") return "whisper";
    try {
      return (localStorage.getItem("stt_model") as "gemini" | "whisper" | "whistle") || "whisper";
    } catch {
      return "whisper";
    }
  });

  const recorderRef = useRef<VoiceRecorder | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);

  const recording = state.phase === "recording";
  const busy = state.phase === "starting" || state.phase === "finishing";

  const committedText = lines
    .map((line) => line.text.trim())
    .filter(Boolean)
    .join(" ");
  const typed = useTypewriter(committedText, recording);
  function selectModel(m: "gemini" | "whisper" | "whistle") {
    setModel(m);
    try {
      localStorage.setItem("stt_model", m);
    } catch {}
  }

  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [typed, interim]);

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
      const recorder = await VoiceRecorder.start({
        engine: model,
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
      recorderRef.current = recorder;
      setAudioStream(recorder.mediaStream);
      setState({ phase: "recording" });
    } catch (error) {
      setAudioStream(null);
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
      setAudioStream(null);
      if (lines.length === 0 && !interim) {
        setState({ phase: "idle" });
        return;
      }
      router.push(`/t/${result.id}`);
    } catch (error) {
      recorderRef.current = null;
      setAudioStream(null);
      setState({
        phase: "error",
        message: error instanceof Error ? error.message : "Could not save the recording.",
      });
    }
  }

  async function cancel() {
    const recorder = recorderRef.current;
    recorderRef.current = null;
    setAudioStream(null);
    setState({ phase: "idle" });
    await recorder?.cancel();
  }
  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setNotice("Transcribing uploaded audio…");
    try {
      const res = await api.uploadAudio(file, model);
      window.dispatchEvent(new Event(TRANSCRIPTS_CHANGED));
      showToast("Audio file transcribed successfully", "success");
      router.push(`/t/${res.transcript.id}`);
    } catch (err) {
      setUploading(false);
      setNotice(null);
      showToast(err instanceof Error ? err.message : "Upload failed", "error");
    }
  }

  return (
    <main className="flex min-h-0 flex-1 flex-col justify-between">
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-6 py-6">
        {!recording && lines.length === 0 && !interim ? (
          <div className="w-full max-w-xl text-center space-y-4">
            <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 shadow-sm">
              <AudioLines className="size-5" aria-hidden />
            </span>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              {greeting()}{user ? `, ${user.firstName}` : ""}
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Any language — written in Roman letters as you speak.
            </p>
          </div>
        ) : (
          <div className="flex w-full max-w-2xl flex-1 flex-col justify-center space-y-4">
            {recording && (
              <div className="flex items-center gap-2 text-xs font-medium text-rose-600 dark:text-rose-400">
                <span className="relative flex size-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-75" />
                  <span className="relative inline-flex size-2 rounded-full bg-rose-500" />
                </span>
                <span>Listening</span>
                <span className="inline-flex gap-0.5">
                  <span className="size-1 rounded-full bg-rose-500 animate-bounce [animation-delay:-0.3s]" />
                  <span className="size-1 rounded-full bg-rose-500 animate-bounce [animation-delay:-0.15s]" />
                  <span className="size-1 rounded-full bg-rose-500 animate-bounce" />
                </span>
                <span className="text-slate-400 dark:text-slate-500 font-normal">
                  · {MODEL_LABELS[model] ?? "Whisper"}
                </span>
              </div>
            )}

            <div
              ref={transcriptRef}
              className="min-h-[140px] max-h-[50vh] overflow-y-auto pr-2 text-xl sm:text-2xl font-normal leading-relaxed text-slate-800 dark:text-slate-100 scroll-smooth"
            >
              {typed}
              {interim ? (
                <span className="text-slate-400 dark:text-slate-500">
                  {typed ? " " : ""}
                  {interim}
                </span>
              ) : null}
              {recording && (
                <span className="ml-1 inline-block h-5 w-1.5 animate-pulse rounded-xs bg-rose-500 align-middle dark:bg-rose-400" />
              )}
              {!typed && !interim && recording && (
                <span className="text-slate-400 dark:text-slate-500 italic text-base">
                  Speak now…
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="mx-auto w-full max-w-xl shrink-0 px-4 pb-6 pt-2">
        <div className="flex justify-center pb-3">
          <div className="inline-flex max-w-full flex-wrap items-center justify-center rounded-full bg-slate-100 p-0.5 text-xs font-medium dark:bg-slate-800">
            <button
              type="button"
              disabled={recording}
              onClick={() => selectModel("gemini")}
              className={cn(
                "rounded-full px-3 py-1 transition cursor-pointer disabled:cursor-not-allowed",
                model === "gemini"
                  ? "bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-slate-100"
                  : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100",
              )}
            >
              Gemini
            </button>
            <button
              type="button"
              disabled={recording}
              onClick={() => selectModel("whisper")}
              className={cn(
                "rounded-full px-3 py-1 transition cursor-pointer disabled:cursor-not-allowed",
                model === "whisper"
                  ? "bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-slate-100"
                  : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100",
              )}
            >
              {MODEL_LABELS.whisper}
            </button>
            <button
              type="button"
              disabled={recording}
              onClick={() => selectModel("whistle")}
              className={cn(
                "rounded-full px-3 py-1 transition cursor-pointer disabled:cursor-not-allowed",
                model === "whistle"
                  ? "bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-slate-100"
                  : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100",
              )}
            >
              {MODEL_LABELS.whistle}
            </button>
          </div>
        </div>

        {/* When NOT recording: Only a clean centered Mic button */}
        {!recording ? (
          <div className="flex flex-col items-center justify-center gap-2.5">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => void start()}
                disabled={busy || uploading}
                aria-label="Start recording"
                className="group grid size-16 place-items-center rounded-full bg-slate-900 text-white shadow-md transition hover:scale-105 hover:bg-slate-800 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white cursor-pointer"
              >
                {busy || uploading ? (
                  <Loader2 className="size-6 animate-spin" aria-hidden />
                ) : (
                  <Mic className="size-6 transition group-hover:scale-110" aria-hidden />
                )}
              </button>

              <label
                className={cn(
                  "grid size-12 place-items-center rounded-full border border-slate-200 bg-white text-slate-600 shadow-xs transition hover:bg-slate-50 hover:text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 cursor-pointer",
                  (busy || uploading) && "pointer-events-none opacity-40",
                )}
                title="Upload audio file (.mp3, .wav, .m4a, .webm, .ogg)"
              >
                <Upload className="size-5" />
                <input
                  type="file"
                  accept="audio/*,.mp3,.wav,.m4a,.webm,.ogg"
                  className="sr-only"
                  disabled={busy || uploading}
                  onChange={handleFileUpload}
                />
              </label>
            </div>
            <p className="text-xs text-slate-400 dark:text-slate-500">
              {notice ?? (uploading ? "Transcribing audio file…" : "Click mic to speak or upload audio file")}
            </p>
          </div>
        ) : (
          /* When recording: Rectangular box with live wavelength animation that reacts to voice */
          <div className="flex flex-col items-center">
            <div className="flex w-full items-center justify-between gap-4 rounded-2xl border border-rose-200 bg-white px-4 py-2.5 shadow-md dark:border-rose-900/50 dark:bg-slate-900">
              {/* Left: Live reactive audio wavelength */}
              <div className="flex items-center gap-3 min-w-0">
                <AudioWave stream={audioStream} />
                <span className="text-sm font-semibold tabular-nums text-slate-700 dark:text-slate-200">
                  {formatClock(elapsedMs)}
                </span>
              </div>

              {/* Right: Actions */}
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => void cancel()}
                  className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-slate-800 dark:hover:text-slate-200 cursor-pointer"
                >
                  Discard
                </button>
                <button
                  type="button"
                  onClick={() => void stop()}
                  aria-label="Stop recording"
                  className="grid size-10 place-items-center rounded-full bg-rose-600 text-white shadow-sm transition hover:bg-rose-500 active:scale-95 cursor-pointer"
                >
                  <Square className="size-4 fill-current" aria-hidden />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
