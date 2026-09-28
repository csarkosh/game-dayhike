import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { CORPUS_FORMAT, corpusId, corpusText, readCorpus, stageKey, type CorpusStage } from "../../src/game/wgslFormat.js";

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
