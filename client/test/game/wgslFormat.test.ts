import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { CORPUS_FORMAT, MAP_FORMAT, corpusId, corpusText, mapText, readCorpus, readMap, stageKey, type CorpusStage } from "../../src/game/wgslFormat.js";

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

  it("writes its entries under their keys, sorted, so the same entries always make the same bytes", () => {
    expect(MAP_FORMAT).toBe("dayhike-wgsl-map/1");
    const entries = new Map([
      ["bb", "// fragment"],
      ["aa", "// vertex"],
    ]);
    const text = mapText(SALT, entries);
    expect(text).toBe('{"format":"dayhike-wgsl-map/1","salt":"dayhike-wgsl/1|babylon=test|staticUA=false","entries":{"aa":"// vertex","bb":"// fragment"}}');
    expect(mapText(SALT, new Map([...entries].reverse()))).toBe(text);
    expect(readMap(text, SALT)).toEqual(new Map([
      ["aa", "// vertex"],
      ["bb", "// fragment"],
    ]));
    expect(readMap(mapText(SALT, new Map()), SALT).size).toBe(0);
  });

  it("refuses a map made for another salt or in another format, and anything that is not one", () => {
    const text = mapText(SALT, new Map([["aa", "// vertex"]]));
    expect(() => readMap(text, `${SALT}x`)).toThrow("made for another build");
    expect(() => readMap(text.replace("dayhike-wgsl-map/1", "dayhike-wgsl-map/2"), SALT)).toThrow("not a map of dayhike-wgsl-map/1");
    expect(() => readMap(text.slice(0, -1), SALT)).toThrow(SyntaxError);
    expect(() => readMap(`{"format":"dayhike-wgsl-map/1","salt":${JSON.stringify(SALT)},"entries":[]}`, SALT)).toThrow("a map without entries");
    expect(() => readMap(`{"format":"dayhike-wgsl-map/1","salt":${JSON.stringify(SALT)},"entries":{"aa":1}}`, SALT)).toThrow("the entry aa is not WGSL text");
    expect(() => readMap("null", SALT)).toThrow("not a map");
  });
});
