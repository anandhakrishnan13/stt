import { env } from "../../env";
import { transcribeGroq } from "./groq";
import {
  transcribePcm as transcribeWhisper,
  type Transcription,
} from "./whisper";

export { SttRateLimitError } from "./groq";
export type { Transcription, Word } from "./whisper";

export function transcribePcm(
  pcm: Uint8Array,
  prompt?: string,
): Promise<Transcription> {
  if (env.STT_PROVIDER === "groq") return transcribeGroq(pcm, prompt);
  return transcribeWhisper(pcm, prompt);
}
