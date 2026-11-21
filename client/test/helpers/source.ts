import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const GAME = fileURLToPath(new URL("../../src/", import.meta.url));
const ENGINE = fileURLToPath(new URL("../../../engine/src/", import.meta.url));

/**
 * The text of a module by its path under `src/` (`game/quality.ts`), whichever package holds
 * it: a module keeps its path when it moves from the game to the engine, so a test that reads
 * one by name reads it wherever it is.
 */
export function sourceText(path: string): string {
  const own = GAME + path;
  return readFileSync(existsSync(own) ? own : ENGINE + path, "utf8");
}
