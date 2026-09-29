/**
 * What identifies a WGSL translation: the key of a stage and the salt it is
 * made under (`shaderLookup.ts`); and the two forms that carry translations
 * made ahead: a recording of the GLSL stages the build translates, merged
 * into the corpus (`tools/wgsl/`), and the map, their WGSL under their keys,
 * which the page fetches. Nothing here imports Babylon or the DOM, so the build's tools load
 * it under Node and key a stage with the very code the page keys it with.
 */
import { sha256Hex } from "./sha256.js";

/** The format of the key and of what is stored under it. A change to how
 * the key is made, or to what is stored for a key (the text composed for the
 * first translator, `translatorInput`; the translation, `translate` in
 * `lookUpShaders`; the packing, `pack` in `wgslStore.ts`) bumps it, so that
 * no entry made the old way is reachable; `shaderLookup.test.ts` pins the
 * three by their text beside it. */
export const LOOKUP_FORMAT = "dayhike-wgsl/1";

/** What Babylon 9.18 puts before a non-raw stage's defines and code
 * (`_compilePipelineStageDescriptor`, webgpuEngine.pure.js). */
const VERSION_PREFIX = "#version 450\n";
/** The define a stage turns Tint's uniformity analysis off with. */
const UNIFORMITY_OFF = "#define DISABLE_UNIFORMITY_ANALYSIS";

export type Stage = "vertex" | "fragment";

/** The salt: the key's format, Babylon's version (it owns the text around
 * the code and the diagnostic before the WGSL), the translators' own bytes'
 * digests, their WebAssembly and their loaders (`__WGSL_TRANSLATORS__`,
 * computed by the build), and Babylon's page-wide uniformity switch, which
 * no text shows. */
export function lookupSalt(parts: { babylon: string; translators: string; staticUniformityOff: boolean }): string {
  return `${LOOKUP_FORMAT}|babylon=${parts.babylon}|${parts.translators}|staticUA=${parts.staticUniformityOff}`;
}

/** The text Babylon 9.18 hands the first translator for one stage of a
 * non-raw GLSL effect: `_compilePipelineStageDescriptor` passes its version
 * line to `_compileShaderToSpirV`, which puts it and the defines before the
 * code. */
export function translatorInput(code: string, defines: string | null): string {
  return VERSION_PREFIX + (defines ? defines + "\n" : "") + code;
}

/** Whether a stage turns Tint's uniformity analysis off, read as Babylon 9.18
 * reads it: from the processed code, not the defines. */
export function uniformityOff(code: string): boolean {
  return code.indexOf(UNIFORMITY_OFF) >= 0;
}

const encoder = new TextEncoder();
const SEPARATOR = new Uint8Array([0]);

/** A stage's key: SHA-256 over the salt, the stage, its uniformity switch and
 * the exact text the first translator is handed, each apart by a zero byte. */
export function stageKey(salt: string, stage: Stage, flag: boolean, glsl: string): string {
  return sha256Hex(
    encoder.encode(salt),
    SEPARATOR,
    encoder.encode(stage),
    SEPARATOR,
    encoder.encode(flag ? "1" : "0"),
    SEPARATOR,
    encoder.encode(glsl),
  );
}

/** The format of a recording: the JSON a page opened with `?wgsl=record`
 * downloads, which `tools/wgsl/merge-corpus.mjs` reads. It is how a
 * recording travels, and it is never committed: the committed corpus is one
 * shader file a stage, its bytes the stage's text
 * (`tools/wgsl/lib/corpus.mjs`). */
export const CORPUS_FORMAT = "dayhike-wgsl-corpus/1";

/** One stage of the corpus: what the recorder keeps of it that decides its
 * WGSL (`StageRecord`'s `stage`, `flag` and `glsl`). */
export type CorpusStage = { stage: Stage; flag: boolean; glsl: string };

/** A corpus stage's name, the same under every build: its key with an empty
 * salt. A recording is sorted and deduplicated by it, and the committed
 * corpus names each stage's file by its first 16 digits. */
export function corpusId(entry: CorpusStage): string {
  return stageKey("", entry.stage, entry.flag, entry.glsl);
}

/**
 * A recording: `{"format": CORPUS_FORMAT, "stages": [...]}`, each stage
 * once, sorted by `corpusId`, one stage a line. What the recorder downloads
 * (one file, which a browser can save), and what
 * `tools/wgsl/merge-corpus.mjs` reads and writes into the corpus's files.
 */
