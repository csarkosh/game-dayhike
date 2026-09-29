import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  CORPUS_FORMAT,
  MAP_ENTRY_MAX_CHARS,
  MAP_FORMAT,
  corpusId,
  corpusText,
  mapText,
  readCorpus,
  readMap,
  stageKey,
  type CorpusStage,
  type WgslMap,
} from "../../src/game/wgslFormat.js";

const VERTEX: CorpusStage = { stage: "vertex", flag: false, glsl: "#version 450\nvoid main() { gl_Position = vec4(0.0); }" };
const FRAGMENT: CorpusStage = { stage: "fragment", flag: true, glsl: "#version 450\n#define DISABLE_UNIFORMITY_ANALYSIS\nvoid main() {}" };

describe("the corpus", () => {
  it("names a stage by its key under an empty salt, the same under every build", () => {
    expect(CORPUS_FORMAT).toBe("dayhike-wgsl-corpus/1");
    expect(corpusId(VERTEX)).toBe(stageKey("", "vertex", false, VERTEX.glsl));
    expect(corpusId(FRAGMENT)).toBe(createHash("sha256").update(`\0fragment\x001\0${FRAGMENT.glsl}`, "utf8").digest("hex"));
    // The switch is part of it: the same text under the other switch is another stage.
    expect(corpusId({ ...FRAGMENT, flag: false })).not.toBe(corpusId(FRAGMENT));
  });

  it("writes each stage once, sorted by its name, one a line, and reads back what it wrote", () => {
    const text = corpusText([FRAGMENT, VERTEX, { ...VERTEX }, FRAGMENT]);
    const [first, second] = [VERTEX, FRAGMENT].sort((a, b) => (corpusId(a) < corpusId(b) ? -1 : 1)) as [CorpusStage, CorpusStage];
    expect(text).toBe(`{"format":"dayhike-wgsl-corpus/1","stages":[\n${JSON.stringify(first)},\n${JSON.stringify(second)}\n]}\n`);
    expect(readCorpus(text)).toEqual([first, second]);
    // The same stages in any order, and any fields beyond the three, make the same bytes.
    const recorded = [{ ...VERTEX, key: "k", wgsl: "w", from: "translated", spirvMs: 1, wgslMs: 2 }, FRAGMENT];
    expect(corpusText(recorded)).toBe(corpusText([FRAGMENT, VERTEX]));
    expect(corpusText([])).toBe('{"format":"dayhike-wgsl-corpus/1","stages":[]}\n');
    expect(readCorpus(corpusText([]))).toEqual([]);
  });

  it("refuses a file of another format, and a stage without its stage, switch or text", () => {
    expect(() => readCorpus('{"format":"dayhike-wgsl-corpus/2","stages":[]}')).toThrow("not a corpus of dayhike-wgsl-corpus/1");
    expect(() => readCorpus('{"format":"dayhike-wgsl-corpus/1"}')).toThrow("a corpus without stages");
    expect(() => readCorpus('{"format":"dayhike-wgsl-corpus/1","stages":[{"stage":"compute","flag":false,"glsl":""}]}')).toThrow(
      "a corpus stage without its stage, flag or text",
    );
    expect(() => readCorpus('{"format":"dayhike-wgsl-corpus/1","stages":[{"stage":"vertex","glsl":""}]}')).toThrow(
      "a corpus stage without its stage, flag or text",
    );
    expect(() => readCorpus("null")).toThrow("not a corpus");
  });
});

