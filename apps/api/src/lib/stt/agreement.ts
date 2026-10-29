import type { Word } from "./audio";

export function normalizeWord(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");
}

/** Word-level longest common prefix; the two hypotheses must agree word for word. */
export function commonPrefix(left: Word[], right: Word[]): number {
  let index = 0;
  while (index < left.length && index < right.length) {
    const a = normalizeWord(left[index]?.text ?? "");
    const b = normalizeWord(right[index]?.text ?? "");
    if (!a || a !== b) break;
    index += 1;
  }
  return index;
}

export function joinWords(words: Word[]): string {
  return words
    .map((word) => word.text)
    .join(" ")
    .replace(/\s+([,.!?;:…])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}