export function corpusText(stages: Iterable<CorpusStage>): string {
  const byId = new Map<string, CorpusStage>();
  for (const { stage, flag, glsl } of stages) {
    const entry = { stage, flag, glsl };
    byId.set(corpusId(entry), entry);
  }
  const lines = [...byId].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, entry]) => JSON.stringify(entry));
  const body = lines.length === 0 ? "" : `\n${lines.join(",\n")}\n`;
  return `{"format":${JSON.stringify(CORPUS_FORMAT)},"stages":[${body}]}\n`;
}

/** The stages of a recording; throws on another format, or on anything
 * that is not one. */
export function readCorpus(text: string): CorpusStage[] {
  const file = JSON.parse(text) as { format?: unknown; stages?: unknown };
  if (file?.format !== CORPUS_FORMAT) throw new Error(`not a corpus of ${CORPUS_FORMAT}: ${String(file?.format)}`);
  if (!Array.isArray(file.stages)) throw new Error("a corpus without stages");
  return file.stages.map((value: unknown) => {
    const entry = value as Partial<CorpusStage> | null;
    if (
      (entry?.stage !== "vertex" && entry?.stage !== "fragment") ||
      typeof entry.flag !== "boolean" ||
      typeof entry.glsl !== "string"
    ) {
      throw new Error("a corpus stage without its stage, flag or text");
    }
    return { stage: entry.stage, flag: entry.flag, glsl: entry.glsl };
  });
}

/** The format of the map the build ships. */
export const MAP_FORMAT = "dayhike-wgsl-map/2";

/** The most a map may be, in bytes of text: 8 MiB. The page parses it in one
 * task on its thread and holds its lines for the engine's life; the build
 * refuses a larger one (`tools/wgsl/build-map.mjs`), and the page one that
 * reads past it, before it is parsed (`loadWgslMap`). Set from the map the
 * recorded corpus makes: 5,073,415 bytes for 522 entries, about 9,700 bytes
 * an entry, so it holds about 860 entries at that average (more, since a new
 * entry's lines are mostly in the table already). A corpus whose union would
 * pass it is split into a map per platform, not given a higher ceiling. */
export const MAP_MAX_BYTES = 8_388_608;

/** The most characters one entry of a map may expand to: 8,388,608, 45
 * times the largest real entry (184,166). A map past the file's ceiling was
 * the most one entry could be when each entry was stored whole; now a file
 * under it could name one long line enough times to make a string past what
 * the page can hold, so `readMap` reckons each entry's length from its runs
 * and refuses the map whole where one passes this. */
export const MAP_ENTRY_MAX_CHARS = 8_388_608;

/**
 * The map: `{"format": MAP_FORMAT, "salt": ..., "lines": [...], "entries":
 * {key: [start, length, ...]}}`. `lines` holds every distinct line of the
 * entries' WGSL once (a line is what `split("\n")` gives, so a text that ends
 * in a newline ends in an empty line), in order of first appearance over the
 * entries taken in ascending order of key; each entry is its lines as runs of
 * consecutive indices into `lines`, each run as long as it can be. Joining an
 * entry's lines with `"\n"` gives its WGSL back exactly. The same entries
 * always make the same bytes, whatever their order.
 */
export function mapText(salt: string, entries: ReadonlyMap<string, string>): string {
  const lines: string[] = [];
  const indexOf = new Map<string, number>();
  // No prototype: an entry keyed `__proto__` is an entry like any other.
  const runsOf: Record<string, number[]> = Object.create(null) as Record<string, number[]>;
  for (const key of [...entries.keys()].sort()) {
    const runs: number[] = [];
    for (const line of (entries.get(key) as string).split("\n")) {
      let index = indexOf.get(line);
      if (index === undefined) {
        index = lines.length;
        lines.push(line);
        indexOf.set(line, index);
      }
      const last = runs.length - 2;
      // The next line of the table extends the run; any other line, the same
      // line again included, starts one.
      if (last >= 0 && (runs[last] as number) + (runs[last + 1] as number) === index) runs[last + 1] = (runs[last + 1] as number) + 1;
      else runs.push(index, 1);
    }
    runsOf[key] = runs;
  }
  return JSON.stringify({ format: MAP_FORMAT, salt, lines, entries: runsOf });
}

