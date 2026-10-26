"use client";

import type { TranscriptDTO } from "@stt/shared";
import { AudioLines, Mic, Pencil, Plus, Search, Settings, Trash2 } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { showToast } from "@/components/ui/toast";
import { ChangePasswordDialog } from "@/components/change-password-dialog";
import { SettingsDialog } from "@/components/workspace/settings-dialog";
import {
  DeleteTranscriptDialog,
  RenameTranscriptDialog,
} from "@/components/workspace/transcript-dialogs";
import { useSession } from "@/lib/session";
import { displayName, groupTranscripts, initials, TRANSCRIPTS_CHANGED } from "@/lib/transcripts";
import { useTranscripts } from "@/lib/use-transcripts";
import { cn } from "@/lib/utils";

function SkeletonRows() {
  return (
    <div className="space-y-1" aria-hidden>
      {[0, 1, 2].map((row) => (
        <div
          key={row}
          className="h-8 animate-pulse rounded-lg bg-slate-200/70 dark:bg-slate-800/70"
        />
      ))}
    </div>
  );
}

function TranscriptRow({
  transcript,
  active,
  onNavigate,
  onRename,
  onDelete,
}: {
  transcript: TranscriptDTO;
  active: boolean;
  onNavigate?: () => void;
  onRename: (transcript: TranscriptDTO) => void;
  onDelete: (transcript: TranscriptDTO) => void;
}) {
  return (
    <div className="group/item relative">
      <Link
        href={`/t/${transcript.id}`}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex h-9 items-center rounded-lg px-2 pr-16 text-sm transition-colors",
          active
            ? "bg-slate-200/90 font-medium text-slate-900 dark:bg-slate-800 dark:text-slate-100"
            : "text-slate-700 hover:bg-slate-200/60 dark:text-slate-300 dark:hover:bg-slate-800/60",
        )}
      >
        <Mic className="mr-2 size-3.5 shrink-0 text-slate-400" aria-hidden />
        <span className="truncate">{transcript.title}</span>
      </Link>
      <div className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/item:opacity-100 [@media(hover:none)]:opacity-100">
        <button
          type="button"
          aria-label={`Rename ${transcript.title}`}
          onClick={() => onRename(transcript)}
          className="rounded-md p-1.5 text-slate-500 transition hover:bg-slate-300/70 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-100"
        >
          <Pencil className="size-3.5" aria-hidden />
        </button>
        <button
          type="button"
          aria-label={`Delete ${transcript.title}`}
          onClick={() => onDelete(transcript)}
          className="rounded-md p-1.5 text-slate-500 transition hover:bg-red-100 hover:text-red-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400 dark:hover:bg-red-500/20 dark:hover:text-red-400"
        >
          <Trash2 className="size-3.5" aria-hidden />
        </button>
      </div>
    </div>
  );
}

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { user } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<TranscriptDTO | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TranscriptDTO | null>(null);

  const { items, loading, error, refresh, rename, remove } = useTranscripts(query);
  const groups = groupTranscripts(items);
  const search = query.trim();

  function onDeleted(id: string) {
    remove(id);
    window.dispatchEvent(new Event(TRANSCRIPTS_CHANGED));
    showToast("Transcript deleted", "info");
    if (pathname === `/t/${id}` || pathname.startsWith(`/t/${id}`)) {
      router.replace("/");
    }
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col border-r border-slate-200 bg-slate-100/80 dark:border-slate-800 dark:bg-slate-900/70">
      <Link
        href="/"
        onClick={onNavigate}
        className="flex items-center gap-2 px-3 py-3 transition hover:opacity-80"
      >
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900">
          <AudioLines className="size-4" aria-hidden />
        </span>
        <span className="truncate text-sm font-semibold tracking-tight">Speech to Text</span>
      </Link>

      <div className="px-2">
        <Link
          href="/"
          onClick={onNavigate}
          className="flex h-10 w-full items-center gap-2 rounded-lg bg-slate-900 px-3 text-sm font-medium text-white transition hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white dark:focus-visible:ring-offset-slate-900"
        >
          <Plus className="size-4" aria-hidden />
          New transcription
        </Link>
      </div>

      <div className="px-2 pb-1 pt-3">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-slate-400"
            aria-hidden
          />
          <label htmlFor="transcript-search" className="sr-only">
            Search transcripts
          </label>
          <input
            id="transcript-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search transcripts"
            className="h-8 w-full rounded-md border border-transparent bg-slate-200/60 pl-8 pr-2 text-xs text-slate-900 outline-none transition placeholder:text-slate-500 focus:border-slate-300 focus:bg-white dark:bg-slate-800/60 dark:text-slate-100 dark:focus:border-slate-700 dark:focus:bg-slate-900"
          />
        </div>
      </div>

      <nav aria-label="Transcript history" className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {loading ? <SkeletonRows /> : null}

        {!loading && error ? (
          <div className="rounded-lg border border-red-200 p-2 text-xs text-red-700 dark:border-red-500/30 dark:text-red-400">
            {error}
            <button
              type="button"
              onClick={refresh}
              className="mt-1 block font-medium underline underline-offset-2"
            >
              Retry
            </button>
          </div>
        ) : null}

        {!loading && !error && items.length === 0 ? (
          <p className="px-2 py-3 text-xs text-slate-500 dark:text-slate-400">
            {search ? `No matches for “${search}”.` : "No transcripts yet."}
          </p>
        ) : null}

        {groups.map((group) => (
          <div key={group.label} className="pt-3 first:pt-1">
            <p className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-slate-400">
              {group.label}
            </p>
            <div className="space-y-0.5">
              {group.items.map((transcript) => (
                <TranscriptRow
                  key={transcript.id}
                  transcript={transcript}
                  active={pathname === `/t/${transcript.id}`}
                  onNavigate={onNavigate}
                  onRename={setRenameTarget}
                  onDelete={setDeleteTarget}
                />
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-slate-200/80 p-2 dark:border-slate-800">
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          aria-label={user ? `Account settings for ${displayName(user.firstName, user.lastName)}` : "Account settings"}
          className="flex w-full items-center gap-2 rounded-lg p-2 text-left transition hover:bg-slate-200/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 dark:hover:bg-slate-800/70"
        >
          <span
            aria-hidden
            className="grid size-8 shrink-0 place-items-center rounded-full bg-slate-900 text-[11px] font-semibold text-white dark:bg-slate-100 dark:text-slate-900"
          >
            {user ? initials(user.firstName, user.lastName) : "··"}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">
              {user ? displayName(user.firstName, user.lastName) : "Account"}
            </span>
            <span className="block truncate text-[11px] text-slate-500 dark:text-slate-400">
              {user?.email ?? "Signed out"}
            </span>
          </span>
          <Settings className="size-4 text-slate-500" aria-hidden />
        </button>
      </div>

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        onChangePassword={() => setPasswordOpen(true)}
      />
      <ChangePasswordDialog open={passwordOpen} onOpenChange={setPasswordOpen} />
      <RenameTranscriptDialog
        transcript={renameTarget}
        onClose={() => setRenameTarget(null)}
        onRenamed={rename}
      />
      <DeleteTranscriptDialog
        transcript={deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onDeleted={onDeleted}
      />
    </div>
  );
}
