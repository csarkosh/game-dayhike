/**
 * The car at the end (docs/gameplay/2026-10-12-the-end-scene.md §2): the door
 * shut, the engine cranked and caught, two revs, and from the pull-away the
 * engine and the tyres following the car down the road. Synthesized on the
 * ambient context, as the chase's pulse is, into the `car` bus off the master
 * (ambientAudio.ts), so the world's fade leaves it; placed at the car and
 * heard from the listener, its level and its brightness falling with the
 * distance. The engine is the intro's engine bed: six harmonics at 1/k each
 * over a fundamental that wanders, under band noise, so the two films' cars
 * sound alike.
 *
 * The schedule and the curves are pure (`CAR_CUES`, `engineHz`, `revHz`,
 * `carLevel`, `carCutoffHz`); `createCarAudio` plays them.
 */

/** The cues, seconds after `start`: the door, the crank's first pulse, the catch, the first rev. */
export const DOOR_AT_S = 0.3;
export const CRANK_AT_S = 0.8;
/** The crank: this many pulses, this many a second. */
export const CRANK_PULSES = 4;
export const CRANK_HZ = 8;
export const CATCH_AT_S = 1.4;
export const REV_AT_S = 2.2;
/** A rev: the fundamental up to `REV_HZ` over `REV_UP_S` and back over `REV_DOWN_S`; the second starts `REV_GAP_S` after the first. */
export const REV_HZ = 72;
export const REV_UP_S = 0.25;
export const REV_DOWN_S = 0.5;
export const REV_GAP_S = 0.8;
/** The idle: the fundamental, and how far and how slowly it wanders either side of it. */
export const IDLE_HZ = 31;
export const IDLE_WANDER_HZ = 0.6;
export const IDLE_WANDER_S = 3.1;
/** The engine's tone: this many harmonics of the fundamental, the k-th at 1/k. */
export const ENGINE_HARMONICS = 6;
/** Driving: the fundamental climbs this many Hz a m/s within a gear; at each change in `GEAR_MPS` it drops by `GEAR_DROP` of itself. */
export const HZ_PER_MPS = 4.5;
export const GEAR_MPS: readonly number[] = [6, 11];
export const GEAR_DROP = 0.35;
/** The distance: the level halves at `CAR_LEVEL_M`, and the low-pass closes from `CAR_OPEN_HZ` to `CAR_SHUT_HZ` over `CAR_MUFFLE_M`. */
export const CAR_LEVEL_M = 8;
export const CAR_MUFFLE_M = 120;
export const CAR_OPEN_HZ = 4000;
export const CAR_SHUT_HZ = 800;
/** The car's level at the ear, under the master volume. */
export const CAR_LEVEL = 0.6;
/** The tyres: noise in this band, its gain this much a m/s. */
export const TYRE_HZ: readonly [number, number] = [2000, 6000];
export const TYRE_LEVEL_PER_MPS = 0.02;
/** The engine's band noise, and its gain as a share of the tone's. */
export const ENGINE_NOISE_HZ: readonly [number, number] = [60, 400];
export const ENGINE_NOISE_SHARE = 0.4;
/** The engine's bed once caught, and the seconds it comes in over: the six harmonics at 1/k peak at 2.45 together, so 0.4 keeps the tone under full scale. */
export const ENGINE_LEVEL = 0.4;
export const CATCH_FADE_S = 0.2;
/** The door: a dull tone this low and this long, and a burst of noise under this low-pass. */
export const DOOR_HZ = 90;
export const DOOR_S = 0.12;
export const DOOR_NOISE_HZ = 300;
export const DOOR_LEVEL = 0.9;
/** A crank pulse: a damped tone this low, falling away over this long. */
export const CRANK_TONE_HZ = 60;
export const CRANK_DECAY_S = 0.06;
export const CRANK_LEVEL = 0.6;
/** The time constant the engine, the tyres, the level and the low-pass follow a frame's values with. */
export const CAR_FOLLOW_S = 0.05;

export type CarCueName = "door" | "crank" | "catch" | "rev" | "rev2";

