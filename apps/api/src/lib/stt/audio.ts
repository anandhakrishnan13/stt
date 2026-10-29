import { romanizeIndic } from "./romanize";

/**
 * Engine-agnostic audio helpers. Everything here is shared by Groq, Gemini and
 * Whistle; nothing in this file may assume a Whisper wire format or Whisper
 * failure modes. Whisper-specific parsing lives in `whisper.ts`.
 */

export const SAMPLE_RATE = 16_000;

export type Word = { text: string; startMs: number; endMs: number };

export type Transcription = { text: string; language: string | null; words: Word[] };

/** Whisper servers and the Whistle API both want a real WAV container, not raw PCM. */
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
  // Uploads arrive in other containers; WebM, Ogg, MP3 and MP4 are passed through.
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

/** RMS on Int16 samples; used to skip silence, where every engine likes to hallucinate. */
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

/**
 * Duration of a 16 kHz mono Int16 buffer. Only correct for raw PCM; uploads in
 * a compressed container must not be measured this way.
 */
export function pcm16DurationMs(pcm: Uint8Array): number {
  return (pcm.byteLength / 2 / SAMPLE_RATE) * 1_000;
}

const NOISE_RE = /\[[^\]]*\]|\([^)]*\)|\*[^*]*\*/g;

export function cleanTranscript(text: string): string {
  return text
    .replace(NOISE_RE, " ")
    .replace(/\s+/g, " ")
    .trim();
}

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
 * Whisper-family models caption short, quiet windows with stock phrases
 * ("Thank you.", "Let's just do it.", "Hello and welcome."). Those words are
 * also real speech, so they are only rejected when the window carries no
 * speech-level energy - see the gate in routes/stream.ts.
 */
const BOILERPLATE_PHRASES: Record<string, true> = {
  "thank you": true,
  thanks: true,
  "thank you very much": true,
  "thank you so much": true,
  "thanks for your attention": true,
  hello: true,
  "hello and welcome": true,
  "hi and welcome": true,
  "let's just do it": true,
  "lets just do it": true,
  "just do it": true,
  okay: true,
  ok: true,
  bye: true,
  goodbye: true,
  "see you next time": true,
  "please subscribe": true,
  you: true,
  hmm: true,
  "mm hmm": true,
  so: true,
};

/** True when the whole transcript is caption boilerplate and nothing else. */
export function isBoilerplatePhrase(text: string): boolean {
  const fragments = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, "|")
    .split("|")
    .map((fragment) => fragment.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  if (fragments.length === 0) return false;
  return fragments.every((fragment) => Object.hasOwn(BOILERPLATE_PHRASES, fragment));
}

/**
 * The single normalization gate for every engine: strip non-speech markup,
 * reject phantom silence loops, and write Indic scripts in chat-style Latin,
 * whatever the model returned.
 */
export function normalizeTranscript(text: string): string {
  const cleaned = cleanTranscript(text);
  if (isPhantomPhrase(cleaned)) return "";
  return romanizeIndic(cleaned).replace(/\s+/g, " ").trim();
}

/**
 * Timing the engines do not supply. Spread evenly across the window so the
 * gateway can still trim what it committed; this is an estimate, not a
 * measurement, and must never be used as the audio's real duration.
 */
export function wordsFromText(text: string, durationMs: number): Word[] {
  const tokens = text.split(" ").filter(Boolean);
  const step = tokens.length > 0 ? durationMs / tokens.length : 0;
  return tokens.map((token, index) => ({
    text: token,
    startMs: Math.round(index * step),
    endMs: Math.round((index + 1) * step),
  }));
}
