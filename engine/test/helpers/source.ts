import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("../../src/", import.meta.url));

/** The text of one of the engine's modules by its path under `src/` (`game/quality.ts`). */
export function sourceText(path: string): string {
  return readFileSync(SRC + path, "utf8");
}