/** The cues as data, in time order, seconds after `start`. */
export const CAR_CUES: readonly { name: CarCueName; at: number }[] = [
  { name: "door", at: DOOR_AT_S },
  { name: "crank", at: CRANK_AT_S },
  { name: "catch", at: CATCH_AT_S },
  { name: "rev", at: REV_AT_S },
  { name: "rev2", at: REV_AT_S + REV_GAP_S },
];

/** The fundamental while driving at `speedMps`: the idle plus the climb within each gear, less the drop at each change. */
export function engineHz(speedMps: number): number {
  const v = Math.max(0, speedMps);
  let hz = IDLE_HZ;
  let from = 0;
  for (const change of GEAR_MPS) {
    if (v < change) break;
    hz = (hz + HZ_PER_MPS * (change - from)) * (1 - GEAR_DROP);
    from = change;
  }
  return hz + HZ_PER_MPS * (v - from);
}

/**
 * The fundamental `secondsIntoRev` into a rev from the idle: up to `REV_HZ`,
 * back to the idle, the idle either side. The graph plays a rev as this less
 * the idle, a fixed offset over whatever note the speed has set.
 */
export function revHz(secondsIntoRev: number): number {
  const s = secondsIntoRev;
  if (!(s > 0)) return IDLE_HZ;
  if (s <= REV_UP_S) return IDLE_HZ + (REV_HZ - IDLE_HZ) * (s / REV_UP_S);
  if (s <= REV_UP_S + REV_DOWN_S) return REV_HZ - (REV_HZ - IDLE_HZ) * ((s - REV_UP_S) / REV_DOWN_S);
  return IDLE_HZ;
}

/** The car's level `d` metres from the listener. */
export function carLevel(d: number): number {
  return CAR_LEVEL / (1 + Math.max(0, d) / CAR_LEVEL_M);
}

/** The car's low-pass `d` metres from the listener: open near, shut at `CAR_MUFFLE_M` and beyond. */
export function carCutoffHz(d: number): number {
  const t = Math.min(1, Math.max(0, d) / CAR_MUFFLE_M);
  return CAR_OPEN_HZ + (CAR_SHUT_HZ - CAR_OPEN_HZ) * t;
}

/** The listener in Web Audio's frame: where it is, and its forward and up. */
export type EarFrame = { x: number; y: number; z: number; fx: number; fy: number; fz: number; ux: number; uy: number; uz: number };

/** A place relative to the listener: x right, y up, z ahead, metres. */
export type CarPlace = { x: number; y: number; z: number };

export type CarAudio = {
  /** The schedule, from the context's clock now: the door, the crank, the catch, the revs. A second call while playing is nothing. */
  start(): void;
  /** One frame: the car's speed (m/s) and its place relative to the listener. Inert before `start` and after `stop`. */
  set(speedMps: number, rel: CarPlace): void;
  /** Every source stopped and every node disconnected. */
  stop(): void;
};

/** Web Audio's listener at rest: at the origin, facing −z, up +y. */
const EAR_AT_REST: EarFrame = { x: 0, y: 0, z: 0, fx: 0, fy: 0, fz: -1, ux: 0, uy: 1, uz: 0 };

/** A band-pass over [lo, hi] Hz: centred at their geometric mean, its Q the centre over the width. */
function band(ctx: AudioContext, [lo, hi]: readonly [number, number]): BiquadFilterNode {
  const f = ctx.createBiquadFilter();
  f.type = "bandpass";
  const centre = Math.sqrt(lo * hi);
  f.frequency.value = centre;
  f.Q.value = centre / (hi - lo);
  return f;
}

/**
 * The car's graph on `ctx` into `out`, reading the shared `noise`. `ear` is
 * the listener's frame, read each `set` to place the car as the woods' odd
 * sounds are placed (ambientAudio.ts `playOdd`): an HRTF panner with no
 * rolloff of its own, the distance being `carLevel`'s and `carCutoffHz`'s.
 *
 * The engine's harmonics are six sines at k × the fundamental. Their
 * frequencies are the fundamental the speed gives (`set`, from the first
 * frame the car moves), plus one shared offset scaled by k: the idle's
 * wander, a sine of `IDLE_WANDER_HZ` at 1 / `IDLE_WANDER_S` Hz, and the revs,
 * a constant source whose offset is scheduled 0 up to `REV_HZ − IDLE_HZ` and
 * back. The offset sits apart from what `set` moves, so a rev that falls
 * after the pull-away rides on the speed's fundamental rather than being cut
 * by it.
 */
