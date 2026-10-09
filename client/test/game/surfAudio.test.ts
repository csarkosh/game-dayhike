import { describe, expect, it, vi } from "vitest";
import type { VoiceSource } from "../../src/game/ambientAudio.js";
import {
  SURF_BACKWASH_VOICES, SURF_BED_HOLD_S, SURF_BED_LOOP_S, SURF_CANOPY_LOWPASS, SURF_GAIN_STEP, SURF_LEVEL,
  SURF_LOWPASS_INLAND_HZ, SURF_LOWPASS_INLAND_M, SURF_LOWPASS_SHORE_HZ, SURF_PLUNGE_VOICES, SURF_RANGE_M, SURF_REF_M,
  createSurfAudio, surfBedGain, surfCutoffHz,
} from "../../src/game/surfAudio.js";
import { createSurfSound, type SurfSound } from "../../src/game/surfSound.js";

/** A node as the stub context makes it: it records what it is connected to, and its params their glides. */
type StubNode = {
  connections: unknown[];
  starts: number[][];
  type: string;
  buffer: unknown;
  loop: boolean; loopStart: number; loopEnd: number;
  frequency: { value: number; targets: number[] };
};

/** Enough of a context for the voices to build on: buffer sources and filters are kept in the order made. */
function stubCtx() {
  const sources: StubNode[] = [];
  const filters: StubNode[] = [];
  function param() {
    const p = {
      value: 0,
      targets: [] as number[],
      setTargetAtTime(v: number) { p.targets.push(v); },
      setValueAtTime() {},
    };
    return p;
  }
  function node() {
    const n = {
      connections: [] as unknown[],
      connect(to: unknown) { n.connections.push(to); },
      disconnect() {}, stop() {},
      starts: [] as number[][],
      start(...at: number[]) { n.starts.push(at); },
      gain: param(), frequency: param(), Q: param(), playbackRate: param(), type: "", buffer: null as unknown,
      loop: false, loopStart: 0, loopEnd: 0,
    };
    return n;
  }
  const ctx = {
    currentTime: 0,
    sampleRate: 8000,
    createGain: node,
    createBiquadFilter() { const f = node(); filters.push(f); return f; },
    createBufferSource() { const s = node(); sources.push(s); return s; },
  };
  return { ctx: ctx as unknown as BaseAudioContext, sources, filters };
}

type Loop = {
  x: number; y: number; z: number; gain: number; ref: number; max: number;
  moves: number[][]; gains: number[]; stopped: boolean; voice: VoiceSource;
};

/** The surf's six recordings, all landing: the bed 30.5 s, each one-shot 0.7 s but the second backwash's 0.6 s. */
const CLIPS = {
  "ambience.surf_cove": 30.5,
  "call.surf_plunge_a": 0.7, "call.surf_plunge_b": 0.7, "call.surf_plunge_c": 0.7,
  "call.surf_backwash_a": 0.7, "call.surf_backwash_b": 0.6,
};

/**
 * The ambient as `surfAudio` sees it: `loopEmitter` builds the voice on a
 * stub context and records the emitter; `unlocked: false` models the real
 * start. `clips` are the recordings that fetch, by id, each decoded to a
 * buffer of that many seconds; any other id fails to fetch.
 */
