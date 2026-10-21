"use client";

import { Mic } from "lucide-react";

export function Composer() {
  return (
    <div className="mx-auto w-full max-w-3xl shrink-0 px-4 pb-5">
      <div className="rounded-[26px] border border-slate-200 bg-white p-2 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-end gap-2 px-2">
          <label htmlFor="spoken-input" className="sr-only">
            Spoken input
          </label>
          <textarea
            id="spoken-input"
            rows={1}
            disabled
            aria-describedby="composer-note"
            placeholder="Speak in Hindi, English, or both…"
            className="max-h-32 min-h-10 flex-1 resize-none bg-transparent py-2 text-sm outline-none placeholder:text-slate-400 disabled:cursor-not-allowed dark:placeholder:text-slate-500"
          />
          <button
            type="button"
            disabled
            aria-label="Start recording"
            title="Recording connects with the audio pipeline"
            className="mb-1 grid size-9 shrink-0 place-items-center rounded-full bg-slate-900 text-white transition disabled:cursor-not-allowed disabled:opacity-35 dark:bg-slate-100 dark:text-slate-900"
          >
            <Mic className="size-4" aria-hidden />
          </button>
        </div>
        <p
          id="composer-note"
          className="flex items-center justify-between gap-3 px-3 pb-1 text-[11px] text-slate-500 dark:text-slate-400"
        >
          <span>16 kHz PCM · Gemini Live</span>
          <span>Audio capture is not wired yet</span>
        </p>
      </div>
    </div>
  );
}
