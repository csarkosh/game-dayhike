import { describe, expect, it } from "vitest";
import { createDrawnFrames, whenDrawnSettled } from "../../src/game/drawnSettle.js";

const turn = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("when a renderer's pipelines have settled", () => {
  it("waits for a frame to be drawn, however idle the pipelines are", async () => {
    const frames = createDrawnFrames();
    let done = false;
    void whenDrawnSettled(frames, () => 0, () => Promise.resolve()).then(() => {
      done = true;
    });
    await turn();
    expect(done).toBe(false);
    frames.drawn(false);
    await turn();
    expect(done).toBe(true);
  });

  it("does not settle on a frame that asked for a pipeline, nor while one compiles, but on the first quiet frame after", async () => {
    const frames = createDrawnFrames();
    let compiling = 1;
    let land: () => void = () => {};
    let idles = 0;
    const idle = (): Promise<void> => {
      idles++;
      return compiling === 0 ? Promise.resolve() : new Promise((resolve) => (land = resolve));
    };
    let done = false;
    void whenDrawnSettled(frames, () => compiling, idle).then(() => {
      done = true;
    });
    await turn();
    // A frame that asked: the wait goes on to the pipelines.
    frames.drawn(true);
    await turn();
    expect(done).toBe(false);
    expect(idles).toBe(1);
    // No frame is looked at while the pipeline compiles.
    frames.drawn(false);
    await turn();
    expect(done).toBe(false);
    compiling = 0;
    land();
    await turn();
    // The frame the pipeline landed by is told as one that asked: the next quiet one settles.
    frames.drawn(true);
    await turn();
    expect(done).toBe(false);
    frames.drawn(false);
    await turn();
    expect(done).toBe(true);
  });

  it("does not settle on a quiet frame while something asked earlier is still compiling", async () => {
    const frames = createDrawnFrames();
    let compiling = 2;
    let done = false;
    void whenDrawnSettled(frames, () => compiling, () => Promise.resolve()).then(() => {
      done = true;
    });
    await turn();
    frames.drawn(false);
    await turn();
    expect(done).toBe(false);
    compiling = 0;
    frames.drawn(false);
    await turn();
    expect(done).toBe(true);
  });

  it("tells every waiter of the one frame, and a frame drawn with none waiting is not kept for the next", async () => {
    const frames = createDrawnFrames();
    frames.drawn(true);
    const a = frames.next();
    const b = frames.next();
    frames.drawn(false);
    expect(await a).toBe(false);
    expect(await b).toBe(false);
  });
});
