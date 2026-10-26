"use client";

import type { SegmentDTO, TranscriptDTO } from "@stt/shared";
import { ArrowLeft, AudioLines } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { showToast } from "@/components/ui/toast";
import { ApiError, api, audioUrl } from "@/lib/api";
import { AudioPlayer } from "@/components/workspace/audio-player";
import { ENGINE_LABEL, formatDuration, formatTranscriptDate, TRANSCRIPTS_CHANGED } from "@/lib/transcripts";

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

  useEffect(() => {
    if (!id) return;
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
          showToast("Transcription doesn't exist", "info");
          router.replace("/");
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
    if (!id) return;
    const onTranscriptsChanged = async () => {
      try {
        await api.getTranscript(id);
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) {
          showToast("Transcription doesn't exist", "info");
          router.replace("/");
        }
      }
    };
    window.addEventListener(TRANSCRIPTS_CHANGED, onTranscriptsChanged);
    return () => window.removeEventListener(TRANSCRIPTS_CHANGED, onTranscriptsChanged);
  }, [id, router]);

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
          href="/"
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
        <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Transcript</p>
        <h1 className="truncate text-lg font-semibold tracking-tight">{transcript.title}</h1>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{meta.join(" · ")}</p>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 md:px-8">
        <div className="mx-auto max-w-3xl space-y-4">
          {transcript.audioAvailable ? (
            <AudioPlayer
              src={audioUrl(transcript.id)}
              durationMs={transcript.durationMs}
            />
          ) : null}

          {segments.length > 0 ? (
            <section aria-label="Transcript" className="rounded-xl px-1 py-1">
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800 dark:text-slate-200">
                {segments
                  .map((segment) => segment.text.trim())
                  .filter(Boolean)
                  .join(" ")}
              </p>
            </section>
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
