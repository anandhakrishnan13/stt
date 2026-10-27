import { env } from "../../env";
import { composeWhisperPrompt } from "./prompt";
import {
  extractWords,
  isHallucination,
  normalizeTranscript,
  pcm16ToWav,
  SAMPLE_RATE,
  SILENCE_LANGUAGES,
  type Transcription,
  type VerbosePayload,
} from "./whisper";

export class SttRateLimitError extends Error {
  constructor(readonly retryAfterMs: number) {
    super("Groq rate limit reached");
    this.name = "SttRateLimitError";
  }
}
async function postGroq(form: FormData): Promise<VerbosePayload> {
  const response = await fetch(
    `${env.GROQ_BASE_URL.replace(/\/+$/, "")}/audio/transcriptions`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${env.GROQ_API_KEY}` },
      body: form,
      signal: AbortSignal.timeout(env.GROQ_TIMEOUT_MS),
    },
  );

  if (response.status === 429) {
    const seconds = Number(response.headers.get("retry-after"));
    const retryAfterMs =
      Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 60_000;
    throw new SttRateLimitError(retryAfterMs);
  }
  if (!response.ok) {
    throw new Error(`Groq returned ${response.status}`);
  }

  return (await response.json()) as VerbosePayload;
}

export async function transcribeGroq(
  pcm: Uint8Array,
  context?: string,
  language?: string | null,
): Promise<Transcription> {
  const wav = pcm16ToWav(pcm);
  const form = new FormData();
  form.set("file", new File([wav], "window.wav", { type: "audio/wav" }));
  form.set("model", env.STT_GROQ_MODEL);
  form.set("response_format", "verbose_json");
  form.set("temperature", "0");
  form.set("timestamp_granularities[]", "word");
  const targetLanguage =
    env.STT_LANGUAGE ||
    (language && !SILENCE_LANGUAGES.has(language.toLowerCase()) ? language : undefined);
  if (targetLanguage) form.set("language", targetLanguage);
  const effectivePrompt = composeWhisperPrompt(env.STT_PROMPT, context?.slice(-100));
  if (effectivePrompt) form.set("prompt", effectivePrompt);

  const payload = await postGroq(form);
  if (isHallucination(payload)) {
    return { text: "", language: null, words: [] };
  }
  const text = normalizeTranscript(typeof payload.text === "string" ? payload.text : "");
  const durationMs = (pcm.byteLength / 2 / SAMPLE_RATE) * 1000;
  return {
    text,
    language:
      typeof payload.language === "string" ? payload.language.toLowerCase() : null,
    words: extractWords(payload, text, durationMs),
  };
}

export async function transcribeAudioBuffer(
  buffer: Uint8Array,
  mimeType: string,
  filename = "audio.wav",
  context?: string,
): Promise<Transcription> {
  const form = new FormData();
  form.set("file", new File([buffer], filename, { type: mimeType }));
  form.set("model", env.STT_GROQ_MODEL);
  form.set("response_format", "verbose_json");
  form.set("temperature", "0");
  form.set("timestamp_granularities[]", "word");
  if (env.STT_LANGUAGE) form.set("language", env.STT_LANGUAGE);
  const effectivePrompt = composeWhisperPrompt(env.STT_PROMPT, context);
  if (effectivePrompt) form.set("prompt", effectivePrompt);

  const payload = await postGroq(form);
  const text = normalizeTranscript(typeof payload.text === "string" ? payload.text : "");
  const durationSec = Number(payload.duration) || 0;
  return {
    text,
    language:
      typeof payload.language === "string" ? payload.language.toLowerCase() : null,
    words: extractWords(payload, text, durationSec * 1000),
  };
}
