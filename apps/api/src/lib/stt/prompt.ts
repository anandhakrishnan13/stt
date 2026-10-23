/**
 * Speech-to-text prompts.
 *
 * Gemini reads the text part as instructions, so it gets explicit script rules
 * and few-shot examples. Whisper treats its prompt as prior text rather than as
 * a command, so it only gets a short Roman-Hinglish sample plus the previous
 * transcript. Both keep the instruction even when context is present; passing
 * the previous transcript alone used to replace the instruction entirely.
 */

export const GEMINI_STT_INSTRUCTION = [
  "Transcribe the audio verbatim.",
  "Write Hindi words in Roman script (Latin letters), the way Hindi speakers type Hinglish in chat. Never output Devanagari.",
  "Keep English words in English.",
  "Do not translate, correct grammar, normalize spelling, or add commentary.",
  "Output only the transcript.",
  'Examples: "kal mujhe meeting hai at five" -> kal mujhe meeting hai at five; "yaar ye report bahut accha hai" -> yaar ye report bahut accha hai.',
].join(" ");

/** Roman-Hinglish sample fed as prior text so Whisper mirrors its script. */
export const WHISPER_STT_PROMPT =
  "kal mujhe meeting hai at five. yaar ye report bahut accha hai.";

export function composeSttPrompt(instruction: string, context?: string): string {
  const base = instruction.trim();
  const prior = context?.trim();
  if (!prior) return base;
  return `${base}\n\nPrevious transcript:\n${prior}`;
}

export function composeWhisperPrompt(style: string, context?: string): string {
  return [style.trim(), context?.trim()].filter(Boolean).join(" ");
}