describe("the map", () => {
  const SALT = "dayhike-wgsl/1|babylon=test|staticUA=false";
  /** Every entry of a map read, expanded. */
  const expanded = (map: WgslMap): Map<string, string | null> => new Map([...map.keys()].map((key) => [key, map.get(key)]));
  /** A map of format 2 for `SALT` holding `lines` and `entries` as they are given. */
  const raw = (lines: unknown, entries: unknown): string => JSON.stringify({ format: "dayhike-wgsl-map/2", salt: SALT, lines, entries });

  /** Texts that end with a newline and without, hold an empty line, repeat a
   * line in a row, repeat two lines in a row, are one line, or are empty. */
  const TEXTS = new Map([
    ["gg", "p\nq\np\nq"],
    ["aa", "a\nb\nc\n"],
    ["ff", "one"],
    ["bb", "a\nb\nc"],
    ["dd", ""],
    ["cc", "x\nx\nx"],
    ["ee", "a\n\nb"],
  ]);

  it("writes each distinct line once, in order of first appearance over the keys sorted, and each entry as maximal runs of consecutive lines", () => {
    expect(MAP_FORMAT).toBe("dayhike-wgsl-map/2");
    const text = mapText(SALT, TEXTS);
    expect(text).toBe(
      '{"format":"dayhike-wgsl-map/2","salt":"dayhike-wgsl/1|babylon=test|staticUA=false",' +
        '"lines":["a","b","c","","x","one","p","q"],' +
        // A run never takes in a line equal to the one before it unless it is
        // the next line of the table: "x" three times is three runs.
        '"entries":{"aa":[0,4],"bb":[0,3],"cc":[4,1,4,1,4,1],"dd":[3,1],"ee":[0,1,3,1,1,1],"ff":[5,1],"gg":[6,2,6,2]}}',
    );
    // The same entries in any order make the same bytes.
    expect(mapText(SALT, new Map([...TEXTS].reverse()))).toBe(text);
    expect(mapText(SALT, new Map())).toBe('{"format":"dayhike-wgsl-map/2","salt":"dayhike-wgsl/1|babylon=test|staticUA=false","lines":[],"entries":{}}');
  });

  it("reads back every entry, expanded when asked for, byte for byte the text it was made of", () => {
    const map = readMap(mapText(SALT, TEXTS), SALT);
    expect(map.size).toBe(7);
    expect([...map.keys()]).toEqual(["aa", "bb", "cc", "dd", "ee", "ff", "gg"]);
    expect(expanded(map)).toEqual(new Map([...TEXTS].sort(([a], [b]) => (a < b ? -1 : 1))));
    expect([map.get("aa"), map.get("aa"), map.get("dd"), map.get("zz")]).toEqual(["a\nb\nc\n", "a\nb\nc\n", "", null]);
    // Carriage returns, tabs, quotes, backslashes and characters outside ASCII
    // are the line's own.
    const odd = new Map([["aa", 'a\r\n\t"b"\\\n€ 𝄞\r'], ["bb", "\n\n"]]);
    expect(expanded(readMap(mapText(SALT, odd), SALT))).toEqual(odd);
    expect(readMap(mapText(SALT, new Map()), SALT).size).toBe(0);
  });

  it("keeps an entry whatever its key, __proto__ included", () => {
    const entries = new Map([
      ["__proto__", "a"],
      ["b", "x"],
    ]);
    const text = mapText(SALT, entries);
    expect(text).toBe('{"format":"dayhike-wgsl-map/2","salt":"dayhike-wgsl/1|babylon=test|staticUA=false","lines":["a","x"],"entries":{"__proto__":[0,1],"b":[1,1]}}');
    expect(expanded(readMap(text, SALT))).toEqual(entries);
  });

  it("refuses a map with an entry that expands past 8,388,608 characters, reckoned from its runs before any is expanded", () => {
    expect(MAP_ENTRY_MAX_CHARS).toBe(8_388_608);
    // One line named three times: 3 × 2,796,202 characters and 2 newlines
    // are exactly the most an entry may be.
    const at = readMap(raw(["x".repeat(2_796_202), "y"], { aa: [0, 1, 0, 1, 0, 1], bb: [1, 1] }), SALT);
    expect(at.get("aa")?.length).toBe(8_388_608);
    expect(at.get("bb")).toBe("y");
    // One character more: the map refused whole, its other entry too.
    expect(() => readMap(raw(["x".repeat(2_796_203), "y"], { aa: [0, 1, 0, 1, 0, 1], bb: [1, 1] }), SALT)).toThrow(
      "the entry aa expands to 8388611 characters, past the ceiling of 8388608",
    );
    // A line of 100,000 characters named 84 times, in a file of about 100 kB.
    const runs = Array.from({ length: 84 }, () => [0, 1]).flat();
    expect(() => readMap(raw(["x".repeat(100_000)], { aa: runs }), SALT)).toThrow("the entry aa expands to 8400083 characters, past the ceiling of 8388608");
    // Runs of many lines are reckoned by their lines' lengths, not by one.
    expect(() => readMap(raw(["x".repeat(4_194_304), "y".repeat(4_194_304)], { aa: [0, 2] }), SALT)).toThrow(
      "the entry aa expands to 8388609 characters, past the ceiling of 8388608",
    );
  });

  it("refuses a map made for another salt or in another format, the format before this one included, and anything that is not one", () => {
    const text = mapText(SALT, new Map([["aa", "// vertex"]]));
    expect(() => readMap(text, `${SALT}x`)).toThrow("made for another build");
    expect(() => readMap(text.replace("dayhike-wgsl-map/2", "dayhike-wgsl-map/3"), SALT)).toThrow("not a map of dayhike-wgsl-map/2");
    // The format before this one: each entry's WGSL whole.
    const first = JSON.stringify({ format: "dayhike-wgsl-map/1", salt: SALT, entries: { aa: "// vertex" } });
    expect(() => readMap(first, SALT)).toThrow("not a map of dayhike-wgsl-map/2: dayhike-wgsl-map/1");
    expect(() => readMap(text.slice(0, -1), SALT)).toThrow(SyntaxError);
    expect(() => readMap("null", SALT)).toThrow("not a map");
  });

  it("refuses a damaged map whole, naming what is wrong: never an entry that expands to other text", () => {
    const LINES = ["a", "b", "c"];
    const cases: [string, string, string][] = [
      ["no lines", raw(undefined, { aa: [0, 1] }), "a map without its lines"],
      ["lines not a list", raw({ 0: "a" }, { aa: [0, 1] }), "a map without its lines"],
      ["a line that is not text", raw(["a", 1, "c"], { aa: [0, 1] }), "the line 1 is not text"],
      ["a line that is null", raw(["a", null], { aa: [0, 1] }), "the line 1 is not text"],
      ["a line holding a newline", raw(["a", "b\nc"], { aa: [0, 1] }), "the line 1 holds a newline"],
      ["no entries", raw(LINES, undefined), "a map without entries"],
      ["entries as a list", raw(LINES, [[0, 1]]), "a map without entries"],
      ["an entry that is text", raw(LINES, { aa: "a" }), "the entry aa is not runs of lines"],
      ["an entry of no runs", raw(LINES, { aa: [] }), "the entry aa is not runs of lines"],
      ["an odd number of numbers", raw(LINES, { aa: [0, 1, 2] }), "the entry aa is not runs of lines"],
      ["a run past the table", raw(LINES, { aa: [0, 1], bb: [2, 2] }), "the entry bb has a run outside its lines: 2, 2"],
      ["a run starting past the table", raw(LINES, { aa: [3, 1] }), "the entry aa has a run outside its lines: 3, 1"],
      ["a run before the table", raw(LINES, { aa: [-1, 2] }), "the entry aa has a run outside its lines: -1, 2"],
      ["a run of no lines", raw(LINES, { aa: [0, 1, 1, 0] }), "the entry aa has a run outside its lines: 1, 0"],
      ["a run of fewer than none", raw(LINES, { aa: [2, -1] }), "the entry aa has a run outside its lines: 2, -1"],
      ["a start that is not a whole number", raw(LINES, { aa: [0.5, 1] }), "the entry aa has a run outside its lines: 0.5, 1"],
      ["a length that is text", raw(LINES, { aa: [0, "1"] }), 'the entry aa has a run outside its lines: 0, "1"'],
      ["a start that is null", raw(LINES, { aa: [null, 1] }), "the entry aa has a run outside its lines: null, 1"],
      // Past what a Uint32Array holds, and past every whole number a double
      // counts exactly: refused before anything is stored.
      ["a start of 2^32", raw(LINES, { aa: [4294967296, 1] }), "the entry aa has a run outside its lines: 4294967296, 1"],
      ["a length of 10^21", raw(LINES, { aa: [0, 1e21] }), "the entry aa has a run outside its lines: 0, 1e+21"],
    ];
    for (const [what, text, message] of cases) expect(() => readMap(text, SALT), what).toThrow(message);
    // The same, whole: read.
    expect(expanded(readMap(raw(LINES, { aa: [0, 3], bb: [2, 1, 0, 1] }), SALT))).toEqual(new Map([["aa", "a\nb\nc"], ["bb", "c\na"]]));
  });
});
