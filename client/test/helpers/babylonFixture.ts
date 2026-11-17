/**
 * What Babylon.js gave, recorded once: the text of its own shaders, the
 * numbers its own arithmetic and mesh builders made, and what the game's
 * shells on it declared, each read from Babylon.js as the tests ran it and
 * written under `test/fixtures/babylon/`. A test holds the game's own
 * module to the record at the tolerance it held it to Babylon.js itself,
 * and loads no Babylon.js to do so.
 *
 * Every file's first line says which Babylon.js and which call produced
 * it. A text's record is that line and then the text as it was; a record of
 * values is one JSON object, its `from` on the first line, every number
 * written so that it reads back as the same double (a negative zero too).
 */
import { readFileSync } from "node:fs";

const read = (name: string): string => readFileSync(new URL(`../fixtures/babylon/${name}`, import.meta.url), "utf8");

/** The text recorded as `name`, without the line that says where it came from. */
export function babylonText(name: string): string {
  const text = read(name);
  const head = text.indexOf("\n");
  if (!text.startsWith("// ") || head < 0) throw new Error(`${name} does not begin with the line that says what produced it`);
  return text.slice(head + 1);
}

/** The values recorded as `name`. */
export function babylonValues<T>(name: string): T {
  const record = JSON.parse(read(name)) as { from?: unknown };
  if (typeof record.from !== "string" || !record.from.includes("Babylon.js")) throw new Error(`${name} does not say what produced it`);
  return record as T;
}
