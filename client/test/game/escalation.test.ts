import { describe, expect, it } from "vitest";
import { createWorld, spawnPlayer } from "../../src/sim/world.js";
import { parseLevel } from "../../src/sim/level.js";
import { AiState } from "../../src/sim/types.js";
import { ENEMY_HALF, PLAYER_EYE_OFFSET } from "../../src/sim/constants.js";
import { installRegister, type Register } from "../../src/sim/register.js";
import { spawnHollow } from "../../src/sim/hollow.js";
import { WEATHER_PRESETS } from "../../src/game/weather.js";
import { wildlifePresenceUnder } from "../../src/game/wildlifeBehaviour.js";
import {
  ESCALATION_REST, LENS_EASE_S, NEAR_BLIND, NEAR_FULL, NEAR_START, NIGHT_HOUR, OFF_TRAIL_FULL, OFF_TRAIL_START,
  SPIKE_DECAY_S, SPIKE_RISE_S, WORLD_EASE_S, atmosphereUnder, escalationTargets, stepEscalation,
  type EscalationTargets,
} from "../../src/game/escalation.js";
import { graph } from "../sim/helpers/registerGraph.js";

type Brush = { min: [number, number, number]; max: [number, number, number]; material: string };
const FLOOR: Brush = { min: [-300, -1, -300], max: [300, 0, 300], material: "concrete" };
const level = (...walls: Brush[]) =>
  parseLevel({ id: "flat", brushes: [FLOOR, ...walls], playerSpawns: [[0, 0.9, 0]], enemySpawns: [] });

/** Two hikers, the box and the car off the stem's pad; the one-loop hand graph as the trail. */
function register(): Register {
  const site = (name: string, x: number, z: number) => ({ kind: "meadow" as const, name, x, y: 0, z, progress: 1 });
  return {
    hikers: [{ id: 0, name: "Owen Marsh", site: site("the meadow", 150, 60) }, { id: 1, name: "Dana Whitcombe", site: site("the summit", 200, 0) }],
    box: { x: 0, y: 1, z: -20 },
    car: { x: 30, y: 0.8, z: -20 },
  };
}

function world(...walls: Brush[]) {
  const w = createWorld(level(...walls), 1);
  w.trail = graph(1);
  installRegister(w, register());
  const p = spawnPlayer(w);
  p.pos = { x: 100, y: 0.9, z: 0 }; // on the stem's middle node
  return { w, p };
}

const targetsOf = (w: ReturnType<typeof world>["w"], id: number) =>
  escalationTargets(w.state, id, w.register!, w.trail!, w.boxes, w.ground);

