import { env } from "../../env";
import { romanizeIndic } from "./romanize";

export const SAMPLE_RATE = 16_000;

export type Word = { text: string; startMs: number; endMs: number };

export type Transcription = { text: string; language: string | null; words: Word[] };

/** whisper-server expects a real WAV container, not raw PCM. */
export function pcm16ToWav(pcm: Uint8Array, sampleRate = SAMPLE_RATE): Uint8Array {
  if (
    pcm.byteLength >= 12 &&
    pcm[0] === 0x52 &&
    pcm[1] === 0x49 &&
    pcm[2] === 0x46 &&
    pcm[3] === 0x46 &&
    pcm[8] === 0x57 &&
    pcm[9] === 0x41 &&
    pcm[10] === 0x56 &&
    pcm[11] === 0x45
  ) {
    return pcm;
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + pcm.byteLength, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcm.byteLength, 40);
  return new Uint8Array(Buffer.concat([header, Buffer.from(pcm)]));
}

/** RMS on Int16 samples; used to skip silence, where Whisper likes to hallucinate. */
export function pcm16Rms(pcm: Uint8Array): number {
  if (pcm.byteLength < 2) return 0;
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const count = Math.floor(pcm.byteLength / 2);
  let sum = 0;
  for (let index = 0; index < count; index += 1) {
    const sample = view.getInt16(index * 2, true);
    sum += sample * sample;
  }
  return Math.sqrt(sum / count);
}

const NOISE_RE = /\[[^\]]*\]|\([^)]*\)|\*[^*]*\*/g;

export function cleanTranscript(text: string): string {
  return text
    .replace(NOISE_RE, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The single normalization gate for every engine: strip non-speech markup and
 * write Indic scripts in chat-style Latin, whatever the model returned.
 */
export function normalizeTranscript(text: string): string {
  return romanizeIndic(cleanTranscript(text)).replace(/\s+/g, " ").trim();
}

export type VerbosePayload = {
  text?: unknown;
  language?: unknown;
  duration?: unknown;
  segments?: {
    words?: { word?: unknown; start?: unknown; end?: unknown }[];
    no_speech_prob?: unknown;
  }[];
};

/** Returns true when all segments look like hallucination (high no-speech probability). */
export function isHallucination(payload: VerbosePayload): boolean {
  const segs = payload.segments;
  if (!segs || segs.length === 0) return false;
  return segs.every(
    (seg) => typeof seg.no_speech_prob === "number" && seg.no_speech_prob > 0.6,
  );
}

/** Word timings let the gateway trim exactly what it committed. */
export function extractWords(
  payload: VerbosePayload,
  text: string,
  durationMs: number,
): Word[] {
  const words: Word[] = [];
  for (const segment of payload.segments ?? []) {
    for (const word of segment.words ?? []) {
      const value = typeof word.word === "string" ? normalizeTranscript(word.word) : "";
      if (!value) continue;
      const start = typeof word.start === "number" ? word.start : null;
      const end = typeof word.end === "number" ? word.end : null;
      words.push({
        text: value,
        startMs: Math.round((start ?? 0) * 1000),
        endMs: Math.round((end ?? start ?? 0) * 1000),
      });
    }
  }
  if (words.length > 0) return words;

  // Fallback when the server omits word timings: spread the text evenly.
  const tokens = text.split(" ").filter(Boolean);
  const step = tokens.length > 0 ? durationMs / tokens.length : 0;
  return tokens.map((token, index) => ({
    text: token,
    startMs: Math.round(index * step),
    endMs: Math.round((index + 1) * step),
  }));
}
