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
  // Other audio containers passed via uploads (WebM, Ogg, MP3, MP4)
  if (pcm.byteLength >= 4 && pcm[0] === 0x1a && pcm[1] === 0x45 && pcm[2] === 0xdf && pcm[3] === 0xa3) {
    return pcm;
  }
  if (pcm.byteLength >= 4 && pcm[0] === 0x4f && pcm[1] === 0x67 && pcm[2] === 0x67 && pcm[3] === 0x53) {
    return pcm;
  }
  if (pcm.byteLength >= 3 && pcm[0] === 0x49 && pcm[1] === 0x44 && pcm[2] === 0x33) {
    return pcm;
  }
  if (pcm.byteLength >= 8 && pcm[4] === 0x66 && pcm[5] === 0x74 && pcm[6] === 0x79 && pcm[7] === 0x70) {
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

export const SILENCE_LANGUAGES = new Set(["icelandic", "is", "welsh", "cy", "latin", "la"]);

export const PHANTOM_PATTERNS = [
  /það er hann/i,
  /thadh er hann/i,
  /til því/i,
  /subtitles by/i,
  /amara\.org/i,
  /thank you for watching/i,
  /thanks for watching/i,
  /subscribe to/i,
  /watching!/i,
];

export function isPhantomPhrase(text: string): boolean {
  if (!text) return true;
  if (PHANTOM_PATTERNS.some((pattern) => pattern.test(text))) return true;
  if (/(.+?)(?:\s+\1){2,}/i.test(text)) return true;
  return false;
}

/**
 * The single normalization gate for every engine: strip non-speech markup,
 * reject phantom silence loops across all engines, and write Indic scripts in
 * chat-style Latin, whatever the model returned.
 */
export function normalizeTranscript(text: string): string {
  const cleaned = cleanTranscript(text);
  if (isPhantomPhrase(cleaned)) return "";
  return romanizeIndic(cleaned).replace(/\s+/g, " ").trim();
}

export type VerbosePayload = {
  text?: unknown;
  language?: unknown;
  duration?: unknown;
  words?: { word?: unknown; start?: unknown; end?: unknown }[];
  segments?: {
    words?: { word?: unknown; start?: unknown; end?: unknown }[];
    no_speech_prob?: unknown;
    avg_logprob?: unknown;
    compression_ratio?: unknown;
  }[];
};

/** Returns true when the transcription looks like silence hallucination or a repetition loop. */
export function isHallucination(payload: VerbosePayload): boolean {
  const text = typeof payload.text === "string" ? payload.text.trim() : "";
  if (!text || isPhantomPhrase(text)) return true;

  const lang = typeof payload.language === "string" ? payload.language.toLowerCase() : "";
  if (SILENCE_LANGUAGES.has(lang)) return true;
  const segs = payload.segments;
  if (!segs || segs.length === 0) return false;

  const avgNoSpeech =
    segs.reduce((sum, s) => sum + (typeof s.no_speech_prob === "number" ? s.no_speech_prob : 0), 0) /
    segs.length;
  if (avgNoSpeech > 0.45) return true;

  const lowConfidence = segs.some(
    (s) => typeof s.avg_logprob === "number" && s.avg_logprob < -0.9,
  );
  if (lowConfidence && avgNoSpeech > 0.3) return true;

  return false;
}
/** Word timings let the gateway trim exactly what it committed. */
export function extractWords(
  payload: VerbosePayload,
  text: string,
  durationMs: number,
): Word[] {
  const words: Word[] = [];
  const rawWords = payload.words ?? (payload.segments ?? []).flatMap((seg) => seg.words ?? []);
  for (const word of rawWords) {
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
