import { describe, it, expect, vi } from "vitest";
import { BIRD_BED_CLIP, loadBirdBed } from "../../src/game/birdBed.js";
import { audioUrl } from "../../src/game/assetUrls.js";

/** The three calls the loader makes of the ambient graph, with the unlock held until `unlock()`. */
function fakeAmbient(decoded: AudioBuffer | null) {
  const waiting: (() => void)[] = [];
  let unlocked = false;
  const beds: AudioBuffer[] = [];
  return {
    beds,
    unlock() { unlocked = true; for (const fn of waiting.splice(0)) fn(); },
    ambient: {
      decode: vi.fn(() => Promise.resolve(decoded)),
      onUnlock(fn: () => void) { if (unlocked) fn(); else waiting.push(fn); },
      setBirdBed(buffer: AudioBuffer) { beds.push(buffer); },
    },
  };
}
const BED = { duration: 46 } as unknown as AudioBuffer;

describe("loadBirdBed", () => {
  it("ships the bed it asks for", () => {
    expect(() => audioUrl(BIRD_BED_CLIP)).not.toThrow();
  });

  it("decodes at the unlock when the bytes came first, and hands the bed over once", async () => {
    const f = fakeAmbient(BED);
    const done = loadBirdBed(f.ambient, { fetchBed: () => Promise.resolve(new ArrayBuffer(8)) });
    await Promise.resolve();
    await Promise.resolve();
    expect(f.ambient.decode).not.toHaveBeenCalled();
    f.unlock();
    await done;
    expect(f.ambient.decode).toHaveBeenCalledTimes(1);
    expect(f.beds).toEqual([BED]);
  });

  it("decodes as the bytes land when the unlock came first", async () => {
    const f = fakeAmbient(BED);
    f.unlock();
    await loadBirdBed(f.ambient, { fetchBed: () => Promise.resolve(new ArrayBuffer(8)) });
    expect(f.beds).toEqual([BED]);
  });

  it("is silence, not a failure, when the bed is missing or will not decode", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const missing = fakeAmbient(BED);
    missing.unlock();
    await loadBirdBed(missing.ambient, { fetchBed: () => Promise.reject(new Error("HTTP 404")) });
    expect(missing.beds).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    const refused = fakeAmbient(null);
    refused.unlock();
    await loadBirdBed(refused.ambient, { fetchBed: () => Promise.resolve(new ArrayBuffer(8)) });
    expect(refused.beds).toEqual([]);
    warn.mockRestore();
  });
});
