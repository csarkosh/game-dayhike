import { describe, expect, it } from "vitest";
import type { VoiceSource } from "../../src/game/ambientAudio.js";
import type { FrogCall } from "../../src/game/frogChorus.js";
import {
  createWaterLifeAudio, FROG_RANGE, FROG_REF, HUM_RANGE, HUM_REF, RUSTLE_RANGE, RUSTLE_REF,
  type WaterLifeSound,
} from "../../src/game/waterLifeAudio.js";

/** Enough of a context for the voices to build on: every node takes
 * connections, and an oscillator's frequency records its glides. */
function stubCtx() {
  const oscillators: { type: string; frequency: { value: number; targets: number[] } }[] = [];
  function param() {
    const p = {
      value: 0,
      targets: [] as number[],
      setTargetAtTime(v: number) { p.targets.push(v); },
      setValueAtTime() {},
      linearRampToValueAtTime() {},
      exponentialRampToValueAtTime() {},
    };
    return p;
  }
  function node() {
    return {
      connect() {}, disconnect() {}, start() {}, stop() {},
      gain: param(), frequency: param(), Q: param(), type: "", buffer: null as unknown,
    };
  }
  const ctx = {
    currentTime: 0,
    sampleRate: 8000,
    createOscillator() { const o = node(); oscillators.push(o); return o; },
    createGain: node,
    createBiquadFilter: node,
    createBufferSource: node,
    createBuffer: (_ch: number, len: number) => ({ getChannelData: () => new Float32Array(len) }),
  };
  return { ctx: ctx as unknown as BaseAudioContext, oscillators };
}

type Loop = {
  x: number; y: number; z: number; gain: number; ref: number; max: number;
  moves: number[][]; gains: number[]; stopped: boolean; voice: VoiceSource;
};

/**
 * The ambient as `waterLifeAudio` sees it: `loopEmitter` builds the voice on a
 * stub context and records the emitter; `unlocked: false` models the real
 * start, with no context until the first pointerdown.
 */
