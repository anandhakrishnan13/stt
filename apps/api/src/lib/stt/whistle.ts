import { env } from "../../env";
import { SttRateLimitError } from "./groq";
import {
  extractWords,
  normalizeTranscript,
  pcm16ToWav,
  SAMPLE_RATE,
  type Transcription,
} from "./whisper";

export async function transcribeWhistle(
  pcm: Uint8Array,
  _prompt?: string,
): Promise<Transcription> {
  const wav = pcm16ToWav(pcm);
  const form = new FormData();
  form.append("audio", new File([wav], "audio.wav", { type: "audio/wav" }));

  const headers: Record<string, string> = {};
  if (env.WHISTLE_API_KEY) {
    headers["x-api-key"] = env.WHISTLE_API_KEY;
  }

  const response = await fetch(env.WHISTLE_URL, {
    method: "POST",
    headers,
    body: form,
    signal: AbortSignal.timeout(env.WHISTLE_TIMEOUT_MS),
  });

  if (response.status === 429) {
    const seconds = Number(response.headers.get("retry-after"));
    const retryAfterMs =
      Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 60_000;
    throw new SttRateLimitError(retryAfterMs);
  }

  if (response.status === 401) {
    throw new Error("Invalid Whistle API key. Check WHISTLE_API_KEY in environment variables.");
  }

  if (!response.ok) {
    throw new Error(`Whistle STT returned ${response.status}`);
  }

  const payload = (await response.json()) as Record<string, unknown>;
  const rawText =
    typeof payload.text === "string"
      ? payload.text
      : typeof payload.transcription === "string"
        ? payload.transcription
        : "";
  const text = normalizeTranscript(rawText);
  const durationMs = (pcm.byteLength / 2 / SAMPLE_RATE) * 1000;

  return {
    text,
    language: typeof payload.language === "string" ? payload.language.toLowerCase() : "auto",
    words: extractWords(payload, text, durationMs),
  };
}