function fakeAmbient({ unlocked = true, clips = CLIPS }: { unlocked?: boolean; clips?: Record<string, number> } = {}) {
  const loops: Loop[] = [];
  const stub = stubCtx();
  let ready = unlocked;
  const unlockListeners: (() => void)[] = [];
  const named = new Map<ArrayBuffer, string>();
  const buffers = new Map<string, AudioBuffer>();
  const fake = {
    loops,
    stub,
    buffer(id: string): AudioBuffer {
      let b = buffers.get(id);
      if (b === undefined) {
        b = { id, duration: clips[id] ?? 0 } as unknown as AudioBuffer;
        buffers.set(id, b);
      }
      return b;
    },
    fetchClip(id: string): Promise<ArrayBuffer> {
      if (clips[id] === undefined) return Promise.reject(new Error("HTTP 404"));
      const bytes = new ArrayBuffer(8);
      named.set(bytes, id);
      return Promise.resolve(bytes);
    },
    unlock() {
      ready = true;
      for (const fn of unlockListeners.splice(0)) fn();
    },
    ambient: {
      decode(bytes: ArrayBuffer): Promise<AudioBuffer | null> {
        const id = named.get(bytes);
        return Promise.resolve(ready && id !== undefined ? fake.buffer(id) : null);
      },
      loopEmitter(
        build: (c: BaseAudioContext) => VoiceSource,
        x: number, y: number, z: number, gain: number, ref: number, max: number,
      ) {
        if (!ready) return null;
        const loop: Loop = { x, y, z, gain, ref, max, moves: [], gains: [], stopped: false, voice: build(stub.ctx) };
        loops.push(loop);
        return {
          move(nx: number, ny: number, nz: number) { loop.moves.push([nx, ny, nz]); },
          setGain(g: number) { loop.gains.push(g); },
          stop() { loop.stopped = true; },
        };
      },
      onUnlock(fn: () => void) {
        if (ready) fn();
        else unlockListeners.push(fn);
      },
    },
  };
  return fake;
}

type Fake = ReturnType<typeof fakeAmbient>;

function audioOf(fake: Fake, random: () => number, now: () => number) {
  return createSurfAudio(fake.ambient, random, now, { fetchClip: (id) => fake.fetchClip(id) });
}

/** Lets every fetch and decode already under way land. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** The node a loop's voice leaves by: the bed's lowpass, or a one-shot's buffer source. */
const filterOf = (l: Loop) => l.voice.output as unknown as StubNode;

const ORIGIN = { x: 0, y: 1, z: 0 };

/** The sea present, its nearest point 50 m off at (30, 0.5, 40), at a full envelope on a 2 m swell, on the shore, in the open. */
function surf(over: Partial<Pick<SurfSound, "present" | "envelope" | "hs" | "inland" | "canopy" | "nearX" | "nearY" | "nearZ">> = {}): SurfSound {
  const s = createSurfSound();
  Object.assign(s, { present: true, nearX: 30, nearY: 0.5, nearZ: 40, envelope: 1, inland: 0, canopy: 0, hs: 2 }, over);
  return s;
}

function withPlunges(s: SurfSound, list: readonly [number, number, number, number][]): SurfSound {
  list.forEach(([x, y, z, height], i) => {
    s.plunges.x[i] = x;
    s.plunges.y[i] = y;
    s.plunges.z[i] = z;
    s.plunges.height[i] = height;
  });
  s.plunges.count = list.length;
  return s;
}

function withBackwash(s: SurfSound, list: readonly [number, number, number, number][]): SurfSound {
  list.forEach(([x, y, z, reach], i) => {
    s.backwash.x[i] = x;
    s.backwash.y[i] = y;
    s.backwash.z[i] = z;
    s.backwash.reach[i] = reach;
  });
  s.backwash.count = list.length;
  return s;
}

const beds = (loops: Loop[]) => loops.filter((l) => filterOf(l).type === "lowpass");
const shots = (loops: Loop[]) => loops.filter((l) => filterOf(l).type !== "lowpass");

