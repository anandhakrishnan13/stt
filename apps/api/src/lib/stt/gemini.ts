import { env } from "../../env";
import { SttRateLimitError } from "./groq";
import {
  cleanTranscript,
  extractWords,
  pcm16ToWav,
  SAMPLE_RATE,
  type Transcription,
} from "./whisper";

export async function transcribeGemini(
  pcm: Uint8Array,
  prompt?: string,
): Promise<Transcription> {
  const wav = pcm16ToWav(pcm);
  const base64Audio = Buffer.from(wav).toString("base64");
  const effectivePrompt =
    prompt ??
    "Transcribe this audio verbatim in the original spoken language (Hindi, English, or mixed Hinglish). Output ONLY the transcribed words with no extra explanations or markdown.";

  const body = {
    contents: [
      {
        parts: [
          {
            inlineData: {
              mimeType: "audio/wav",
              data: base64Audio,
            },
          },
          {
            text: effectivePrompt,
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0,
    },
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${env.STT_GEMINI_MODEL}:generateContent?key=${env.GEMINI_API_KEY}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(env.GEMINI_TIMEOUT_MS),
  });

  if (response.status === 429) {
    const seconds = Number(response.headers.get("retry-after"));
    const retryAfterMs =
      Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 60_000;
    throw new SttRateLimitError(retryAfterMs);
  }

  if (!response.ok) {
    throw new Error(`Gemini returned ${response.status}`);
  }

  const payload = (await response.json()) as {
    candidates?: Array<{
      content?: {
        parts?: Array<{ text?: string }>;
      };
    }>;
  };

  const rawText = payload.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  const text = cleanTranscript(rawText);
  const durationMs = (pcm.byteLength / 2 / SAMPLE_RATE) * 1000;

  return {
    text,
    language: "auto",
    words: extractWords({}, text, durationMs),
  };
}
