/**
 * What identifies a WGSL translation: the key of a stage and the salt it is
 * made under (`shaderLookup.ts`); and the two files that carry translations
 * made ahead: the corpus, the GLSL stages the build translates
 * (`tools/wgsl/`), and the map, their WGSL under their keys, which the page
 * fetches. Nothing here imports Babylon or the DOM, so the build's tools load
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

/** The format of a corpus file. */
export const CORPUS_FORMAT = "dayhike-wgsl-corpus/1";

/** One stage of the corpus: what the recorder keeps of it that decides its
 * WGSL (`StageRecord`'s `stage`, `flag` and `glsl`). */
export type CorpusStage = { stage: Stage; flag: boolean; glsl: string };

/** A corpus stage's name, the same under every build: its key with an empty
 * salt. The corpus is sorted, deduplicated and split by it. */
export function corpusId(entry: CorpusStage): string {
  return stageKey("", entry.stage, entry.flag, entry.glsl);
}

/**
 * A corpus file: `{"format": CORPUS_FORMAT, "stages": [...]}`, each stage
 * once, sorted by `corpusId`, one stage a line, so that a change to the
 * corpus reads in a diff as the stages it adds and drops. What the recorder
 * downloads, and what `tools/wgsl/merge-corpus.mjs` writes.
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

/** The stages of a corpus file; throws on another format, or on anything
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
export const MAP_FORMAT = "dayhike-wgsl-map/1";

/** The most a map may be, in bytes of text: 16 MB. The page holds it whole
 * for the engine's life, and parses it in one task on its thread; the build
 * refuses a larger one (`tools/wgsl/build-map.mjs`), and the page one that
 * reads past it, before it is parsed (`loadWgslMap`). */
export const MAP_MAX_BYTES = 16_777_216;

/** The map: `{"format": MAP_FORMAT, "salt": ..., "entries": {key: wgsl}}`,
 * its keys sorted, so the same entries always make the same bytes. */
export function mapText(salt: string, entries: ReadonlyMap<string, string>): string {
  const sorted: Record<string, string> = {};
  for (const key of [...entries.keys()].sort()) sorted[key] = entries.get(key) as string;
  return JSON.stringify({ format: MAP_FORMAT, salt, entries: sorted });
}

/** The entries of a map made for `salt`; throws on another format, another
 * salt, or anything that is not a map. */
export function readMap(text: string, salt: string): Map<string, string> {
  const map = JSON.parse(text) as { format?: unknown; salt?: unknown; entries?: unknown };
  if (map?.format !== MAP_FORMAT) throw new Error(`not a map of ${MAP_FORMAT}: ${String(map?.format)}`);
  if (map.salt !== salt) throw new Error("made for another build");
  if (typeof map.entries !== "object" || map.entries === null || Array.isArray(map.entries)) throw new Error("a map without entries");
  const entries = new Map<string, string>();
  for (const [key, wgsl] of Object.entries(map.entries)) {
    if (typeof wgsl !== "string") throw new Error(`the entry ${key} is not WGSL text`);
    entries.set(key, wgsl);
  }
  return entries;
}
