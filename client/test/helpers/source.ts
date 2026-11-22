import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const GAME = fileURLToPath(new URL("../../src/", import.meta.url));

/**
 * The text of one of Day Hike's own modules by its path under `src/` (`hike.ts`). The engine's modules are
 * read by the engine's own suite (`engine/test/helpers/source.ts`), never from here.
 */
export function sourceText(path: string): string {
  return readFileSync(GAME + path, "utf8");
}
