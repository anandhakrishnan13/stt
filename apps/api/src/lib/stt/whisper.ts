import { normalizeTranscript, isPhantomPhrase, wordsFromText, type Word } from "./audio";

/**
 * Groq's Whisper wire format. Only the Groq adapter may import this file: the
 * functions below read `verbose_json` fields (`segments[].no_speech_prob`,
 * `avg_logprob`) that no other engine returns, and the language list is
 * Whisper's own silence artefact. Shared audio helpers live in `audio.ts`.
 */

export const SILENCE_LANGUAGES = new Set(["icelandic", "is", "welsh", "cy", "latin", "la"]);

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

  // The server omitted word timings: spread the text across the window.
  return wordsFromText(text, durationMs);
}
