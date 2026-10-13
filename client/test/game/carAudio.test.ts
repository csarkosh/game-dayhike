import { describe, it, expect } from "vitest";
import { CAR_CUES, carCutoffHz, carLevel, createCarAudio, engineHz, revHz } from "../../src/game/carAudio.js";
import { fakeCtx } from "./helpers/fakeAudio.js";

describe("the car's schedule", () => {
  it("is the door, the crank, the catch and two revs, in time order", () => {
    expect(CAR_CUES.map((c) => c.name)).toEqual(["door", "crank", "catch", "rev", "rev2"]);
    const at = CAR_CUES.map((c) => c.at);
    for (const [i, s] of [0.3, 0.8, 1.4, 2.2, 3.0].entries()) expect(at[i]).toBeCloseTo(s, 12);
  });
});

describe("the fundamental", () => {
  it("is the idle at rest and climbs 4.5 Hz a m/s within a gear", () => {
    expect(engineHz(0)).toBe(31);
    expect(engineHz(5)).toBeCloseTo(53.5, 9);
  });

  it("drops by 0.35 of itself at 6 m/s and again at 11, climbing from there", () => {
    expect(engineHz(6)).toBeCloseTo(37.7, 9);
    expect(engineHz(8)).toBeCloseTo(46.7, 9);
    expect(engineHz(11)).toBeCloseTo(39.13, 9);
    expect(engineHz(12)).toBeCloseTo(43.63, 9);
    expect(engineHz(-3)).toBe(31);
  });

  it("in a rev, rises to 72 Hz over a quarter second and falls back over a half, the idle either side", () => {
    expect(revHz(-0.1)).toBe(31);
    expect(revHz(0)).toBe(31);
    expect(revHz(0.25)).toBeCloseTo(72, 12);
    expect(revHz(0.5)).toBeCloseTo(51.5, 12);
    expect(revHz(0.75)).toBeCloseTo(31, 12);
    expect(revHz(1)).toBe(31);
  });
});

describe("the distance", () => {
  it("halves the level at 8 m and closes the low-pass from 4 kHz to 800 Hz over 120 m", () => {
    expect(carLevel(0)).toBeCloseTo(0.6, 12);
    expect(carLevel(8)).toBeCloseTo(0.3, 12);
    expect(carLevel(120)).toBeCloseTo(0.0375, 12);
    expect(carCutoffHz(0)).toBe(4000);
    expect(carCutoffHz(60)).toBeCloseTo(2400, 9);
    expect(carCutoffHz(120)).toBeCloseTo(800, 9);
    expect(carCutoffHz(240)).toBeCloseTo(800, 9);
  });
});

type Fake = ReturnType<typeof fakeCtx>;
type Osc = Fake["created"]["oscillatorNodes"][number];
type Gain = Fake["created"]["gains"][number];

/** A car started at 10 s on the context's clock, into a bus of the fake's own. */
function startedCar() {
  const fake = fakeCtx();
  const out = fake.ctx.createGain();
  const noise = fake.ctx.createBuffer(1, 48000, 48000);
  fake.clock.currentTime = 10;
  const car = createCarAudio(fake.ctx, out, noise);
  car.start();
  const { created } = fake;
  const harmonics = created.oscillatorNodes.filter((o) => o.startedAt !== undefined && Math.abs(o.startedAt - 11.4) < 1e-9 && o.frequency.value > 1);
  return { ...fake, out, car, harmonics };
}

/** The gain an oscillator plays into. */
const gainOf = (o: Osc): Gain => o.connections[0] as Gain;

