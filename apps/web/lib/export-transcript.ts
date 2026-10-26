import type { SegmentDTO, TranscriptDTO } from "@stt/shared";
import { formatClock, formatTranscriptDate } from "./transcripts";

export function toPlainText(segments: SegmentDTO[]): string {
  return segments
    .map((s) => s.text.trim())
    .filter(Boolean)
    .join("\n\n");
}

export function toMarkdown(transcript: TranscriptDTO, segments: SegmentDTO[]): string {
  const lines: string[] = [
    `# ${transcript.title}`,
    "",
    `- **Date**: ${formatTranscriptDate(transcript.createdAt)}`,
    `- **Duration**: ${formatClock(transcript.durationMs)}`,
    `- **Language**: ${transcript.language ?? "Auto"}`,
    "",
    "---",
    "",
    "## Transcript",
    "",
  ];

  for (const seg of segments) {
    lines.push(`**[${formatClock(seg.startMs)}]** ${seg.text.trim()}`);
    lines.push("");
  }

  return lines.join("\n");
}

function formatSrtTimestamp(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const milliseconds = ms % 1000;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const pad = (n: number, z = 2) => String(n).padStart(z, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)},${pad(milliseconds, 3)}`;
}

export function toSrt(segments: SegmentDTO[]): string {
  return segments
    .map((seg, idx) => {
      const index = idx + 1;
      const start = formatSrtTimestamp(seg.startMs);
      const end = formatSrtTimestamp(Math.max(seg.startMs + 500, seg.endMs));
      return `${index}\n${start} --> ${end}\n${seg.text.trim()}\n`;
    })
    .join("\n");
}

export function downloadFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
