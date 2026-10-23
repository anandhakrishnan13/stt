import { env } from "../../env";
import { composeWhisperPrompt } from "./prompt";
import {
  cleanTranscript,
  extractWords,
  isHallucination,
  pcm16ToWav,
  SAMPLE_RATE,
  type Transcription,
  type VerbosePayload,
} from "./whisper";

export class SttRateLimitError extends Error {
  constructor(readonly retryAfterMs: number) {
    super("Groq rate limit reached");
    this.name = "SttRateLimitError";
  }
}

export async function transcribeGroq(
  pcm: Uint8Array,
  context?: string,
): Promise<Transcription> {
  const wav = pcm16ToWav(pcm);
  const form = new FormData();
  form.set("file", new File([wav], "window.wav", { type: "audio/wav" }));
  form.set("model", env.STT_GROQ_MODEL);
  form.set("response_format", "verbose_json");
  form.set("temperature", "0");
  form.set("timestamp_granularities[]", "word");
  if (env.STT_LANGUAGE) form.set("language", env.STT_LANGUAGE);
  const effectivePrompt = composeWhisperPrompt(env.STT_PROMPT, context);
  if (effectivePrompt) form.set("prompt", effectivePrompt);

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

  const payload = (await response.json()) as VerbosePayload;
  if (isHallucination(payload)) {
    return { text: "", language: null, words: [] };
  }
  const text = cleanTranscript(typeof payload.text === "string" ? payload.text : "");
  const durationMs = (pcm.byteLength / 2 / SAMPLE_RATE) * 1000;
  return {
    text,
    language:
      typeof payload.language === "string" ? payload.language.toLowerCase() : null,
    words: extractWords(payload, text, durationMs),
  };
}