describe("surfAudio", () => {
  it("holds the levels, distances, cutoffs, caps and the bed's stretch", () => {
    expect([SURF_LEVEL, SURF_REF_M, SURF_RANGE_M, SURF_GAIN_STEP, SURF_BED_HOLD_S]).toEqual([0.6, 40, 400, 0.005, 2]);
    expect([SURF_LOWPASS_SHORE_HZ, SURF_LOWPASS_INLAND_HZ, SURF_LOWPASS_INLAND_M, SURF_CANOPY_LOWPASS]).toEqual([8000, 1500, 300, 0.5]);
    expect([SURF_PLUNGE_VOICES, SURF_BACKWASH_VOICES]).toEqual([4, 2]);
    expect(SURF_BED_LOOP_S).toEqual([0.25, 30.25]);
  });

  it("the bed's gain: SURF_LEVEL by half to whole with the envelope, by the swell's height over 2 m held to 1", () => {
    expect([surfBedGain(0, 2), surfBedGain(1, 2), surfBedGain(0, 1), surfBedGain(1, 1)]).toEqual([0.3, 0.6, 0.15, 0.3]);
    expect([surfBedGain(1, 4), surfBedGain(2, 2), surfBedGain(-1, 2), surfBedGain(1, 0)]).toEqual([0.6, 0.6, 0.3, 0]);
    expect([surfBedGain(Number.NaN, 2), surfBedGain(1, Number.NaN), surfBedGain(1, Infinity)]).toEqual([0, 0, 0]);
  });

  it("the bed's cutoff: 8 kHz on the shore to 1.5 kHz 300 m inland, halved under full canopy", () => {
    expect([surfCutoffHz(0, 0), surfCutoffHz(150, 0), surfCutoffHz(300, 0), surfCutoffHz(600, 0), surfCutoffHz(-50, 0)])
      .toEqual([8000, 4750, 1500, 1500, 8000]);
    expect([surfCutoffHz(0, 1), surfCutoffHz(300, 1), surfCutoffHz(0, 0.5)]).toEqual([4000, 750, 6000]);
    expect([surfCutoffHz(Number.NaN, 0), surfCutoffHz(0, Number.NaN)]).toEqual([8000, 8000]);
  });

  it("the bed's graph: the recording looping round its stretch from a random point, into a lowpass that is the voice's output, at −z", async () => {
    const fake = fakeAmbient();
    const audio = audioOf(fake, () => 0.5, () => 0);
    await settle();
    audio.update(surf(), ORIGIN);
    const [bed] = beds(fake.loops);
    expect([bed!.x, bed!.y, bed!.z, bed!.ref, bed!.max]).toEqual([30, 0.5, -40, 40, 400]);
    const filter = filterOf(bed!);
    expect([filter.type, filter.frequency.value]).toEqual(["lowpass", 8000]);
    const [source] = fake.stub.sources;
    expect(source!.buffer).toBe(fake.buffer("ambience.surf_cove"));
    expect([source!.loop, source!.loopStart, source!.loopEnd]).toEqual([true, 0.25, 30.25]);
    // Started 0.25 + 0.5 · 30 s in, into the filter and nowhere else.
    expect(source!.starts).toEqual([[0, 15.25]]);
    expect(source!.connections).toEqual([filter]);
    // Made silent and raised at once through the emitter's ramp.
    expect([bed!.gain, bed!.gains]).toEqual([0, [0.6]]);
    // The next frame moves it in place.
    audio.update(surf({ nearZ: 60 }), ORIGIN);
    expect(bed!.moves).toEqual([[30, 0.5, -60]]);
    expect(beds(fake.loops).length).toBe(1);
    audio.dispose();
    expect(bed!.stopped).toBe(true);
  });

  it("the bed follows the envelope and the swell's height, and a change under 0.005 is not sent", async () => {
    const fake = fakeAmbient();
    const audio = audioOf(fake, () => 0.5, () => 0);
    await settle();
    audio.update(surf({ envelope: 1, hs: 2 }), ORIGIN);
    const bed = beds(fake.loops)[0]!;
    audio.update(surf({ envelope: 0, hs: 2 }), ORIGIN);
    audio.update(surf({ envelope: 0, hs: 1 }), ORIGIN);
    audio.update(surf({ envelope: 1, hs: 1 }), ORIGIN);
    expect(bed.gains.map((g) => g.toFixed(6))).toEqual(["0.600000", "0.300000", "0.150000", "0.300000"]);
    // 0.6 · 0.995 · 0.5 = 0.2985: 0.0015 from what was sent.
    audio.update(surf({ envelope: 0.99, hs: 1 }), ORIGIN);
    expect(bed.gains.length).toBe(4);
    audio.dispose();
  });

  it("the bed's cutoff glides inland and under the canopy, and a change under 20 Hz is not sent", async () => {
    const fake = fakeAmbient();
    const audio = audioOf(fake, () => 0.5, () => 0);
    await settle();
    audio.update(surf({ inland: 0, canopy: 0 }), ORIGIN);
    const filter = filterOf(beds(fake.loops)[0]!);
    expect(filter.frequency.value).toBe(8000);
    audio.update(surf({ inland: 300, canopy: 0 }), ORIGIN);
    audio.update(surf({ inland: 310, canopy: 0 }), ORIGIN);
    audio.update(surf({ inland: 0, canopy: 1 }), ORIGIN);
    // 0.5 m inland under full canopy moves it 5.4 Hz: not sent.
    audio.update(surf({ inland: 0.5, canopy: 1 }), ORIGIN);
    audio.update(surf({ inland: 0, canopy: Number.NaN }), ORIGIN);
    expect(filter.frequency.targets).toEqual([1500, 4000, 8000]);
    audio.dispose();
  });

  it("the bed is silent before unlock and before its clip is in, and never starts for a gain under the step or a sea that is absent", async () => {
    const fake = fakeAmbient({ unlocked: false });
    const audio = audioOf(fake, () => 0.5, () => 0);
    await settle();
    for (let f = 0; f < 30; f++) audio.update(surf(), ORIGIN);
    expect(fake.loops).toEqual([]);
    fake.unlock();
    // Decoded on the next turn: not yet.
    audio.update(surf(), ORIGIN);
    expect(fake.loops).toEqual([]);
    await settle();
    audio.update(surf({ present: false }), ORIGIN);
    audio.update(surf({ hs: 0.01, envelope: 0 }), ORIGIN); // 0.003
    audio.update(surf({ nearX: Number.NaN }), ORIGIN);
    expect(fake.loops).toEqual([]);
    audio.update(surf(), ORIGIN);
    expect(beds(fake.loops).length).toBe(1);
    audio.dispose();
  });

  it("an absent sea sends the bed silence and stops it 2 s on; back before then, it is the same loop", async () => {
    const fake = fakeAmbient();
    let t = 10;
    const audio = audioOf(fake, () => 0.5, () => t);
    await settle();
    audio.update(surf(), ORIGIN);
    const bed = beds(fake.loops)[0]!;
    t = 11;
    audio.update(surf({ present: false }), ORIGIN);
    expect(bed.gains).toEqual([0.6, 0]);
    t = 12;
    audio.update(surf({ envelope: 0 }), ORIGIN);
    expect(bed.gains).toEqual([0.6, 0, 0.3]);
    t = 13;
    audio.update(surf({ present: false }), ORIGIN);
    t = 14.9;
    audio.update(surf({ present: false }), ORIGIN);
    expect(bed.stopped).toBe(false);
    t = 15;
    audio.update(surf({ present: false }), ORIGIN);
    expect(bed.stopped).toBe(true);
    t = 16;
    audio.update(surf(), ORIGIN);
    expect(beds(fake.loops).length).toBe(2);
    audio.dispose();
  });

  it("plunges: a one-shot each at −z, gained by height, at most four sounding, the nearest first, none beyond 400 m", async () => {
    const fake = fakeAmbient();
    let t = 1;
    const audio = audioOf(fake, () => 0.5, () => t);
    await settle();
    const s = withPlunges(surf({ present: true }), [
      [100, 0.5, 0, 1], [20, 0.5, 0, 2], [60, 0.5, 0, 3], [450, 0.5, 0, 2],
      [40, 0.5, 5, Number.NaN], [80, 0.5, 0, 0.5], [30, 0.5, 0, 0.001], [90, 0.5, 0, 1.5],
    ]);
    audio.update(s, ORIGIN);
    const made = shots(fake.loops);
    // 20, 60, 80 and 90 m: the 30 m one too faint to send, the 40 m one's height not a number, 100 m a fifth.
    expect(made.map((l) => [l.x, l.z, l.gain.toFixed(6), l.ref, l.max])).toEqual([
      [20, -0, "0.600000", 40, 400], [60, -0, "0.600000", 40, 400], [80, -0, "0.150000", 40, 400], [90, -0, "0.450000", 40, 400],
    ]);
    // Each a recording played once: the second plunge (random 0.5 of three).
    const sources = fake.stub.sources.slice(1);
    expect(sources.map((n) => [n.buffer, n.loop, n.starts])).toEqual(
      Array.from({ length: 4 }, () => [fake.buffer("call.surf_plunge_b"), false, [[0, 0]]]),
    );
    // While they sound a new plunge finds no slot; 0.7 s + 0.1 s on, they free.
    t = 1.75;
    audio.update(withPlunges(surf(), [[10, 0.5, 3, 2]]), ORIGIN);
    expect(shots(fake.loops).length).toBe(4);
    t = 1.8;
    audio.update(withPlunges(surf(), [[10, 0.5, 3, 2]]), ORIGIN);
    expect(made.every((l) => l.stopped)).toBe(true);
    expect(shots(fake.loops).map((l) => [l.x, l.z])).toEqual([[20, -0], [60, -0], [80, -0], [90, -0], [10, -3]]);
    audio.dispose();
  });

  it("backwash: at most two at once, the nearest first, gained by the reach over 10 m", async () => {
    const fake = fakeAmbient();
    const audio = audioOf(fake, () => 0, () => 0);
    await settle();
    audio.update(withBackwash(surf(), [[50, 1, 0, 5], [15, 1, 0, 20], [25, 1, 2, 4]]), ORIGIN);
    const made = shots(fake.loops);
    expect(made.map((l) => [l.x, l.z, l.gain.toFixed(6)])).toEqual([[15, -0, "0.600000"], [25, -2, "0.240000"]]);
    expect(fake.stub.sources.slice(1).map((n) => n.buffer)).toEqual([
      fake.buffer("call.surf_backwash_a"), fake.buffer("call.surf_backwash_a"),
    ]);
    audio.dispose();
  });

  it("voices no event while the sea is absent, and a one-shot whose recordings did not land is not voiced", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fake = fakeAmbient({ clips: { "ambience.surf_cove": 30.5, "call.surf_plunge_c": 0.7 } });
    const audio = audioOf(fake, () => 0, () => 0);
    await settle();
    audio.update(withPlunges(surf({ present: false }), [[20, 0.5, 0, 2]]), ORIGIN);
    expect(fake.loops).toEqual([]);
    // Random 0 picks the first plunge, which did not land: the next that did is played; no backwash landed.
    audio.update(withBackwash(withPlunges(surf(), [[20, 0.5, 0, 2]]), [[15, 1, 0, 20]]), ORIGIN);
    expect(shots(fake.loops).map((l) => l.x)).toEqual([20]);
    expect(fake.stub.sources[1]!.buffer).toBe(fake.buffer("call.surf_plunge_c"));
    expect(warn.mock.calls.map((c) => String(c[0]))).toContain('surf clip "call.surf_backwash_a" will not play: HTTP 404');
    audio.dispose();
    warn.mockRestore();
  });

  it("dispose stops the bed and every one-shot, and an update after it builds nothing", async () => {
    const fake = fakeAmbient();
    const audio = audioOf(fake, () => 0.5, () => 0);
    await settle();
    audio.update(withBackwash(withPlunges(surf(), [[20, 0.5, 0, 2]]), [[15, 1, 0, 20]]), ORIGIN);
    expect(fake.loops.length).toBe(3);
    audio.dispose();
    expect(fake.loops.every((l) => l.stopped)).toBe(true);
    audio.update(withPlunges(surf(), [[20, 0.5, 0, 2]]), ORIGIN);
    expect(fake.loops.length).toBe(3);
  });
});