function fakeAmbient({ unlocked = true }: { unlocked?: boolean } = {}) {
  const loops: Loop[] = [];
  const { ctx, oscillators } = stubCtx();
  let ready = unlocked;
  const unlockListeners: (() => void)[] = [];
  return {
    loops,
    oscillators,
    unlock() {
      ready = true;
      for (const fn of unlockListeners.splice(0)) fn();
    },
    ambient: {
      loopEmitter(
        build: (c: BaseAudioContext) => VoiceSource,
        x: number, y: number, z: number, gain: number, ref: number, max: number,
      ) {
        if (!ready) return null;
        const loop: Loop = { x, y, z, gain, ref, max, moves: [], gains: [], stopped: false, voice: build(ctx) };
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
}

const hums = (loops: Loop[]) => loops.filter((l) => l.ref === HUM_REF && l.max === HUM_RANGE);
const frogs = (loops: Loop[]) => loops.filter((l) => l.ref === FROG_REF && l.max === FROG_RANGE);
const rustles = (loops: Loop[]) => loops.filter((l) => l.ref === RUSTLE_REF && l.max === RUSTLE_RANGE);

/** Ten swarms in a row along x, 0.5 m to 9.5 m from the origin, 2 m off on z.
 * The first has 50 midges at presence 0.8 (gain 0.4); the rest 200 at 0.5 (gain 0.5). */
function rowOfSwarms(): WaterLifeSound["hums"] {
  return Array.from({ length: 10 }, (_, k) =>
    ({ x: k + 0.5, y: 1, z: 0, midges: k === 0 ? 50 : 200, presence: k === 0 ? 0.8 : 0.5 }));
}

function sound(over: Partial<WaterLifeSound> = {}): WaterLifeSound {
  return { hums: [], hums_n: 0, pitch: 230, rustles: [], frogCalls: [], ...over };
}

const frogCall = (voice: number, x: number, z = 5): FrogCall => ({ voice, x, y: 1, z, gain: 3 });
const ORIGIN = { x: 0, y: 1, z: 0 };

describe("waterLifeAudio", () => {
  it("is silent before unlock; the first frame after it starts the hums and plays none of the calls from before", () => {
    const fake = fakeAmbient({ unlocked: false });
    const audio = createWaterLifeAudio(fake.ambient, () => 0.5, () => 0);
    for (let f = 0; f < 120; f++) {
      audio.update(sound({ hums: rowOfSwarms(), hums_n: 10, frogCalls: [frogCall(0, 20), frogCall(1, 30)] }), ORIGIN);
    }
    expect(fake.loops).toEqual([]);
    fake.unlock();
    audio.update(sound({ hums: rowOfSwarms(), hums_n: 10 }), ORIGIN);
    expect(hums(fake.loops).length).toBe(8);
    expect(frogs(fake.loops)).toEqual([]);
    audio.update(sound({ hums: rowOfSwarms(), hums_n: 10, frogCalls: [frogCall(2, 25)] }), ORIGIN);
    expect(frogs(fake.loops).length).toBe(1);
    audio.dispose();
  });

  it("the eight nearest swarms keep a hum each, at −z, gained by presence and size; the next frame moves them in place", () => {
    const fake = fakeAmbient();
    const audio = createWaterLifeAudio(fake.ambient, () => 0.5, () => 0);
    const swarms = rowOfSwarms().map((h) => ({ ...h, z: 2 }));
    audio.update(sound({ hums: swarms, hums_n: 10 }), ORIGIN);
    const made = hums(fake.loops);
    expect(made.map((l) => l.x)).toEqual([0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5]);
    expect(made.every((l) => l.y === 1 && l.z === -2)).toBe(true);
    expect(made.map((l) => l.gain)).toEqual([0.4, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]);
    audio.update(sound({ hums: swarms, hums_n: 10 }), ORIGIN);
    expect(fake.loops.length).toBe(8);
    expect(made[0]!.moves).toEqual([[0.5, 1, -2]]);
    expect(made.every((l) => l.gains.length === 0 && !l.stopped)).toBe(true);
    // A swarm thinning re-gains its own hum, nobody else's.
    swarms[0]!.presence = 0.4;
    audio.update(sound({ hums: swarms, hums_n: 10 }), ORIGIN);
    expect(made[0]!.gains).toEqual([0.2]);
    expect(made.slice(1).every((l) => l.gains.length === 0)).toBe(true);
    audio.dispose();
  });

  it("a swarm out of range, without midges, without presence, at no place or past hums_n makes no hum", () => {
    const fake = fakeAmbient();
    const audio = createWaterLifeAudio(fake.ambient, () => 0.5, () => 0);
    const swarms: WaterLifeSound["hums"] = [
      { x: 10.5, y: 1, z: 0, midges: 200, presence: 1 },
      { x: 2, y: 1, z: 0, midges: 0, presence: 1 },
      { x: 3, y: 1, z: 0, midges: 200, presence: 0 },
      { x: Number.NaN, y: 1, z: 0, midges: 200, presence: 1 },
      { x: 4, y: 1, z: 0, midges: 200, presence: 1 },
      { x: 1, y: 1, z: 0, midges: 200, presence: 1 },
    ];
    audio.update(sound({ hums: swarms, hums_n: 5 }), ORIGIN);
    expect(hums(fake.loops).map((l) => l.x)).toEqual([4]);
    audio.dispose();
  });

  it("a hum that drops out fades over half a second, then stops; the cap holds while it fades", () => {
    const fake = fakeAmbient();
    let t = 10;
    const audio = createWaterLifeAudio(fake.ambient, () => 0.5, () => t);
    const swarms = rowOfSwarms();
    audio.update(sound({ hums: swarms, hums_n: 10 }), ORIGIN);
    const [first, second] = hums(fake.loops);
    // The listener walks to x = 9: swarms 8 and 9 are now among the nearest, 0 and 1 are not.
    const there = { x: 9, y: 1, z: 0 };
    audio.update(sound({ hums: swarms, hums_n: 10 }), there);
    expect(fake.loops.length).toBe(8);
    t = 10.25;
    audio.update(sound({ hums: swarms, hums_n: 10 }), there);
    expect(first!.gains).toEqual([0.2]);
    expect(second!.gains).toEqual([0.25]);
    expect(first!.stopped || second!.stopped).toBe(false);
    expect(fake.loops.length).toBe(8);
    t = 10.5;
    audio.update(sound({ hums: swarms, hums_n: 10 }), there);
    expect(first!.stopped && second!.stopped).toBe(true);
    expect(hums(fake.loops).slice(8).map((l) => l.x)).toEqual([8.5, 9.5]);
    expect(fake.loops.filter((l) => !l.stopped).length).toBe(8);
    audio.dispose();
  });

  it("a hum that comes back before its fade ends is the same voice, gained again", () => {
    const fake = fakeAmbient();
    let t = 10;
    const audio = createWaterLifeAudio(fake.ambient, () => 0.5, () => t);
    const swarms = rowOfSwarms();
    audio.update(sound({ hums: swarms, hums_n: 10 }), ORIGIN);
    const first = hums(fake.loops)[0]!;
    audio.update(sound({ hums: swarms, hums_n: 10 }), { x: 9, y: 1, z: 0 });
    t = 10.25;
    audio.update(sound({ hums: swarms, hums_n: 10 }), { x: 9, y: 1, z: 0 });
    t = 10.3;
    audio.update(sound({ hums: swarms, hums_n: 10 }), ORIGIN);
    expect(first.gains).toEqual([0.2, 0.4]);
    expect(first.stopped).toBe(false);
    expect(fake.loops.length).toBe(8);
    audio.dispose();
  });

  it("the hums glide to a new pitch, and a change under half a hertz is not sent", () => {
    const fake = fakeAmbient();
    const audio = createWaterLifeAudio(fake.ambient, () => 0.5, () => 0);
    const swarms = [{ x: 1, y: 1, z: 0, midges: 200, presence: 1 }];
    audio.update(sound({ hums: swarms, hums_n: 1, pitch: 230 }), ORIGIN);
    const saws = fake.oscillators.filter((o) => o.type === "sawtooth");
    expect(saws.map((o) => o.frequency.value.toFixed(2)))
      .toEqual(["211.60", "218.96", "226.32", "233.68", "241.04", "248.40"]);
    audio.update(sound({ hums: swarms, hums_n: 1, pitch: 250 }), ORIGIN);
    expect(saws.map((o) => o.frequency.targets.map((v) => v.toFixed(2))))
      .toEqual([["230.00"], ["238.00"], ["246.00"], ["254.00"], ["262.00"], ["270.00"]]);
    audio.update(sound({ hums: swarms, hums_n: 1, pitch: 250.3 }), ORIGIN);
    expect(saws.every((o) => o.frequency.targets.length === 1)).toBe(true);
    audio.dispose();
  });

  it("frog calls: a one-shot each at −z at the call's gain, at most twelve sounding, the nearest first, none beyond 120 m", () => {
    const fake = fakeAmbient();
    let t = 1;
    const audio = createWaterLifeAudio(fake.ambient, () => 0.5, () => t);
    // Fourteen calls 5 m to 70 m along x, and one 125 m along it, all 5 m off on z.
    const calls = Array.from({ length: 14 }, (_, i) => frogCall(i, 70 - 5 * i)).concat([frogCall(14, 125)]);
    audio.update(sound({ frogCalls: calls }), ORIGIN);
    const made = frogs(fake.loops);
    expect(made.map((l) => l.x)).toEqual([5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60]);
    expect(made[0]!.gain).toBe(3);
    expect(made[0]!.z).toBe(-5);
    // While they sound, a new call finds no slot.
    t = 1.4;
    audio.update(sound({ frogCalls: [frogCall(0, 8)] }), ORIGIN);
    expect(frogs(fake.loops).length).toBe(12);
    // Once a call has run its length its emitter stops and the slot is free.
    t = 1.5;
    audio.update(sound({ frogCalls: [frogCall(0, 8)] }), ORIGIN);
    expect(made.every((l) => l.stopped)).toBe(true);
    expect(frogs(fake.loops).length).toBe(13);
    expect(frogs(fake.loops)[12]!.z).toBe(-5);
    audio.dispose();
  });

  it("a frog voice keeps its carrier from call to call", () => {
    const fake = fakeAmbient();
    let t = 0;
    const draws = [0.2, 0.5, 0.8, 0.5];
    let d = 0;
    const audio = createWaterLifeAudio(fake.ambient, () => draws[d++ % draws.length]!, () => t);
    audio.update(sound({ frogCalls: [frogCall(3, 20)] }), ORIGIN);
    t = 2;
    audio.update(sound({ frogCalls: [frogCall(3, 20)] }), ORIGIN);
    const firstNotes = fake.oscillators.filter((o) => o.frequency.value > 1000 && o.frequency.value < 2300);
    expect(firstNotes.map((o) => o.frequency.value)).toEqual([2100, 2100]);
    audio.dispose();
  });

  it("rustles: at most two at once, the nearest first, none beyond 3 m; a chase's clatter holds its slot longer", () => {
    const fake = fakeAmbient();
    let t = 0;
    const audio = createWaterLifeAudio(fake.ambient, () => 0.5, () => t);
    audio.update(sound({
      rustles: [
        { x: 2.5, y: 1, z: 0, loud: false },
        { x: 1, y: 1, z: 1, loud: true },
        { x: 4, y: 1, z: 0, loud: false },
        { x: 2, y: 1, z: 0.5, loud: false },
      ],
    }), ORIGIN);
    const made = rustles(fake.loops);
    expect(made.map((l) => [l.x, l.z, l.gain])).toEqual([[1, -1, 1], [2, -0.5, 1]]);
    t = 0.3;
    audio.update(sound({ rustles: [{ x: 1.5, y: 1, z: 0, loud: false }] }), ORIGIN);
    expect(rustles(fake.loops).length).toBe(2);
    // The quiet one's 0.25 s has run, the clatter's 0.4 s has not.
    t = 0.4;
    audio.update(sound({ rustles: [{ x: 1.5, y: 1, z: 0, loud: false }, { x: 0.5, y: 1, z: 0, loud: false }] }), ORIGIN);
    expect(made.map((l) => l.stopped)).toEqual([false, true]);
    expect(rustles(fake.loops).map((l) => l.x)).toEqual([1, 2, 0.5]);
    audio.dispose();
  });

  it("dispose stops every hum, call and rustle, and an update after it builds nothing", () => {
    const fake = fakeAmbient();
    const audio = createWaterLifeAudio(fake.ambient, () => 0.5, () => 0);
    audio.update(sound({
      hums: rowOfSwarms(), hums_n: 10,
      frogCalls: [frogCall(0, 20)],
      rustles: [{ x: 1, y: 1, z: 0, loud: false }],
    }), ORIGIN);
    expect(fake.loops.length).toBe(10);
    audio.dispose();
    expect(fake.loops.every((l) => l.stopped)).toBe(true);
    audio.update(sound({ hums: rowOfSwarms(), hums_n: 10, frogCalls: [frogCall(1, 20)] }), ORIGIN);
    expect(fake.loops.length).toBe(10);
  });
});