describe("createCarAudio", () => {
  it("shuts the door at 0.3 s: a 90 Hz tone decaying over 0.12 s, and a burst of noise under a 300 Hz low-pass", () => {
    const { created } = startedCar();
    const door = created.oscillatorNodes.filter((o) => o.frequency.value === 90);
    expect(door).toHaveLength(1);
    expect(door[0]!.startedAt).toBeCloseTo(10.3, 9);
    const env = gainOf(door[0]!).gain.ramps;
    expect(env.map((r) => r.kind)).toEqual(["set", "linear", "exponential"]);
    expect(env[0]!.time).toBeCloseTo(10.3, 9);
    expect(env[2]!.time).toBeCloseTo(10.42, 9);
    const burst = created.sources.filter((s) => !s.loop);
    expect(burst).toHaveLength(1);
    expect(burst[0]!.startedAt).toBeCloseTo(10.3, 9);
    const lowpass = burst[0]!.connections[0] as Fake["created"]["filterNodes"][number];
    expect(lowpass.type).toBe("lowpass");
    expect(lowpass.frequency.value).toBe(300);
  });

  it("cranks four pulses of a 60 Hz tone eight a second from 0.8 s, each gone within 60 ms", () => {
    const { created } = startedCar();
    const crank = created.oscillatorNodes.filter((o) => o.frequency.value === 60);
    expect(crank).toHaveLength(4);
    for (const [i, s] of [10.8, 10.925, 11.05, 11.175].entries()) {
      expect(crank[i]!.startedAt).toBeCloseTo(s, 9);
      const env = gainOf(crank[i]!).gain.ramps;
      expect(env.at(-1)!.kind).toBe("exponential");
      expect(env.at(-1)!.time).toBeCloseTo(s + 0.06, 9);
    }
  });

  it("catches at 1.4 s: six harmonics of 31 Hz at 1/k, band noise at 0.4 of the tone, the bed in over 0.2 s", () => {
    const { created, harmonics } = startedCar();
    expect(harmonics.map((o) => o.frequency.value)).toEqual([31, 62, 93, 124, 155, 186]);
    const levels = harmonics.map((o) => gainOf(o).gain.value);
    for (const [i, v] of [1, 0.5, 0.3333333333, 0.25, 0.2, 0.1666666667].entries()) expect(levels[i]).toBeCloseTo(v, 9);
    const tone = gainOf(harmonics[0]!).connections[0] as Gain;
    for (const o of harmonics) expect(gainOf(o).connections).toEqual([tone]);
    const engine = tone.connections[0] as Gain;
    const fadeIn = engine.gain.ramps;
    expect(fadeIn.map((r) => [r.kind, r.value])).toEqual([["set", 0], ["linear", 0.4]]);
    expect(fadeIn[0]!.time).toBeCloseTo(11.4, 9);
    expect(fadeIn[1]!.time).toBeCloseTo(11.6, 9);
    // The band noise: a looping source from the catch, through a band-pass
    // centred between 60 and 400 Hz, at 0.4 into the same bed.
    const rumble = created.sources.find((s) => s.loop && s.startedAt !== undefined && Math.abs(s.startedAt - 11.4) < 1e-9)!;
    const bandpass = rumble.connections[0] as Fake["created"]["filterNodes"][number];
    expect(bandpass.type).toBe("bandpass");
    expect(bandpass.frequency.value).toBeCloseTo(154.919333848, 6);
    const rumbleGain = bandpass.connections[0] as Gain;
    expect(rumbleGain.gain.value).toBe(0.4);
    expect(rumbleGain.connections).toEqual([engine]);
  });

  it("wanders the fundamental 0.6 Hz over 3.1 s and revs it twice, each harmonic by k times the offset", () => {
    const { created, harmonics } = startedCar();
    const wander = created.oscillatorNodes.find((o) => o.frequency.value < 1)!;
    expect(wander.frequency.value).toBeCloseTo(0.3225806452, 9);
    const depth = wander.connections[0] as Gain;
    expect(depth.gain.value).toBe(0.6);
    const offset = depth.connections[0] as Gain;
    expect(created.constants).toHaveLength(1);
    const revs = created.constants[0]!;
    expect(revs.connections).toEqual([offset]);
    expect(revs.offset.value).toBe(0);
    const ramps = revs.offset.ramps;
    const expected: [string, number, number][] = [
      ["set", 0, 12.2], ["linear", 41, 12.45], ["linear", 0, 12.95],
      ["set", 0, 13], ["linear", 41, 13.25], ["linear", 0, 13.75],
    ];
    expect(ramps).toHaveLength(6);
    for (const [i, [kind, value, time]] of expected.entries()) {
      expect(ramps[i]!.kind).toBe(kind);
      expect(ramps[i]!.value).toBe(value);
      expect(ramps[i]!.time).toBeCloseTo(time, 9);
    }
    // The offset reaches each harmonic's frequency through a gain of k.
    const scales = offset.connections as Gain[];
    expect(scales.map((g) => g.gain.value)).toEqual([1, 2, 3, 4, 5, 6]);
    for (const [i, g] of scales.entries()) expect(g.connections).toEqual([harmonics[i]!.frequency]);
    expect(revs.started).toBe(true);
    expect(wander.startedAt).toBeCloseTo(11.4, 9);
  });

  it("leaves the fundamental to the schedule until the car moves, then follows the speed", () => {
    const { car, harmonics, clock } = startedCar();
    clock.currentTime = 12;
    car.set(0, { x: 0, y: 0, z: 8 });
    for (const o of harmonics) expect(o.frequency.targets).toEqual([]);
    clock.currentTime = 14;
    car.set(8, { x: 0, y: 0, z: 8 });
    const at = harmonics.map((o) => o.frequency.targets.at(-1)!);
    for (const [i, hz] of [46.7, 93.4, 140.1, 186.8, 233.5, 280.2].entries()) {
      expect(at[i]!.value).toBeCloseTo(hz, 9);
      expect(at[i]!.time).toBe(14);
      expect(at[i]!.tc).toBe(0.05);
    }
  });

  it("sets the level, the low-pass, the tyres and the place from the car's distance and speed", () => {
    const { car, created, out, clock } = startedCar();
    const panner = created.panners[0]!;
    expect(panner.panningModel).toBe("HRTF");
    expect(panner.rolloffFactor).toBe(0);
    expect(panner.connections).toEqual([out]);
    const level = created.gains.find((g) => g.connections.includes(panner))!;
    const muffle = created.filterNodes.find((f) => f.connections.includes(level))!;
    expect(muffle.type).toBe("lowpass");
    const road = created.sources.find((s) => s.loop && s.startedAt === 10)!;
    const tyreBand = road.connections[0] as Fake["created"]["filterNodes"][number];
    expect(tyreBand.type).toBe("bandpass");
    expect(tyreBand.frequency.value).toBeCloseTo(3464.10161514, 6);
    const tyres = tyreBand.connections[0] as Gain;
    expect(tyres.gain.value).toBe(0);

    clock.currentTime = 20;
    car.set(8, { x: 0, y: 0, z: 8 });
    expect(level.gain.targets.at(-1)!.value).toBeCloseTo(0.3, 12);
    expect(muffle.frequency.targets.at(-1)!.value).toBeCloseTo(3786.666666667, 6);
    expect(tyres.gain.targets.at(-1)!.value).toBeCloseTo(0.16, 12);
    // Ahead of a listener at rest is −z in Web Audio's frame.
    expect([panner.positionX.value, panner.positionY.value, panner.positionZ.value]).toEqual([0, 0, -8]);

    car.set(14, { x: 120, y: 0, z: 0 });
    expect(level.gain.targets.at(-1)!.value).toBeCloseTo(0.0375, 12);
    expect(muffle.frequency.targets.at(-1)!.value).toBeCloseTo(800, 9);
    expect(tyres.gain.targets.at(-1)!.value).toBeCloseTo(0.28, 12);
    expect([panner.positionX.value, panner.positionY.value, panner.positionZ.value]).toEqual([120, 0, 0]);
  });

  it("places the car in the listener's own frame as it turns", () => {
    const fake = fakeCtx();
    const ear = { x: 5, y: 2, z: -3, fx: 1, fy: 0, fz: 0, ux: 0, uy: 1, uz: 0 };
    const car = createCarAudio(fake.ctx, fake.ctx.createGain(), fake.ctx.createBuffer(1, 48000, 48000), ear);
    car.start();
    const panner = fake.created.panners[0]!;
    // Facing +x, the right is +z: 4 m ahead and 2 m right.
    car.set(0, { x: 2, y: 0, z: 4 });
    expect([panner.positionX.value, panner.positionY.value, panner.positionZ.value]).toEqual([9, 2, -1]);
  });

  it("makes no node in a frame", () => {
    const { car, created, clock } = startedCar();
    const count = () => created.gains.length + created.filterNodes.length + created.oscillatorNodes.length + created.sources.length + created.panners.length + created.constants.length;
    const before = count();
    for (let f = 0; f < 600; f++) {
      clock.currentTime = 13 + f / 60;
      car.set(f / 40, { x: 1, y: 0, z: f / 10 });
    }
    expect(count()).toBe(before);
  });

  it("is inert before start, and stop stops every source and disconnects every node", () => {
    const fake = fakeCtx();
    const out = fake.ctx.createGain();
    const bus = fake.created.gains[0]!;
    const car = createCarAudio(fake.ctx, out, fake.ctx.createBuffer(1, 48000, 48000));
    car.set(8, { x: 0, y: 0, z: 8 });
    car.stop();
    expect(fake.created.gains).toHaveLength(1);
    const { created, clock } = fake;
    clock.currentTime = 10;
    car.start();
    // The revs' source starts at the catch, with the harmonics.
    expect(created.constants).toHaveLength(1);
    expect(created.constants[0]!.startedAt).toBeCloseTo(11.4, 9);
    const harmonics = created.oscillatorNodes.filter((o) => o.frequency.value > 1 && o.frequency.value % 31 === 0);
    expect(harmonics.map((o) => o.frequency.value)).toEqual([31, 62, 93, 124, 155, 186]);
    for (const o of harmonics) expect(o.stoppedAt).toBeUndefined();
    clock.currentTime = 20;
    car.stop();
    for (const o of harmonics) expect(o.stoppedAt).toBe(20);
    for (const o of created.oscillatorNodes) expect(o.stopped).toBe(true);
    for (const s of created.sources) expect(s.stopped).toBe(true);
    for (const c of created.constants) expect(c.stopped).toBe(true);
    // Every node the car made is disconnected; only the bus it played into is left.
    const made = [
      ...created.gains, ...created.filterNodes, ...created.oscillatorNodes,
      ...created.sources, ...created.constants, ...created.panners,
    ].filter((n) => n !== bus);
    expect(made.length).toBeGreaterThan(30);
    for (const n of made) expect(n.disconnected).toBe(true);
    expect(bus.disconnected).toBe(false);
    const targets = created.gains.reduce((n, g) => n + g.gain.targets.length, 0);
    car.set(8, { x: 0, y: 0, z: 8 });
    expect(created.gains.reduce((n, g) => n + g.gain.targets.length, 0)).toBe(targets);
  });
});