describe("escalationTargets", () => {
  it("floors on hikers picked up at least once, and not on a second pick-up or a put-down", () => {
    const { w, p } = world();
    expect(targetsOf(w, p.id).world).toBe(0);
    w.state.items[0]!.pickedUp = true;
    expect(targetsOf(w, p.id).world).toBeCloseTo(0.5, 9);
    w.state.items[0]!.carrier = 0; // put down: still picked up once
    expect(targetsOf(w, p.id).world).toBeCloseTo(0.5, 9);
    w.state.items[1]!.pickedUp = true;
    expect(targetsOf(w, p.id).world).toBe(1);
  });

  it("creeps with the furthest Hollow down the stem, a hunting one at its nearest stem point", () => {
    const { w, p } = world();
    spawnHollow(w, { x: 160, y: ENEMY_HALF.y, z: 0 }, AiState.Crawl);
    expect(targetsOf(w, p.id).world).toBeCloseTo(0.2, 9);
    spawnHollow(w, { x: 120, y: ENEMY_HALF.y, z: 50 }, AiState.Hunt, p.id); // beside the stem at x = 120
    expect(targetsOf(w, p.id).world).toBeCloseTo(0.4, 9);
  });

  it("takes the greater of the floor and the creep", () => {
    const { w, p } = world();
    w.state.items[0]!.pickedUp = true; // 0.5
    spawnHollow(w, { x: 160, y: ENEMY_HALF.y, z: 0 }, AiState.Crawl); // 0.2
    expect(targetsOf(w, p.id).world).toBeCloseTo(0.5, 9);
  });

  it("measures off-trail from the corridor's edge to OFF_TRAIL_FULL", () => {
    const { w, p } = world();
    expect(targetsOf(w, p.id).offTrail).toBe(0);
    p.pos = { x: 100, y: 0.9, z: -OFF_TRAIL_START };
    expect(targetsOf(w, p.id).offTrail).toBe(0);
    p.pos = { x: 100, y: 0.9, z: -(OFF_TRAIL_START + OFF_TRAIL_FULL) / 2 };
    expect(targetsOf(w, p.id).offTrail).toBeCloseTo(0.5, 9);
    p.pos = { x: 100, y: 0.9, z: -OFF_TRAIL_FULL - 40 };
    expect(targetsOf(w, p.id).offTrail).toBe(1);
  });

  it("nears with the closest Hollow, halved without line of sight, 0 with none", () => {
    const { w, p } = world();
    expect(targetsOf(w, p.id).near).toBe(0);
    // At eye height, so the eye-to-centre distance equals the horizontal one the fixture's z picks.
    const h = spawnHollow(w, { x: 100, y: ENEMY_HALF.y + PLAYER_EYE_OFFSET, z: NEAR_START + 10 }, AiState.Crawl);
    expect(targetsOf(w, p.id).near).toBe(0);
    h.pos.z = (NEAR_START + NEAR_FULL) / 2;
    expect(targetsOf(w, p.id).near).toBeCloseTo(0.5, 9);
    h.pos.z = NEAR_FULL - 2;
    expect(targetsOf(w, p.id).near).toBe(1);

    const walled = world({ min: [90, 0, 20], max: [110, 4, 21], material: "concrete" });
    const q = walled.p;
    spawnHollow(walled.w, { x: 100, y: ENEMY_HALF.y + PLAYER_EYE_OFFSET, z: (NEAR_START + NEAR_FULL) / 2 }, AiState.Crawl);
    expect(targetsOf(walled.w, q.id).near).toBeCloseTo(0.5 * NEAR_BLIND, 9);

    const low = world();
    spawnHollow(low.w, { x: 100, y: ENEMY_HALF.y, z: 45 }, AiState.Crawl);
    // 0.7 m below the eye: the falloff reads the slant range, not the ground plan.
    expect(targetsOf(low.w, low.p.id).near).toBeCloseTo(
      (NEAR_START - Math.hypot(45, PLAYER_EYE_OFFSET)) / (NEAR_START - NEAR_FULL),
      9,
    );
  });

  it("outranks a blind near Hollow with a visible far one", () => {
    const walled = world({ min: [90, 0, 20], max: [110, 4, 21], material: "concrete" });
    const q = walled.p;
    // 25 m behind the wall: blind, so its share is halved to (80-25)/70 * 0.5 ≈ 0.393.
    spawnHollow(walled.w, { x: 100, y: ENEMY_HALF.y + PLAYER_EYE_OFFSET, z: 25 }, AiState.Crawl);
    // 30 m in the open: the wall spans x 90-110 at z 20-21, and this line never
    // leaves z 0, so it is unobstructed — its share is (80-30)/70 ≈ 0.714, greater.
    spawnHollow(walled.w, { x: 130, y: ENEMY_HALF.y + PLAYER_EYE_OFFSET, z: 0 }, AiState.Crawl);
    expect(targetsOf(walled.w, q.id).near).toBeCloseTo((NEAR_START - 30) / (NEAR_START - NEAR_FULL), 9);
  });

  it("marks a dead local player", () => {
    const { w, p } = world();
    expect(targetsOf(w, p.id).dead).toBe(false);
    p.health = 0;
    expect(targetsOf(w, p.id).dead).toBe(true);
  });
});

const T = (over: Partial<EscalationTargets> = {}): EscalationTargets => ({ world: 0, offTrail: 0, near: 0, dead: false, ...over });
const stepFor = (seconds: number, t: EscalationTargets, from = ESCALATION_REST, dt = 1 / 60) => {
  let s = from;
  for (let i = 0; i < Math.round(seconds / dt); i++) s = stepEscalation(s, t, dt);
  return s;
};

