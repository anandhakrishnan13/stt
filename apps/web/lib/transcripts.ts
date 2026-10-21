import type { TranscriptDTO } from "@stt/shared";

const DAY_MS = 86_400_000;

/** Fired after a recording is saved or discarded so the sidebar refetches. */
export const TRANSCRIPTS_CHANGED = "stt:transcripts-changed";

export function displayName(firstName: string, lastName: string): string {
  return `${firstName} ${lastName}`.trim();
}

export function initials(firstName: string, lastName: string): string {
  return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
}

export function formatTranscriptDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** m:ss for the live recording timer. */
export function formatClock(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function formatDuration(durationMs: number): string {
  if (durationMs <= 0) return "0s";
  const totalSeconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

export const ENGINE_LABEL: Record<NonNullable<TranscriptDTO["engine"]>, string> = {
  "gemini-live": "Gemini Live",
  "whisper-local": "Whisper (local)",
  "groq-whisper": "Whisper (Groq)",
};

export type TranscriptGroup = { label: string; items: TranscriptDTO[] };

/** Newest first, bucketed the way chat sidebars do it. */
export function groupTranscripts(items: TranscriptDTO[], now = new Date()): TranscriptGroup[] {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const buckets: TranscriptGroup[] = [
    { label: "Today", items: [] },
    { label: "Yesterday", items: [] },
    { label: "Previous 7 days", items: [] },
    { label: "Older", items: [] },
  ];

  for (const item of items) {
    const created = new Date(item.createdAt).getTime();
    if (created >= startOfToday) buckets[0]?.items.push(item);
    else if (created >= startOfToday - DAY_MS) buckets[1]?.items.push(item);
    else if (created >= startOfToday - 7 * DAY_MS) buckets[2]?.items.push(item);
    else buckets[3]?.items.push(item);
  }

  return buckets.filter((bucket) => bucket.items.length > 0);
}
