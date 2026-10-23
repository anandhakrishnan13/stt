import { env } from "../../env";
import { transcribeGemini } from "./gemini";
import { transcribeGroq } from "./groq";
import type { Transcription, Word } from "./whisper";

export { SttRateLimitError } from "./groq";
export type { Transcription, Word } from "./whisper";

export type SttEngine = "whisper" | "gemini";

export function transcribePcm(
  pcm: Uint8Array,
  prompt?: string,
  engine?: SttEngine | "groq",
): Promise<Transcription> {
  const selected = engine ?? env.STT_PROVIDER;
  if (selected === "gemini") return transcribeGemini(pcm, prompt);
  return transcribeGroq(pcm, prompt);
}