/**
 * A map as the page holds it: the table of lines and each entry's runs, never
 * the entries expanded. `get` expands an entry when it is asked for, each
 * time, and keeps nothing of what it hands over.
 */
export type WgslMap = {
  readonly size: number;
  keys(): IterableIterator<string>;
  /** The WGSL under `key`, its lines joined, or null. Never throws: every
   * entry's length was reckoned when the map was read, and none passes
   * `MAP_ENTRY_MAX_CHARS`. */
  get(key: string): string | null;
};

/**
 * The map made for `salt`, read from its text; throws on another format,
 * another salt, anything that is not a map, and a map damaged anywhere: a
 * line that is not text or that holds a newline, an entry that is not an
 * even count of numbers (at least two), a run that is not whole numbers, that
 * starts outside the table, holds no lines or reaches past the table's end,
 * and an entry that would expand past `MAP_ENTRY_MAX_CHARS` characters,
 * reckoned from its runs and the lines' lengths before anything is
 * expanded. A damaged map is refused whole, so that no entry of a map whose table or
 * runs are broken is ever served, not even one the damage does not touch.
 * The runs are held in one typed array, the lines as the parse made them.
 */
export function readMap(text: string, salt: string): WgslMap {
  const map = JSON.parse(text) as { format?: unknown; salt?: unknown; lines?: unknown; entries?: unknown };
  if (map?.format !== MAP_FORMAT) throw new Error(`not a map of ${MAP_FORMAT}: ${String(map?.format)}`);
  if (map.salt !== salt) throw new Error("made for another build");
  const lines = map.lines;
  if (!Array.isArray(lines)) throw new Error("a map without its lines");
  for (let i = 0; i < lines.length; i++) {
    const line: unknown = lines[i];
    if (typeof line !== "string") throw new Error(`the line ${i} is not text`);
    if (line.includes("\n")) throw new Error(`the line ${i} holds a newline`);
  }
  // The characters of the lines before each: a run's are two lookups.
  const before = new Float64Array(lines.length + 1);
  for (let i = 0; i < lines.length; i++) before[i + 1] = (before[i] as number) + (lines[i] as string).length;
  const entries = map.entries;
  if (typeof entries !== "object" || entries === null || Array.isArray(entries)) throw new Error("a map without entries");
  const listed = Object.entries(entries as Record<string, unknown>);
  let numbers = 0;
  for (const [key, runs] of listed) {
    if (!Array.isArray(runs) || runs.length === 0 || runs.length % 2 !== 0) throw new Error(`the entry ${key} is not runs of lines`);
    // Its lines' characters, and a newline between each two.
    let chars = -1;
    for (let i = 0; i < runs.length; i += 2) {
      const start: unknown = runs[i];
      const length: unknown = runs[i + 1];
      if (!Number.isInteger(start) || !Number.isInteger(length) || (start as number) < 0 || (length as number) < 1 || (start as number) + (length as number) > lines.length) {
        throw new Error(`the entry ${key} has a run outside its lines: ${JSON.stringify(start)}, ${JSON.stringify(length)}`);
      }
      const [first, end] = [start as number, (start as number) + (length as number)];
      chars += (before[end] as number) - (before[first] as number) + (length as number);
    }
    if (chars > MAP_ENTRY_MAX_CHARS) throw new Error(`the entry ${key} expands to ${chars} characters, past the ceiling of ${MAP_ENTRY_MAX_CHARS}`);
    numbers += runs.length;
  }
  const all = new Uint32Array(numbers);
  const runsOf = new Map<string, Uint32Array>();
  let at = 0;
  for (const [key, runs] of listed as [string, number[]][]) {
    all.set(runs, at);
    runsOf.set(key, all.subarray(at, at + runs.length));
    at += runs.length;
  }
  const table = lines as string[];
  return {
    size: runsOf.size,
    keys: () => runsOf.keys(),
    get(key: string): string | null {
      const runs = runsOf.get(key);
      if (runs === undefined) return null;
      const parts: string[] = [];
      for (let i = 0; i < runs.length; i += 2) {
        const start = runs[i] as number;
        const end = start + (runs[i + 1] as number);
        for (let line = start; line < end; line++) parts.push(table[line] as string);
      }
      return parts.join("\n");
    },
  };
}
