/** `text` with every run of white space taken out, so a statement reads the same however it is laid out. */
export const tight = (text: string): string => text.replace(/\s+/g, "");

/** Whether `parts` stand in `text` in that order. */
export function inOrder(text: string, parts: readonly string[]): boolean {
  let at = 0;
  for (const part of parts) {
    const found = text.indexOf(part, at);
    if (found < 0) return false;
    at = found + part.length;
  }
  return true;
}