describe("stepEscalation", () => {
  it("ratchets the world target: a Hollow climbing back never lowers it", () => {
    let s = stepEscalation(ESCALATION_REST, T({ world: 0.6 }), 1 / 60);
    expect(s.creepMax).toBeCloseTo(0.6, 9);
    s = stepEscalation(s, T({ world: 0.2 }), 1 / 60);
    expect(s.creepMax).toBeCloseTo(0.6, 9);
  });

  it("fills the spike in SPIKE_RISE_S at full rate, twice as long at half, and empties it in SPIKE_DECAY_S", () => {
    expect(stepFor(SPIKE_RISE_S, T({ offTrail: 1 })).spike).toBeCloseTo(1, 3);
    expect(stepFor(SPIKE_RISE_S, T({ offTrail: 0.5 })).spike).toBeCloseTo(0.5, 3);
    const full = stepFor(SPIKE_RISE_S, T({ offTrail: 1 }));
    expect(stepFor(SPIKE_DECAY_S, T(), full).spike).toBeCloseTo(0, 3);
  });

  it("lags the world and the lens with their time constants", () => {
    const w = stepFor(WORLD_EASE_S, T({ world: 1 }));
    expect(w.world).toBeCloseTo(1 - Math.exp(-1), 2);
    const l = stepFor(LENS_EASE_S, T({ near: 1 }));
    expect(l.lens).toBeCloseTo(1 - Math.exp(-1), 2);
  });

  it("changes nothing on a zero dt, and holds a dead player's spike and lens", () => {
    const s = stepFor(5, T({ offTrail: 1, near: 0.5 }));
    expect(stepEscalation(s, T({ offTrail: 1 }), 0)).toEqual(s);
    const held = stepFor(5, T({ dead: true, near: 1, world: 1 }), s);
    expect(held.spike).toBe(s.spike);
    expect(held.lens).toBe(s.lens);
    expect(held.world).toBeGreaterThan(s.world);
  });
});

describe("atmosphereUnder", () => {
  const noon = { weather: WEATHER_PRESETS.clear, hour: 12 };

  it("returns the base untouched at rest", () => {
    expect(atmosphereUnder(noon, ESCALATION_REST)).toEqual(noon);
  });

  it("reaches night and the eerie preset at world 1, and a later base hour stays", () => {
    const s = { ...ESCALATION_REST, world: 1 };
    const a = atmosphereUnder(noon, s);
    expect(a.hour).toBe(NIGHT_HOUR);
    expect(a.weather).toEqual(WEATHER_PRESETS.eerie);
    expect(atmosphereUnder({ weather: WEATHER_PRESETS.clear, hour: 23 }, s).hour).toBe(23);
  });

  it("holds a base hour before dawn, same as one past night", () => {
    const s = { ...ESCALATION_REST, world: 1 };
    expect(atmosphereUnder({ weather: WEATHER_PRESETS.clear, hour: 2 }, s).hour).toBe(2);
  });

  it("eases with smootherstep: half way is half way", () => {
    const a = atmosphereUnder(noon, { ...ESCALATION_REST, world: 0.5 });
    expect(a.hour).toBeCloseTo(12 + (NIGHT_HOUR - 12) * 0.5, 9);
    expect(a.weather.mist).toBeCloseTo(0.5, 9);
  });

  it("lifts dread to the lens and never lowers it", () => {
    expect(atmosphereUnder(noon, { ...ESCALATION_REST, lens: 0.7 }).weather.dread).toBeCloseTo(0.7, 9);
    const far = atmosphereUnder(noon, { ...ESCALATION_REST, world: 1, lens: 0.2 });
    expect(far.weather.dread).toBe(1);
  });

  it("silences the ground animals through the existing ramp at lens 0.5", () => {
    const a = atmosphereUnder(noon, { ...ESCALATION_REST, lens: 0.5 });
    expect(wildlifePresenceUnder(a.weather).ground).toBe(0);
  });
});