export function createCarAudio(ctx: AudioContext, out: AudioNode, noise: AudioBuffer, ear: Readonly<EarFrame> = EAR_AT_REST): CarAudio {
  let playing = false;
  /** Latched by the first frame with speed: from then the fundamental is the speed's. */
  let driving = false;
  const sources: AudioScheduledSourceNode[] = [];
  const nodes: AudioNode[] = [];
  const harmonics: OscillatorNode[] = [];
  let mix: GainNode | null = null;
  let muffle: BiquadFilterNode | null = null;
  let level: GainNode | null = null;
  let panner: PannerNode | null = null;
  let tyres: GainNode | null = null;

  function made<T extends AudioNode>(node: T): T {
    nodes.push(node);
    return node;
  }
  function source<T extends AudioScheduledSourceNode>(node: T): T {
    sources.push(node);
    return made(node);
  }

  /** A damped tone at `at`: up within 5 ms, down to nothing over `s`. */
  function tone(into: AudioNode, at: number, hz: number, s: number, peak: number): void {
    const osc = source(ctx.createOscillator());
    osc.type = "sine";
    osc.frequency.value = hz;
    const g = made(ctx.createGain());
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(peak, at + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, at + s);
    osc.connect(g);
    g.connect(into);
    osc.start(at);
    osc.stop(at + s + 0.02);
  }

  function noiseSource(loop: boolean): AudioBufferSourceNode {
    const src = source(ctx.createBufferSource());
    src.buffer = noise;
    src.loop = loop;
    return src;
  }

  return {
    start() {
      if (playing) return;
      playing = true;
      const now = ctx.currentTime;

      // Everything sums here, then the distance's low-pass and level, then the place.
      mix = made(ctx.createGain());
      mix.gain.value = 1;
      muffle = made(ctx.createBiquadFilter());
      muffle.type = "lowpass";
      muffle.frequency.value = CAR_OPEN_HZ;
      level = made(ctx.createGain());
      level.gain.value = CAR_LEVEL;
      panner = made(ctx.createPanner());
      panner.panningModel = "HRTF";
      panner.distanceModel = "inverse";
      panner.rolloffFactor = 0;
      mix.connect(muffle);
      muffle.connect(level);
      level.connect(panner);
      panner.connect(out);

      // The door: a dull tone and a burst of noise under a low-pass.
      const door = now + DOOR_AT_S;
      tone(mix, door, DOOR_HZ, DOOR_S, DOOR_LEVEL);
      const slam = noiseSource(false);
      const slamFilter = made(ctx.createBiquadFilter());
      slamFilter.type = "lowpass";
      slamFilter.frequency.value = DOOR_NOISE_HZ;
      const slamGain = made(ctx.createGain());
      slamGain.gain.setValueAtTime(0, door);
      slamGain.gain.linearRampToValueAtTime(DOOR_LEVEL * 0.5, door + 0.003);
      slamGain.gain.exponentialRampToValueAtTime(0.0001, door + DOOR_S / 2);
      slam.connect(slamFilter);
      slamFilter.connect(slamGain);
      slamGain.connect(mix);
      slam.start(door);
      slam.stop(door + DOOR_S);

      // The crank.
      for (let i = 0; i < CRANK_PULSES; i++) {
        tone(mix, now + CRANK_AT_S + i / CRANK_HZ, CRANK_TONE_HZ, CRANK_DECAY_S, CRANK_LEVEL);
      }

      // The engine's bed, in over CATCH_FADE_S from the catch.
      const caught = now + CATCH_AT_S;
      const engine = made(ctx.createGain());
      engine.gain.value = 0;
      engine.gain.setValueAtTime(0, caught);
      engine.gain.linearRampToValueAtTime(ENGINE_LEVEL, caught + CATCH_FADE_S);
      engine.connect(mix);
      const toneBus = made(ctx.createGain());
      toneBus.gain.value = 1;
      toneBus.connect(engine);
      // The shared offset on the fundamental: the wander and the revs.
      const offset = made(ctx.createGain());
      offset.gain.value = 1;
      const wander = source(ctx.createOscillator());
      wander.type = "sine";
      wander.frequency.value = 1 / IDLE_WANDER_S;
      const wanderDepth = made(ctx.createGain());
      wanderDepth.gain.value = IDLE_WANDER_HZ;
      wander.connect(wanderDepth);
      wanderDepth.connect(offset);
      const revs = source(ctx.createConstantSource());
      revs.offset.value = 0;
      for (let i = 0; i < 2; i++) {
        const at = now + REV_AT_S + i * REV_GAP_S;
        revs.offset.setValueAtTime(0, at);
        revs.offset.linearRampToValueAtTime(REV_HZ - IDLE_HZ, at + REV_UP_S);
        revs.offset.linearRampToValueAtTime(0, at + REV_UP_S + REV_DOWN_S);
      }
      revs.connect(offset);
      for (let k = 1; k <= ENGINE_HARMONICS; k++) {
        const osc = source(ctx.createOscillator());
        osc.type = "sine";
        osc.frequency.value = k * IDLE_HZ;
        const scale = made(ctx.createGain());
        scale.gain.value = k;
        offset.connect(scale);
        scale.connect(osc.frequency);
        const g = made(ctx.createGain());
        g.gain.value = 1 / k;
        osc.connect(g);
        g.connect(toneBus);
        osc.start(caught);
        harmonics.push(osc);
      }
      wander.start(caught);
      revs.start(caught);
      const rumble = noiseSource(true);
      const rumbleBand = made(band(ctx, ENGINE_NOISE_HZ));
      const rumbleGain = made(ctx.createGain());
      rumbleGain.gain.value = ENGINE_NOISE_SHARE;
      rumble.connect(rumbleBand);
      rumbleBand.connect(rumbleGain);
      rumbleGain.connect(engine);
      rumble.start(caught);

      // The tyres: silent until the car moves.
      const road = noiseSource(true);
      const roadBand = made(band(ctx, TYRE_HZ));
      tyres = made(ctx.createGain());
      tyres.gain.value = 0;
      road.connect(roadBand);
      roadBand.connect(tyres);
      tyres.connect(mix);
      road.start(now);
    },
    set(speedMps, rel) {
      if (!playing || !level || !muffle || !panner || !tyres) return;
      const now = ctx.currentTime;
      const v = Math.max(0, speedMps);
      if (v > 0) driving = true;
      if (driving) {
        const f0 = engineHz(v);
        for (let i = 0; i < harmonics.length; i++) {
          (harmonics[i] as OscillatorNode).frequency.setTargetAtTime((i + 1) * f0, now, CAR_FOLLOW_S);
        }
      }
      tyres.gain.setTargetAtTime(TYRE_LEVEL_PER_MPS * v, now, CAR_FOLLOW_S);
      const d = Math.hypot(rel.x, rel.y, rel.z);
      level.gain.setTargetAtTime(carLevel(d), now, CAR_FOLLOW_S);
      muffle.frequency.setTargetAtTime(carCutoffHz(d), now, CAR_FOLLOW_S);
      // The listener's frame to the world's: right is forward across up.
      const rx = ear.fy * ear.uz - ear.fz * ear.uy;
      const ry = ear.fz * ear.ux - ear.fx * ear.uz;
      const rz = ear.fx * ear.uy - ear.fy * ear.ux;
      panner.positionX.value = ear.x + rx * rel.x + ear.ux * rel.y + ear.fx * rel.z;
      panner.positionY.value = ear.y + ry * rel.x + ear.uy * rel.y + ear.fy * rel.z;
      panner.positionZ.value = ear.z + rz * rel.x + ear.uz * rel.y + ear.fz * rel.z;
    },
    stop() {
      if (!playing) return;
      playing = false;
      for (const src of sources) {
        try { src.stop(ctx.currentTime); } catch { /* already ended */ }
      }
      for (const node of nodes) node.disconnect();
      sources.length = 0;
      nodes.length = 0;
      harmonics.length = 0;
      mix = muffle = level = tyres = null;
      panner = null;
    },
  };
}
