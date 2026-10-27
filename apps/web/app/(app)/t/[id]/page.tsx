"use client";

import type { SegmentDTO, TranscriptDTO } from "@stt/shared";
import { ArrowLeft, AudioLines, Check, Copy, Download, FileText, Subtitles } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { showToast } from "@/components/ui/toast";
import { ApiError, api, audioUrl } from "@/lib/api";
import { AudioPlayer, type AudioPlayerHandle } from "@/components/workspace/audio-player";
import { downloadFile, toMarkdown, toPlainText, toSrt } from "@/lib/export-transcript";
import { ENGINE_LABEL, formatDuration, formatTranscriptDate, TRANSCRIPTS_CHANGED } from "@/lib/transcripts";
import { cn } from "@/lib/utils";

type State =
  | { status: "loading" }
  | { status: "missing" }
  | { status: "error" }
  | { status: "ready"; transcript: TranscriptDTO; segments: SegmentDTO[] };

export default function TranscriptPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const [state, setState] = useState<State>({ status: "loading" });
  const [currentTime, setCurrentTime] = useState(0);
  const [copied, setCopied] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const playerRef = useRef<AudioPlayerHandle | null>(null);

  async function handleCopy() {
    if (state.status !== "ready") return;
    const text = toPlainText(state.segments);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      showToast("Transcript copied to clipboard", "success");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      showToast("Failed to copy transcript", "error");
    }
  }

  function exportMarkdown() {
    if (state.status !== "ready") return;
    const md = toMarkdown(state.transcript, state.segments);
    downloadFile(md, `${state.transcript.title || "transcript"}.md`, "text/markdown");
    showToast("Downloaded Markdown (.md)", "success");
  }

  function exportTxt() {
    if (state.status !== "ready") return;
    const txt = toPlainText(state.segments);
    downloadFile(txt, `${state.transcript.title || "transcript"}.txt`, "text/plain");
    showToast("Downloaded Plain Text (.txt)", "success");
  }

  function exportSrt() {
    if (state.status !== "ready") return;
    const srt = toSrt(state.segments);
    downloadFile(srt, `${state.transcript.title || "transcript"}.srt`, "text/plain");
    showToast("Downloaded Subtitles (.srt)", "success");
  }

  useEffect(() => {
    if (!id || id === "new" || id === "undefined") {
      router.replace("/new");
      return;
    }
    let cancelled = false;
    setState({ status: "loading" });

    void (async () => {
      try {
        const result = await api.getTranscript(id);
        if (!cancelled) {
          setState({
            status: "ready",
            transcript: result.transcript,
            segments: result.segments ?? [],
          });
        }
      } catch (error) {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 404) {
          router.replace("/new");
          return;
        }
        setState({ status: "error" });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [id, router]);

  useEffect(() => {
    if (!id || state.status !== "ready") return;
    const onTranscriptsChanged = async () => {
      try {
        await api.getTranscript(id);
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) {
          router.replace("/new");
        }
      }
    };
    window.addEventListener(TRANSCRIPTS_CHANGED, onTranscriptsChanged);
    return () => window.removeEventListener(TRANSCRIPTS_CHANGED, onTranscriptsChanged);
  }, [id, state.status, router]);

  if (state.status === "loading") {
    return (
      <main className="flex-1 space-y-4 px-4 py-6 md:px-8">
        <div className="h-5 w-40 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
        <div className="h-40 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-900" />
      </main>
    );
  }

  if (state.status === "missing" || state.status === "error") {
    return (
      <main className="flex flex-1 flex-col items-center justify-center px-6 text-center">
        <p className="text-sm font-medium">
          {state.status === "missing" ? "Transcript not found" : "Could not load this transcript"}
        </p>
        <p className="mt-1 text-xs text-slate-500">
          {state.status === "missing"
            ? "It may have been deleted from the sidebar."
            : "Check your connection and try again."}
        </p>
        <Link
          href="/new"
          className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-slate-700 underline underline-offset-4 dark:text-slate-300"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Back to workspace
        </Link>
      </main>
    );
  }

  const { transcript, segments } = state;
  const meta = [
    formatTranscriptDate(transcript.createdAt),
    formatDuration(transcript.durationMs),
    transcript.language ?? "Language auto",
    transcript.engine ? ENGINE_LABEL[transcript.engine] : "Engine not recorded",
  ];

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <header className="shrink-0 border-b border-slate-200 px-4 py-4 md:px-8 dark:border-slate-800">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Transcript</p>
            <h1 className="truncate text-lg font-semibold tracking-tight">{transcript.title}</h1>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{meta.join(" · ")}</p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-xs transition hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 cursor-pointer"
              title="Copy text"
            >
              {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
              <span>{copied ? "Copied" : "Copy"}</span>
            </button>

            <div className="relative">
              <button
                type="button"
                onClick={() => setExportOpen((o) => !o)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-xs transition hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 cursor-pointer"
              >
                <Download className="size-3.5" />
                <span>Export</span>
              </button>

              {exportOpen && (
                <div
                  onMouseLeave={() => setExportOpen(false)}
                  className="absolute right-0 top-full mt-1.5 z-20 w-44 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg dark:border-slate-800 dark:bg-slate-900"
                >
                  <button
                    type="button"
                    onClick={() => {
                      exportMarkdown();
                      setExportOpen(false);
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800 cursor-pointer"
                  >
                    <FileText className="size-3.5 text-slate-400" />
                    <span>Markdown (.md)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      exportTxt();
                      setExportOpen(false);
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800 cursor-pointer"
                  >
                    <FileText className="size-3.5 text-slate-400" />
                    <span>Plain Text (.txt)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      exportSrt();
                      setExportOpen(false);
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800 cursor-pointer"
                  >
                    <Subtitles className="size-3.5 text-slate-400" />
                    <span>Subtitles (.srt)</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 md:px-8">
        <div className="mx-auto max-w-3xl space-y-4">
          {transcript.audioAvailable ? (
            <AudioPlayer
              ref={playerRef}
              src={audioUrl(transcript.id)}
              durationMs={transcript.durationMs}
              onTimeUpdate={setCurrentTime}
            />
          ) : null}

          {segments.length > 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 shadow-xs dark:border-slate-800 dark:bg-slate-900/60">
              <p className="text-base sm:text-lg leading-relaxed text-slate-800 dark:text-slate-200">
                {segments.map((segment) => {
                  const currentMs = currentTime * 1000;
                  const isActive =
                    currentMs >= segment.startMs &&
                    currentMs <= Math.max(segment.startMs + 500, segment.endMs);
                  return (
                    <span
                      key={segment.id}
                      onClick={() => {
                        playerRef.current?.seek(segment.startMs / 1000);
                        playerRef.current?.play();
                      }}
                      className={cn(
                        "cursor-pointer rounded-xs px-0.5 transition-colors",
                        isActive
                          ? "bg-rose-100 font-medium text-rose-900 dark:bg-rose-950/60 dark:text-rose-200"
                          : "hover:bg-slate-100 dark:hover:bg-slate-800/60",
                      )}
                    >
                      {segment.text}{" "}
                    </span>
                  );
                })}
              </p>
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center dark:border-slate-700">
              <AudioLines className="mx-auto size-6 text-slate-400" aria-hidden />
              <p className="mt-3 text-sm font-medium">No speech captured yet</p>
              <p className="mx-auto mt-1 max-w-sm text-xs text-slate-500 dark:text-slate-400">
                {transcript.status === "failed"
                  ? "This recording ended before any audio arrived."
                  : "Speak while recording and segments appear here as they are recognized."}
              </p>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
