import { describe, expect, it } from "vitest";
import "../../src/sim/passes/index.js";
import { setActiveTerrainVariant } from "../../src/sim/terrain.js";
import { SPRINT_SPEED, SIM_TICK_HZ } from "../../src/sim/constants.js";
import { WEATHER_PRESETS } from "../../src/game/weather.js";
import { treeInCell, TREE_CELL, COHORT_GIANT } from "../../src/sim/vegetation.js";
import {
  SPECIES_ELK, SPECIES_RABBIT, SPECIES_SQUIRREL, SPECIES_RAVEN_ROOST, SPECIES_GULL, SPECIES_EAGLE, SPECIES_COUNT,
  RAVEN_PERCH_HEIGHT, GIANT_TRUNK_RADIUS_PER_SCALE, wildlifeUnitsInDisc, type WildlifeUnit,
} from "../../src/game/wildlifeField.js";
import {
  PHASE_REST, PHASE_ALERT, PHASE_FLEE, PHASE_SETTLE, PHASE_RETURN, CALL_ELK_BUGLE, CALL_RAVEN_CROAK,
  CALL_SQUIRREL_CHATTER, ELK_FLEE_SPEED, RABBIT_BOLT_SPEED, RABBIT_HIDDEN_SECONDS, SQUIRREL_RUN_SPEED,
  ELK_FLEE_RANGE, ELK_ALERT_RANGE, RAVEN_DISTURB_RANGE, RABBIT_FREEZE_SECONDS,
  ELK_BUGLE_INTERVAL, RAVEN_CROAK_INTERVAL, DAWN_HOUR, DAWN_DUSK_WINDOW,
  ELK_FLEE_AWAY, ELK_REFUGE_ARRIVE, SQUIRREL_FORAGE_RADIUS, SQUIRREL_CLIMB, SQUIRREL_CLING_CLEARANCE,
  RAVEN_BLEND_SECONDS, RAVEN_CLIMB_MPS, ravenBlendSeconds, clipForPhase,
  PHASE_CUE, RABBIT_RETURN_SPEED, GULL_SPEED, startCue,
  createUnitState, stepUnit, wildlifePresenceUnder, type PlayerPoint, type WildlifeEvent, type UnitState,
} from "../../src/game/wildlifeBehaviour.js";

setActiveTerrainVariant("olympic");
const SEED = 388817;
// Some of these directions cost 100–160 ms alone (elk, rabbit, gull, eagle need a wide
// scan before landing on a match for this seed) — memoized since firstOf(species) is a
// pure function of (species, SEED) and this file calls it, directly or via run(), several
// times per species across many tests.
const firstOfCache = new Map<number, WildlifeUnit>();
function firstOf(species: number): WildlifeUnit {
  const cached = firstOfCache.get(species);
  if (cached) return cached;
  // Scan outward until a unit of this species exists; the seed is fixed so the result is too.
  // Gulls hug the coastline (olympic's COAST_X = -400), which the single (r, -r) diagonal
  // never crosses within 4 km, so the scan widens to 8 km along 8 directions per radius —
  // still deterministic for the fixed seed, just wide enough to cross the coast band.
  for (let r = 0; r < 8000; r += 200) {
    for (const [dx, dz] of [[1, -1], [-1, 1], [1, 1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const u = wildlifeUnitsInDisc(SEED, r * dx, r * dz).find((v) => v.species === species);
      if (u) { firstOfCache.set(species, u); return u; }
    }
  }
  throw new Error(`no ${species} found`);
}
/** No cross-unit disturbances in this single-unit harness — tests that
 * need one drive `stepUnit` directly instead of through this helper. */
function run(species: number, path: (tick: number) => PlayerPoint[], ticks: number, startTick = 1000) {
  const u = createUnitState(firstOf(species), startTick, SEED);
  const events: WildlifeEvent[] = [];
  const trace: { phase: number; x: number; z: number }[] = [];
  for (let t = startTick + 1; t <= startTick + ticks; t++) {
    stepUnit(u, t, path(t), SEED, 12, [], events);
    trace.push({ phase: u.phase, x: u.x, z: u.z });
  }
  return { u, events, trace };
}
const far: PlayerPoint[] = [{ x: 1e6, z: 1e6 }];

/** Seconds a cued rabbit takes to cover eight metres; asserts it ends resting ON the mark. */
function cueSeconds(run: boolean): number {
  const rabbit = firstOf(SPECIES_RABBIT);
  const u: UnitState = createUnitState(rabbit, 1000, SEED);
  startCue(u, u.x, u.z + 8, run, 1000);
  let t = 1001;
  for (; t <= 1001 + 10 * SIM_TICK_HZ && u.phase === PHASE_CUE; t++) stepUnit(u, t, far, SEED, 12, [], []);
  expect(u.phase).toBe(PHASE_REST);
  expect(u.x).toBeCloseTo(rabbit.x, 6);
  expect(u.z).toBeCloseTo(rabbit.z + 8, 6);
  return (t - 1001) / SIM_TICK_HZ;
}


/**
 * A unit vector PERPENDICULAR to the herd's anchor→refuge line. The approach
 * bearing decides which flee a test gets: a player standing anywhere in
 * the ±60° cone around the refuge makes "run to the refuge" mean "run at the player", and
 * the herd runs away instead. The tests below that are about the refuge-seeking flee
 * therefore have to walk in from a bearing that is not in that cone, and perpendicular is
 * the furthest from it they can be while still closing on the anchor.
 */
function acrossRefuge(unit: WildlifeUnit): { x: number; z: number } {
  const dx = unit.refugeX - unit.x, dz = unit.refugeZ - unit.z;
  const len = Math.hypot(dx, dz) || 1;
  return { x: -dz / len, z: dx / len };
}

describe("elk", () => {
  it("grazes when no one is near and never leaves its anchor by more than the wander", () => {
    const { u, trace } = run(SPECIES_ELK, () => far, 60 * SIM_TICK_HZ);
    expect(trace.every((p) => p.phase === PHASE_REST)).toBe(true);
    expect(Math.hypot(u.x - u.unit.x, u.z - u.unit.z)).toBeLessThanOrEqual(3 + 1e-6);
  });
  it("alerts inside 45 m and flees inside 28 m at a speed above sprint, toward the refuge, and reports the flee as a disturbance", () => {
    const unit = firstOf(SPECIES_ELK);
    const across = acrossRefuge(unit);
    const approach = (t: number): PlayerPoint[] => {
      const d = Math.max(0, 60 - (t - 1000) * 0.05); // 3 m/s walk-in
      return [{ x: unit.x + across.x * d, z: unit.z + across.z * d }];
    };
    const { u, events, trace } = run(SPECIES_ELK, approach, 40 * SIM_TICK_HZ);
    const alertAt = trace.findIndex((p) => p.phase === PHASE_ALERT);
    const fleeAt = trace.findIndex((p) => p.phase === PHASE_FLEE);
    expect(alertAt).toBeGreaterThan(0);
    expect(fleeAt).toBeGreaterThan(alertAt);
    const dAtAlert = 60 - (alertAt + 1) * 0.05;
    expect(dAtAlert).toBeLessThanOrEqual(ELK_ALERT_RANGE);
    expect(ELK_FLEE_SPEED).toBeGreaterThan(SPRINT_SPEED);
    // After the flee the lead is nearer the refuge than the anchor was.
    const dRef = Math.hypot(u.x - unit.refugeX, u.z - unit.refugeZ);
    expect(dRef).toBeLessThan(Math.hypot(unit.x - unit.refugeX, unit.z - unit.refugeZ));
    expect(fleeAt).toBeGreaterThan(0);
    // Every flee start is also reported as a disturbance event.
    expect(events.some((e) => e.kind === "flee" && e.species === SPECIES_ELK)).toBe(true);
    void ELK_FLEE_RANGE;
  });
  it("a flee ends only by arriving at the refuge, not by outrunning the player", () => {
    const unit = firstOf(SPECIES_ELK);
    // Trigger the flee, then teleport the player far away on the very next tick. The old
    // `d >= ELK_FLEE_CLEAR` early exit would end the flee wherever the elk happened to be
    // (a few centimetres from the anchor) the instant the player vanished; the fix removes
    // that arm, so the flee runs all the way to the seeded refuge regardless.
    const across = acrossRefuge(unit);
    // 15 m, not 5: the cone is measured from the herd's WANDERING position while this point
    // is fixed relative to the anchor, so a few metres of ELK_WANDER rotate the player
    // bearing — by up to ~30 degrees at 5 m, which leaves no slack at the 60-degree cone
    // edge if the seed ever moves. At 15 m the same wander is worth ~11 degrees.
    const path = (t: number): PlayerPoint[] => (t <= 1001 ? [{ x: unit.x + across.x * 15, z: unit.z + across.z * 15 }] : far);
    const u = createUnitState(unit, 1000, SEED);
    for (let t = 1001; t <= 1000 + 60 * SIM_TICK_HZ; t++) {
      stepUnit(u, t, path(t), SEED, 12, [], []);
      if (u.phase === PHASE_SETTLE) break;
    }
    expect(u.phase).toBe(PHASE_SETTLE);
    expect(Math.hypot(u.x - unit.refugeX, u.z - unit.refugeZ)).toBeLessThan(0.5);
  });
  it("settles at the refuge and returns to the anchor once the player is long gone", () => {
    const unit = firstOf(SPECIES_ELK);
    const path = (t: number): PlayerPoint[] => (t < 1000 + 5 * SIM_TICK_HZ ? [{ x: unit.x + 10, z: unit.z }] : far);
    const { trace } = run(SPECIES_ELK, path, 200 * SIM_TICK_HZ);
    expect(trace.some((p) => p.phase === PHASE_SETTLE)).toBe(true);
    expect(trace.some((p) => p.phase === PHASE_RETURN)).toBe(true);
    const last = trace[trace.length - 1]!;
    expect(last.phase).toBe(PHASE_REST);
    expect(Math.hypot(last.x - unit.x, last.z - unit.z)).toBeLessThan(4);
  });
  it("a player parked at the refuge does not livelock FLEE/SETTLE", () => {
    const unit = firstOf(SPECIES_ELK);
    // Trigger the first flee promptly, then park the player right at the refuge itself —
    // the exact scenario that produced a per-tick FLEE⇄SETTLE livelock pre-fix.
    const near: PlayerPoint = { x: unit.x + 5, z: unit.z };
    const atRefuge: PlayerPoint = { x: unit.refugeX + 2, z: unit.refugeZ };
    const path = (t: number): PlayerPoint[] => (t < 1000 + 2 * SIM_TICK_HZ ? [near] : [atRefuge]);
    const u = createUnitState(unit, 1000, SEED);
    const phases: number[] = [];
    for (let t = 1001; t <= 1000 + 300 * SIM_TICK_HZ; t++) {
      stepUnit(u, t, path(t), SEED, 12, [], []);
      phases.push(u.phase);
    }
    expect(u.episode).toBeLessThanOrEqual(3);
    // No 3-tick A,B,A flip between FLEE and SETTLE anywhere in the trace (a single
    // one-way FLEE→SETTLE arrival transition is normal and must NOT trip this).
    let livelocked = false;
    const isFleeOrSettle = (x: number) => x === PHASE_FLEE || x === PHASE_SETTLE;
    for (let i = 2; i < phases.length; i++) {
      const a = phases[i - 2]!, b = phases[i - 1]!, c = phases[i]!;
      if (isFleeOrSettle(a) && isFleeOrSettle(b) && isFleeOrSettle(c) && a === c && a !== b) livelocked = true;
    }
    expect(livelocked).toBe(false);
  });
  it("a first flee turns away rather than charging through the player standing in front of the refuge", () => {
    // In the real game: a herd at 22.7 m closed to 7.5 m in two seconds and then
    // grazed in the player's face, because the refuge happened to lie past the player and
    // "run to the refuge" was the same instruction as "run at the player". The rule that
    // already covers a SETTLE re-flee (run away, 100 m, ±20° jitter)
    // now covers this too, and only this: the refuge stays the goal for every other bearing.
    const unit = firstOf(SPECIES_ELK);
    const dx = unit.refugeX - unit.x, dz = unit.refugeZ - unit.z;
    const len = Math.hypot(dx, dz);
    // On the line from the herd to the refuge, inside ELK_FLEE_RANGE: dead centre of the
    // cone, and far enough from the refuge that ELK_REFUGE_ARRIVE cannot be what fires.
    const player: PlayerPoint = { x: unit.x + (dx / len) * 20, z: unit.z + (dz / len) * 20 };
    expect(len).toBeGreaterThan(20 + ELK_REFUGE_ARRIVE);
    const u = createUnitState(unit, 1000, SEED);
    stepUnit(u, 1001, [player], SEED, 12, [], []);
    expect(u.phase).toBe(PHASE_FLEE);
    // Not the refuge — the goal moved off it entirely, not merely a few metres.
    expect(Math.hypot(u.goalX - unit.refugeX, u.goalZ - unit.refugeZ)).toBeGreaterThan(ELK_FLEE_AWAY / 2);
    // And it points away from the player, within the away-flee's own ±20° jitter. Compared
    // as directions (dot product) so nothing has to be unwrapped across ±π.
    const away = Math.atan2(u.x - player.x, u.z - player.z);
    const goal = Math.atan2(u.goalX - u.x, u.goalZ - u.z);
    expect(Math.cos(goal - away)).toBeGreaterThan(Math.cos(30 * Math.PI / 180));
    // The check is a CONE, not "never use the refuge": the same herd with the player off to
    // the side still runs to its refuge, which is the behaviour this design asks for.
    const aside: PlayerPoint = { x: unit.x + (-dz / len) * 20, z: unit.z + (dx / len) * 20 };
    const v = createUnitState(unit, 1000, SEED);
    stepUnit(v, 1001, [aside], SEED, 12, [], []);
    expect(v.phase).toBe(PHASE_FLEE);
    expect(v.goalX).toBeCloseTo(unit.refugeX, 6);
    expect(v.goalZ).toBeCloseTo(unit.refugeZ, 6);
  });
  it("a stationary player at 35 m from the anchor does not stall an elk in RETURN", () => {
    const unit = firstOf(SPECIES_ELK);
    const dx = unit.x - unit.refugeX, dz = unit.z - unit.refugeZ;
    const len = Math.hypot(dx, dz) || 1;
    // A point 35 m from the anchor, PERPENDICULAR to the refuge→anchor line: the closest
    // this point ever gets to the whole straight-line RETURN path is exactly 35 m, reached
    // only at the anchor itself — so the elk enters ALERT_RANGE only for the final stretch
    // of the walk, and never enters FLEE_RANGE (28 m) at all.
    const stationary: PlayerPoint = { x: unit.x + (-dz / len) * 35, z: unit.z + (dx / len) * 35 };
    const near: PlayerPoint = { x: unit.x + 5, z: unit.z };
    const path = (t: number): PlayerPoint[] => (t < 1000 + 2 * SIM_TICK_HZ ? [near] : [stationary]);
    const u = createUnitState(unit, 1000, SEED);
    let returnAt = -1;
    let restSinceAt = -1;
    // Require REST held for a full HOLD ticks, not just its first appearance — the old
    // bug's oscillation passes through REST for exactly one tick between ALERT bursts, so
    // "first tick seen at PHASE_REST" alone is not evidence of a genuine, settled arrival.
    const HOLD = 2 * SIM_TICK_HZ;
    for (let t = 1001; t <= 1000 + 300 * SIM_TICK_HZ; t++) {
      stepUnit(u, t, path(t), SEED, 12, [], []);
      if (returnAt < 0 && u.phase === PHASE_RETURN) returnAt = t;
      if (u.phase === PHASE_REST) { if (restSinceAt < 0) restSinceAt = t; } else { restSinceAt = -1; }
      if (returnAt >= 0 && restSinceAt >= 0 && t - restSinceAt >= HOLD) {
        expect(restSinceAt - returnAt).toBeLessThanOrEqual(60 * SIM_TICK_HZ);
        return;
      }
    }
    throw new Error("elk never settled stably at REST");
  });
});

describe("determinism and self-healing", () => {
  it("two runs with the same inputs are byte-identical", () => {
    const unit = firstOf(SPECIES_ELK);
    const path = (t: number): PlayerPoint[] => [{ x: unit.x + 40 - (t - 1000) * 0.02, z: unit.z + Math.sin(t / 50) }];
    const a = run(SPECIES_ELK, path, 120 * SIM_TICK_HZ);
    const b = run(SPECIES_ELK, path, 120 * SIM_TICK_HZ);
    expect(a.trace).toEqual(b.trace);
    expect(a.events).toEqual(b.events);
  });
  it("a 6-tick disagreement on the flee trigger converges within one episode", () => {
    const unit = firstOf(SPECIES_ELK);
    const late = (t: number): PlayerPoint[] => (t < 1000 + 2 * SIM_TICK_HZ + 6 ? [{ x: unit.x + 100, z: unit.z }] : t < 1000 + 8 * SIM_TICK_HZ ? [{ x: unit.x + 5, z: unit.z }] : far);
    const early = (t: number): PlayerPoint[] => (t < 1000 + 2 * SIM_TICK_HZ ? [{ x: unit.x + 100, z: unit.z }] : t < 1000 + 8 * SIM_TICK_HZ ? [{ x: unit.x + 5, z: unit.z }] : far);
    const a = run(SPECIES_ELK, early, 200 * SIM_TICK_HZ);
    const b = run(SPECIES_ELK, late, 200 * SIM_TICK_HZ);
    expect(a.u.phase).toBe(PHASE_REST);
    expect(b.u.phase).toBe(PHASE_REST);
    // Rest motion is a function of the absolute tick, so once both have reached the
    // current slot's goal they are identical. Step on until both are at rest at a goal.
    let t = 1000 + 200 * SIM_TICK_HZ;
    for (let i = 0; i < 20 * SIM_TICK_HZ; i++) {
      t++;
      stepUnit(a.u, t, far, SEED, 12, [], []);
      stepUnit(b.u, t, far, SEED, 12, [], []);
      if (a.u.x === a.u.goalX && a.u.z === a.u.goalZ && b.u.x === b.u.goalX && b.u.z === b.u.goalZ) break;
    }
    expect(Math.hypot(a.u.x - b.u.x, a.u.z - b.u.z)).toBeLessThan(1e-6);
    // and they chose the same refuge and dwell, because draws key on the episode, not the tick
    expect(a.u.episode).toBe(b.u.episode);
  });
  it("the same episode draws the same SETTLE dwell and events even when the trigger starts 6 ticks later", () => {
    const unit = firstOf(SPECIES_ELK);
    // The player closes to 5 m from the ANCHOR and STAYS — never near the refuge, so the
    // away-flee never re-triggers, and the flee ends by ARRIVING at the refuge (a tick that
    // carries the 6-tick offset) rather than by a scripted teleport, so the SETTLE draw's
    // keying is actually exercised (the original script instead teleported the player to
    // `far` on a fixed absolute tick shared by both runs, which — with the since-removed
    // `d >= ELK_FLEE_CLEAR` early exit — hid the keying entirely: both runs left FLEE on
    // that same shared tick regardless of the 6-tick trigger offset).
    const hold = (trigger: number) => (t: number): PlayerPoint[] =>
      t < trigger ? [{ x: unit.x + 100, z: unit.z }] : [{ x: unit.x + 5, z: unit.z }];
    const measure = (trigger: number) => {
      const u = createUnitState(unit, 1000, SEED);
      const episodeEvents: WildlifeEvent[] = [];
      let prev = u.phase;
      let settleEnteredAt = 0;
      let settleTicks = -1;
      for (let t = 1001; t <= 1000 + 120 * SIM_TICK_HZ; t++) {
        const tickEvents: WildlifeEvent[] = [];
        stepUnit(u, t, hold(trigger)(t), SEED, 12, [], tickEvents);
        if (u.phase === PHASE_FLEE || u.phase === PHASE_SETTLE) episodeEvents.push(...tickEvents);
        if (u.phase !== prev) {
          if (u.phase === PHASE_SETTLE) settleEnteredAt = t;
          if (prev === PHASE_SETTLE) { settleTicks = t - settleEnteredAt; break; }
          prev = u.phase;
        }
      }
      if (settleTicks < 0) throw new Error("never left SETTLE");
      return { settleTicks, episodeEvents };
    };
    const a = measure(1000 + 2 * SIM_TICK_HZ);
    const b = measure(1000 + 2 * SIM_TICK_HZ + 6);
    expect(a.settleTicks).toBeGreaterThan(0);
    expect(a.settleTicks).toBe(b.settleTicks);
    expect(a.episodeEvents).toEqual(b.episodeEvents);
  });
  it("the call schedule is a pure function of the absolute tick — states created apart agree", () => {
    const unit = firstOf(SPECIES_ELK);
    // A handful of slots is enough to prove purity: slotTicks is the noon slot length
    // (ELK_BUGLE_INTERVAL[1] · SIM_TICK_HZ); stepping N_SLOTS of them is enough ticks for
    // the schedule to draw N_SLOTS calls on a pure implementation, which is all this test
    // needs to compare. OFFSET is derived from slotTicks, not picked by trial: half a slot
    // is the creation-time skew most likely to land a slot-boundary-adjacent draw on the
    // OTHER side of a boundary under a mutant that (incorrectly) keys the slot off creation
    // tick instead of the absolute tick — verified directly against such a mutant, which
    // diverges within these 2 slots at this OFFSET (a smaller, arbitrarily chosen 500-tick skew
    // does not diverge until several times more slots have passed for this unit/seed, since
    // whether any given slot boundary shift actually changes a draw is essentially
    // per-slot-random — the property under test, and the reason a derived OFFSET is used
    // instead of an arbitrarily small one).
    const slotTicks = Math.round(ELK_BUGLE_INTERVAL[1] * SIM_TICK_HZ);
    const N_SLOTS = 2;
    const horizon = N_SLOTS * slotTicks;
    const OFFSET = slotTicks / 2;
    const callTicks = (createTick: number): number[] => {
      const u = createUnitState(unit, createTick, SEED);
      const ticks: number[] = [];
      for (let t = createTick + 1; t <= createTick + horizon; t++) {
        const events: WildlifeEvent[] = [];
        stepUnit(u, t, far, SEED, 12, [], events);
        if (events.some((e) => e.kind === "call" && e.call === CALL_ELK_BUGLE)) ticks.push(t);
      }
      return ticks;
    };
    const a = callTicks(1000);
    const b = callTicks(1000 + OFFSET);
    expect(a.length).toBeGreaterThan(0);
    // Compare only the ticks both runs actually cover — a schedule keyed purely on
    // (id, seed, tick) must agree there regardless of when either state was created.
    const lo = 1000 + OFFSET + 1, hi = 1000 + horizon;
    expect(a.filter((t) => t >= lo && t <= hi)).toEqual(b.filter((t) => t >= lo && t <= hi));
  });
});

describe("rabbit and squirrel", () => {
  it("rabbit freezes, bolts above sprint, hides at the bush, then returns, and reports the bolt as a disturbance", () => {
    const unit = firstOf(SPECIES_RABBIT);
    const path = (t: number): PlayerPoint[] => (t < 1000 + 6 * SIM_TICK_HZ ? [{ x: unit.x + Math.max(3, 20 - (t - 1000) * 0.06), z: unit.z }] : far);
    const { trace, events, u } = run(SPECIES_RABBIT, path, (RABBIT_HIDDEN_SECONDS[1] + 40) * SIM_TICK_HZ);
    expect(RABBIT_BOLT_SPEED).toBeGreaterThan(SPRINT_SPEED);
    const order = [PHASE_ALERT, PHASE_FLEE, PHASE_SETTLE, PHASE_RETURN, PHASE_REST];
    let i = 0;
    for (const p of trace) if (p.phase === order[i]) i++;
    expect(i).toBe(order.length);
    const hidden = trace.find((p) => p.phase === PHASE_SETTLE)!;
    expect(Math.hypot(hidden.x - unit.refugeX, hidden.z - unit.refugeZ)).toBeLessThan(0.5);
    expect(u.poses[0]!.scale).toBe(1);
    expect(events.some((e) => e.kind === "flee" && e.species === SPECIES_RABBIT)).toBe(true);
  });
  it("rabbit holds its freeze instead of blinking through rest with the player parked at mid range", () => {
    // A stationary player between RABBIT_BOLT_RANGE and RABBIT_FREEZE_RANGE.
    // The freeze expires every 1–3 s, and dropping to REST for the one tick it
    // takes REST to freeze again flipped the clip alert → graze → alert — which
    // restarts a multi-clip rabbit's held alert pose, a visible twitch from a
    // player who is not moving at all. The same fix as the elk's, applied to the rabbit.
    const unit = firstOf(SPECIES_RABBIT);
    const player: PlayerPoint[] = [{ x: unit.x + 14, z: unit.z }];
    const { u, trace } = run(SPECIES_RABBIT, () => player, 30 * SIM_TICK_HZ);
    const alertAt = trace.findIndex((p) => p.phase === PHASE_ALERT);
    expect(alertAt).toBeGreaterThanOrEqual(0);
    // Several freeze dwells' worth of ticks after the first one, so the run
    // really does cross expiries rather than sitting inside the first dwell.
    expect(trace.length - alertAt).toBeGreaterThan(RABBIT_FREEZE_SECONDS[1] * SIM_TICK_HZ * 3);
    expect(trace.slice(alertAt).every((p) => p.phase === PHASE_ALERT)).toBe(true);
    expect(u.poses.every((p) => p.clip === "alert")).toBe(true);
  });
  it("squirrel runs to its trunk, climbs above 6 m pitched up the trunk, and stays on the far side", () => {
    const unit = firstOf(SPECIES_SQUIRREL);
    const player: PlayerPoint = { x: unit.homeX + 8, z: unit.homeZ };
    const { u, trace } = run(SPECIES_SQUIRREL, () => [player], 20 * SIM_TICK_HZ);
    expect(SQUIRREL_RUN_SPEED).toBeGreaterThan(0);
    expect(trace.some((p) => p.phase === PHASE_FLEE)).toBe(true);
    expect(u.phase).toBe(PHASE_SETTLE);
    expect(u.climb).toBeGreaterThanOrEqual(6);
    const pose = u.poses[0]!;
    expect(pose.y).toBeCloseTo(unit.homeH + u.climb, 5);
    // far side: the pose's bearing from the trunk points away from the player
    const away = Math.atan2(unit.homeX - player.x, unit.homeZ - player.z);
    expect(Math.abs(Math.atan2(pose.x - unit.homeX, pose.z - unit.homeZ) - away)).toBeLessThan(0.2);
    // belly to the bark: the treed pose's forward (sin yaw, cos yaw) points back toward the
    // trunk axis, and the pitch stands it head-up
    const toAxisX = unit.homeX - pose.x, toAxisZ = unit.homeZ - pose.z;
    expect(Math.sin(pose.yaw) * toAxisX + Math.cos(pose.yaw) * toAxisZ).toBeGreaterThan(0);
    expect(pose.pitch).toBeCloseTo(Math.PI / 2, 5);
  });
  it("squirrel's alarm run plays the run clip (not idle) and chatters immediately", () => {
    const unit = firstOf(SPECIES_SQUIRREL);
    const player: PlayerPoint = { x: unit.homeX + 8, z: unit.homeZ };
    const u = createUnitState(unit, 1000, SEED);
    const events: WildlifeEvent[] = [];
    stepUnit(u, 1001, [player], SEED, 12, [], events);
    expect(u.phase).toBe(PHASE_ALERT);
    expect(u.poses[0]!.clip).toBe("run");
    expect(events.some((e) => e.kind === "call" && e.call === CALL_SQUIRREL_CHATTER)).toBe(true);
    expect(events.some((e) => e.kind === "flee" && e.species === SPECIES_SQUIRREL)).toBe(true);
  });
  it("a still alarmed or treed squirrel asks for the alert clip, never the grazing one", () => {
    // The squirrel GLB carries {graze, walk, run, alert} and no `idle`, and creatureModel's
    // FALLBACK sends role `idle` to `graze` — so the old {run, idle} special-case made a
    // treed squirrel graze, neck down 55°, while clinging head-up to the bark, and made the
    // `alert` clip dead code (0 of 96 samples).
    expect(clipForPhase(SPECIES_SQUIRREL, PHASE_ALERT, false)).toBe("alert");
    expect(clipForPhase(SPECIES_SQUIRREL, PHASE_SETTLE, false)).toBe("alert");
    expect(clipForPhase(SPECIES_SQUIRREL, PHASE_REST, false)).toBe("graze");
    // Nothing the squirrel can ask for is a role its own file does not carry — `idle` in
    // particular, which is what made the clip resolve to `graze` in the first place.
    for (const phase of [PHASE_REST, PHASE_ALERT, PHASE_FLEE, PHASE_SETTLE, PHASE_RETURN, PHASE_CUE]) {
      for (const moving of [false, true]) {
        expect(["graze", "walk", "run", "alert"]).toContain(clipForPhase(SPECIES_SQUIRREL, phase, moving));
      }
    }
    // And in the running machine: treed on the trunk, the pose really does carry it.
    const unit = firstOf(SPECIES_SQUIRREL);
    const { u } = run(SPECIES_SQUIRREL, () => [{ x: unit.homeX + 8, z: unit.homeZ }], 20 * SIM_TICK_HZ);
    expect(u.phase).toBe(PHASE_SETTLE);
    expect(u.poses[0]!.clip).toBe("alert");
  });
  it("a treed squirrel clings outside the bark, at its own tree's radius plus the clearance", () => {
    // Pinned as VALUES first, because everything below derives its expectation from these
    // two constants and would follow them anywhere. The radius is the measurement recorded
    // in GIANT_TRUNK_RADIUS_PER_SCALE's own comment: the largest 0.5 m trunk slice of the
    // shipped giants over the 5–10 m band is pine's 0.139 (fir 0.121), and over the 1.2–3.6 m
    // band the squirrel actually clings to, pine's 0.127. Anything under 0.139 puts the
    // squirrel back inside the wood on a pine; anything far over it has it floating.
    expect(GIANT_TRUNK_RADIUS_PER_SCALE).toBeGreaterThanOrEqual(0.139);
    expect(GIANT_TRUNK_RADIUS_PER_SCALE).toBeLessThanOrEqual(0.2);
    expect(SQUIRREL_CLING_CLEARANCE).toBe(0.03);
    const unit = firstOf(SPECIES_SQUIRREL);
    // The home anchor IS a giant from the sim's own field, and its drawn scale is what the
    // unit carries — re-derived here from `treeInCell` rather than trusted, so a squirrel
    // branch that dropped the scale (leaving the `unit()` default of 1) fails this.
    const tree = treeInCell(SEED, Math.floor(unit.homeX / TREE_CELL), Math.floor(unit.homeZ / TREE_CELL));
    expect(tree).not.toBeNull();
    expect(tree!.cohort).toBe(COHORT_GIANT);
    expect(unit.homeScale).toBeCloseTo(tree!.scale, 10);
    expect(unit.homeScale).toBeGreaterThan(1);
    const { u } = run(SPECIES_SQUIRREL, () => [{ x: unit.homeX + 8, z: unit.homeZ }], 20 * SIM_TICK_HZ);
    expect(u.phase).toBe(PHASE_SETTLE);
    const pose = u.poses[0]!;
    const offset = Math.hypot(pose.x - unit.homeX, pose.z - unit.homeZ);
    expect(offset).toBeCloseTo(GIANT_TRUNK_RADIUS_PER_SCALE * unit.homeScale + SQUIRREL_CLING_CLEARANCE, 10);
    // The measured trunk is 0.29–0.72 m in radius across the whole giant scale range, so
    // the old flat 0.35 m put the squirrel inside the wood on most of them; whatever the
    // seed picks, the offset must clear this tree's own trunk by the full clearance.
    expect(offset - GIANT_TRUNK_RADIUS_PER_SCALE * tree!.scale).toBeCloseTo(SQUIRREL_CLING_CLEARANCE, 10);
    expect(offset).toBeGreaterThan(0.35);
  });
  it("only the squirrel carries a home scale; every other species leaves it at 1", () => {
    for (let species = 0; species < SPECIES_COUNT; species++) {
      if (species === SPECIES_SQUIRREL) continue;
      expect(firstOf(species).homeScale).toBe(1);
    }
  });
});

describe("birds", () => {
  it("a roost lifts when a player is within 30 m, circles, and returns to the perch", () => {
    const unit = firstOf(SPECIES_RAVEN_ROOST);
    const path = (t: number): PlayerPoint[] => (t < 1000 + 3 * SIM_TICK_HZ ? [{ x: unit.homeX + 20, z: unit.homeZ }] : far);
    const { trace, events, u } = run(SPECIES_RAVEN_ROOST, path, 130 * SIM_TICK_HZ);
    expect(events.some((e) => e.kind === "lift")).toBe(true);
    expect(events.some((e) => e.kind === "call" && e.call === CALL_RAVEN_CROAK)).toBe(true);
    expect(trace.some((p) => p.phase === PHASE_FLEE)).toBe(true);
    expect(u.phase).toBe(PHASE_REST);
    for (const p of u.poses) expect(p.y).toBeCloseTo(unit.homeH + 7, 3);
  });
  it("a roost lifts on a nearby disturbance even with no player close by", () => {
    const unit = firstOf(SPECIES_RAVEN_ROOST);
    const u = createUnitState(unit, 1000, SEED);
    const disturbance: PlayerPoint = { x: unit.homeX + RAVEN_DISTURB_RANGE - 10, z: unit.homeZ };
    const events: WildlifeEvent[] = [];
    stepUnit(u, 1001, far, SEED, 12, [disturbance], events);
    expect(u.phase).toBe(PHASE_FLEE);
    expect(events.some((e) => e.kind === "lift")).toBe(true);
  });
  it("faces a loop flier along its motion, not across it", () => {
    // The repo's convention is yaw 0 faces +Z, forward = (sin yaw, cos yaw)
    // (`sim/movement.ts`, ARCHITECTURE.md, Model conventions). The old `a + π/2` pointed a bird
    // radially outward at a = 0 and counter-rotated it around the circle, so
    // every flier crabbed sideways — invisible until wings were added to them.
    for (const species of [SPECIES_GULL, SPECIES_EAGLE]) {
      const unit = firstOf(species);
      const u = createUnitState(unit, 1000, SEED);
      const events: WildlifeEvent[] = [];
      stepUnit(u, 1001, far, SEED, 12, [], events);
      const before = u.poses.map((p) => ({ x: p.x, z: p.z, yaw: p.yaw }));
      stepUnit(u, 1002, far, SEED, 12, [], events);
      let checked = 0;
      for (let m = 0; m < u.poses.length; m++) {
        const now = u.poses[m]!;
        const was = before[m]!;
        const dx = now.x - was.x;
        const dz = now.z - was.z;
        // A tick of travel: ~0.4 m for a gull, far above the loop's slow
        // breathe-in/out radial term, so the delta IS the tangent to a degree or two.
        expect(Math.hypot(dx, dz)).toBeGreaterThan(0.05);
        const heading = Math.atan2(dx, dz);
        // Compared as DIRECTIONS via their dot product, not as raw angles:
        // yaw and heading can straddle ±π, and the loop's slow breathe adds a
        // small radial term to the delta (a few degrees for an eagle, whose ω
        // is the smallest of the fliers). 0.98 is ~11°, far tighter than the
        // 90° the wrong yaw is off by.
        expect(Math.sin(was.yaw) * Math.sin(heading) + Math.cos(was.yaw) * Math.cos(heading)).toBeGreaterThan(0.98);
        // And it is genuinely NOT the old radially-outward yaw, which would
        // read 90° off — pinned so a revert cannot pass on the tolerance above.
        const outward = Math.atan2(was.x - unit.homeX, was.z - unit.homeZ);
        expect(Math.abs(Math.sin(was.yaw) * Math.sin(outward) + Math.cos(was.yaw) * Math.cos(outward))).toBeLessThan(0.2);
        checked++;
      }
      expect(checked).toBeGreaterThan(0);
    }
  });
  it("a lifting roost climbs off the perch instead of cutting to the loop", () => {
    // In the real game: between two 200 ms samples the ravens went from y 169.3 to
    // y 193 — the whole climb in one frame. Landing already blended; take-off did not.
    const unit = firstOf(SPECIES_RAVEN_ROOST);
    const near: PlayerPoint[] = [{ x: unit.homeX + 20, z: unit.homeZ }];
    const perchY = unit.homeH + RAVEN_PERCH_HEIGHT;
    const loopY = unit.homeH + unit.altitude;
    const blend = ravenBlendSeconds(unit);
    // The blend only means anything if there is a climb to blend: the loop now clears the
    // canopy, so this is tens of metres, not a step.
    expect(loopY - perchY).toBeGreaterThan(40);
    const u = createUnitState(unit, 1000, SEED);
    // One settled tick first, so the perched poses (and their perched yaws) exist to
    // compare against.
    stepUnit(u, 1001, far, SEED, 12, [], []);
    expect(u.phase).toBe(PHASE_REST);
    const perchedYaw = u.poses.map((p) => p.yaw);
    stepUnit(u, 1002, near, SEED, 12, [], []);
    expect(u.phase).toBe(PHASE_FLEE);
    // Still on the branch on the tick it lifts, wings folded, still facing where it
    // perched: orientation takes the same blend as position, so nothing
    // about the pose changes discontinuously at the lift.
    for (let m = 0; m < u.poses.length; m++) {
      const p = u.poses[m]!;
      expect(p.y).toBeCloseTo(perchY, 3);
      expect(p.wing).toBeCloseTo(0, 6);
      // Compared as a DIRECTION: the shortest-arc blend is free to hand back the same
      // heading shifted by a whole turn, and a bird does not care which representation it
      // is drawn from.
      expect(Math.cos(p.yaw - perchedYaw[m]!)).toBeCloseTo(1, 9);
    }
    // Halfway through the blend: off the branch, not yet on the loop, wings part-way up.
    // The margins are far wider than the loop's own ±2 m bob, so neither end can be reached
    // by the bob alone.
    stepUnit(u, 1002 + Math.round((blend / 2) * SIM_TICK_HZ), near, SEED, 12, [], []);
    for (let m = 0; m < u.poses.length; m++) {
      const p = u.poses[m]!;
      expect(p.y).toBeGreaterThan(perchY + 5);
      expect(p.y).toBeLessThan(loopY - 5);
      expect(p.wing).toBeGreaterThan(0);
      expect(p.wing).toBeLessThan(1);
      // Turned off the perched heading, but not yet all the way to the tangent.
      expect(Math.cos(p.yaw - perchedYaw[m]!)).toBeLessThan(1 - 1e-6);
    }
    // And it finishes: by the blend's end the flock is on the loop, at its altitude, at its
    // radius and beating, with nothing of the perch left in the pose.
    stepUnit(u, 1002 + Math.round(blend * SIM_TICK_HZ), near, SEED, 12, [], []);
    for (const p of u.poses) {
      expect(Math.abs(p.y - loopY)).toBeLessThanOrEqual(2 + 1e-6);
      expect(Math.hypot(p.x - unit.homeX, p.z - unit.homeZ)).toBeGreaterThan(unit.radius * 0.8);
      expect(p.wing).toBeCloseTo(1, 6);
    }
    // On the loop the heading is its tangent — the direction the bird is actually moving.
    const before = u.poses.map((p) => ({ x: p.x, z: p.z, yaw: p.yaw }));
    stepUnit(u, 1003 + Math.round(blend * SIM_TICK_HZ), near, SEED, 12, [], []);
    for (let m = 0; m < u.poses.length; m++) {
      const was = before[m]!, now = u.poses[m]!;
      const heading = Math.atan2(now.x - was.x, now.z - was.z);
      expect(Math.sin(was.yaw) * Math.sin(heading) + Math.cos(was.yaw) * Math.cos(heading)).toBeGreaterThan(0.98);
    }
  });
  it("the lift takes as long as the climb needs, not a fixed three seconds", () => {
    // The loop altitude is canopy-relative now, so it runs from the 40 m floor to past
    // 100 m; a fixed blend would give a 60 m climb three times the vertical speed of a 20 m
    // one, and at the higher end several times RAVEN_SPEED. The duration is the climb over
    // RAVEN_CLIMB_MPS, clamped, so the SPEED is what is held constant.
    const unit = firstOf(SPECIES_RAVEN_ROOST);
    const climb = Math.abs(unit.altitude - RAVEN_PERCH_HEIGHT);
    expect(ravenBlendSeconds(unit)).toBeCloseTo(climb / RAVEN_CLIMB_MPS, 9);
    expect(ravenBlendSeconds(unit)).toBeGreaterThan(RAVEN_BLEND_SECONDS[0]);
    // A short hop clamps up so it cannot snap, a towering one clamps down so the flock is
    // not still climbing a minute later. Synthetic units: the field never places these.
    const at = (altitude: number) => ravenBlendSeconds({ ...unit, altitude });
    expect(at(RAVEN_PERCH_HEIGHT + 1)).toBe(RAVEN_BLEND_SECONDS[0]);
    expect(at(RAVEN_PERCH_HEIGHT + 1000)).toBe(RAVEN_BLEND_SECONDS[1]);
    // Landing reads the same number, so a descent is not faster than the climb that
    // preceded it — the whole point of deriving it from the distance.
    const near: PlayerPoint[] = [{ x: unit.homeX + 20, z: unit.homeZ }];
    const u = createUnitState(unit, 1000, SEED);
    stepUnit(u, 1001, near, SEED, 12, [], []);
    const blend = ravenBlendSeconds(unit);
    // Circle out (dwell is 60-90 s), then let the player leave and time the landing.
    let t = 1001;
    for (; t <= 1001 + 200 * SIM_TICK_HZ && u.phase !== PHASE_RETURN; t++) {
      stepUnit(u, t, t < 1001 + 5 * SIM_TICK_HZ ? near : far, SEED, 12, [], []);
    }
    expect(u.phase).toBe(PHASE_RETURN);
    const blendTicks = Math.round(blend * SIM_TICK_HZ);
    // Still descending two ticks short of the blend — a landing pinned to a fixed number of
    // seconds would already be back on the branch, because this climb needs more than that.
    expect(blend).toBeGreaterThan(RAVEN_BLEND_SECONDS[0] + 1);
    const landingStart = t;
    for (; t < landingStart + blendTicks - 2; t++) stepUnit(u, t, far, SEED, 12, [], []);
    expect(u.phase).toBe(PHASE_RETURN);
    for (; t <= landingStart + blendTicks + 1; t++) stepUnit(u, t, far, SEED, 12, [], []);
    expect(u.phase).toBe(PHASE_REST);
  });
  it("a roost startled mid-landing resumes the lift instead of snapping back to the perch", () => {
    // `enter()` restarts the phase clock, so a RETURN interrupted by a player crossing
    // RAVEN_LIFT_RANGE used to jump the flock the remaining tens of metres DOWN to the
    // branch and re-climb — the defect this test exists to catch, in the one path that still had it.
    const unit = firstOf(SPECIES_RAVEN_ROOST);
    const near: PlayerPoint[] = [{ x: unit.homeX + 20, z: unit.homeZ }];
    const blend = ravenBlendSeconds(unit);
    const u = createUnitState(unit, 1000, SEED);
    let t = 1001;
    stepUnit(u, t++, near, SEED, 12, [], []);
    for (; t <= 1001 + 200 * SIM_TICK_HZ && u.phase !== PHASE_RETURN; t++) {
      stepUnit(u, t, t < 1001 + 5 * SIM_TICK_HZ ? near : far, SEED, 12, [], []);
    }
    expect(u.phase).toBe(PHASE_RETURN);
    // Halfway down.
    const half = Math.round((blend / 2) * SIM_TICK_HZ);
    for (let i = 0; i < half; i++) stepUnit(u, t++, far, SEED, 12, [], []);
    const before = u.poses.map((p) => p.y);
    // The player walks back in on the very next tick.
    stepUnit(u, t++, near, SEED, 12, [], []);
    expect(u.phase).toBe(PHASE_FLEE);
    for (let m = 0; m < u.poses.length; m++) {
      // Continuous: one tick of a re-started lift, not a plunge to the perch. The whole
      // remaining descent would be tens of metres; a tick of climb is centimetres.
      expect(Math.abs(u.poses[m]!.y - before[m]!)).toBeLessThan(2);
    }
    // And it goes UP from here rather than finishing the descent.
    for (let i = 0; i < half; i++) stepUnit(u, t++, near, SEED, 12, [], []);
    for (let m = 0; m < u.poses.length; m++) expect(u.poses[m]!.y).toBeGreaterThan(before[m]!);
  });
  it("loop fliers never react and stay on their loop", () => {
    for (const species of [SPECIES_GULL, SPECIES_EAGLE]) {
      const unit = firstOf(species);
      const { u, trace } = run(species, () => [{ x: unit.homeX, z: unit.homeZ }], 30 * SIM_TICK_HZ);
      expect(trace.every((p) => p.phase === PHASE_REST)).toBe(true);
      for (const p of u.poses) {
        const r = Math.hypot(p.x - unit.homeX, p.z - unit.homeZ);
        expect(r).toBeGreaterThan(unit.radius * 0.8);
        expect(r).toBeLessThan(unit.radius * 1.2);
        expect(p.y).toBeGreaterThan(unit.homeH + unit.altitude - 5);
      }
    }
  });
});

describe("calls and presence", () => {
  it("a flier's call comes from the bird, not from the centre of its loop", () => {
    // In the real game: `u.x/u.z` is the loop CENTRE for every aloft species, so a
    // cry was spatialized up to a loop radius away from the only bird on screen — 126 m for
    // the eagle that was measured. The call now carries the lead member's seat on the loop.
    const unit = firstOf(SPECIES_GULL);
    const u = createUnitState(unit, 1000, SEED);
    // One step first: a bird's poses are ground-level seats until poseBirds has run once.
    stepUnit(u, 1001, far, SEED, 12, [], []);
    let heard = 0;
    for (let t = 1002; t <= 1002 + 120 * SIM_TICK_HZ; t++) {
      // The call is pushed inside the tick's step, BEFORE the poses for that tick are
      // written, so the seat it must match is the one standing at the top of the loop body.
      const lead = { x: u.poses[0]!.x, y: u.poses[0]!.y, z: u.poses[0]!.z };
      const events: WildlifeEvent[] = [];
      stepUnit(u, t, far, SEED, 12, [], events);
      for (const e of events) {
        if (e.kind !== "call") continue;
        expect(Math.hypot(e.x - lead.x, e.y - lead.y, e.z - lead.z)).toBeLessThan(1);
        // And it is genuinely NOT the centre — the whole loop radius away from it, which is
        // what a revert to `u.x/u.z` would emit.
        expect(Math.hypot(e.x - unit.homeX, e.z - unit.homeZ)).toBeGreaterThan(unit.radius * 0.8);
        heard++;
      }
    }
    expect(heard).toBeGreaterThan(0);
  });
  it("a flier's first-tick call is dropped rather than emitted from its ground seat", () => {
    // `createUnitState` seats every pose at the unit's ground height — there is no loop
    // geometry to seat a bird on until `poseBirds` has run — and the pose pass runs AFTER
    // the tick's calls. A call scheduled on a unit's very first tick would therefore be
    // emitted from the forest floor under the loop centre: up to 250 m of y error for an
    // eagle, and, now that the audio gates in 3-D, a wrongly kept or dropped voice.
    const unit = firstOf(SPECIES_GULL);
    // Find a tick the schedule fires on, by watching a warmed-up unit.
    const warm = createUnitState(unit, 1000, SEED);
    let fireTick = -1;
    for (let t = 1001; t <= 1001 + 120 * SIM_TICK_HZ && fireTick < 0; t++) {
      const events: WildlifeEvent[] = [];
      stepUnit(warm, t, far, SEED, 12, [], events);
      if (events.some((e) => e.kind === "call")) fireTick = t;
    }
    expect(fireTick).toBeGreaterThan(0);
    // A unit whose FIRST step lands on that tick: same seed, same tick, same slot draw.
    const fresh = createUnitState(unit, fireTick - 1, SEED);
    expect(fresh.posed).toBe(false);
    const events: WildlifeEvent[] = [];
    stepUnit(fresh, fireTick, far, SEED, 12, [], events);
    expect(events.filter((e) => e.kind === "call")).toEqual([]);
    // One slot at most: the unit is posed now and calls normally from here on.
    expect(fresh.posed).toBe(true);
    let later = 0;
    for (let t = fireTick + 1; t <= fireTick + 120 * SIM_TICK_HZ; t++) {
      const e2: WildlifeEvent[] = [];
      stepUnit(fresh, t, far, SEED, 12, [], e2);
      later += e2.filter((e) => e.kind === "call").length;
    }
    expect(later).toBeGreaterThan(0);
  });
  it("a ground unit's call still comes from the unit, not from a member's seat", () => {
    // The other half of the same defect: only ALOFT species moved. A herd's members are scattered up to
    // WILDLIFE_SPREAD around the lead, and its bugle stays on the lead — pinned as exact
    // equality, with the lead member's own seat measured alongside so the assertion cannot
    // be passing because the two happen to coincide.
    const unit = firstOf(SPECIES_ELK);
    const u = createUnitState(unit, 1000, SEED);
    let heard = 0;
    for (let t = 1001; t <= 1001 + 20 * 60 * SIM_TICK_HZ; t++) {
      const events: WildlifeEvent[] = [];
      stepUnit(u, t, far, SEED, 12, [], events);
      for (const e of events) {
        if (e.kind !== "call" || e.call !== CALL_ELK_BUGLE) continue;
        expect(e.x).toBe(u.x);
        expect(e.z).toBe(u.z);
        expect(Math.hypot(u.poses[0]!.x - u.x, u.poses[0]!.z - u.z)).toBeGreaterThan(0.5);
        heard++;
      }
      if (heard > 0) break;
    }
    expect(heard).toBeGreaterThan(0);
  });
  it("a treed squirrel chatters from the height it climbed to, not from the foot of the trunk", () => {
    const squirrel = firstOf(SPECIES_SQUIRREL);
    const { u, events } = run(SPECIES_SQUIRREL, () => [{ x: squirrel.homeX + 5, z: squirrel.homeZ }], 120 * SIM_TICK_HZ);
    expect(u.phase).toBe(PHASE_SETTLE);
    const treed = events.filter((e) => e.kind === "call" && e.call === CALL_SQUIRREL_CHATTER && e.y > squirrel.homeH + 1);
    expect(treed.length).toBeGreaterThan(0);
    for (const e of treed) {
      if (e.kind !== "call") continue;
      // Up the trunk, and still at the trunk in plan — a squirrel is not a flier.
      expect(e.y).toBeGreaterThanOrEqual(squirrel.homeH + SQUIRREL_CLIMB[0]);
      expect(Math.hypot(e.x - squirrel.homeX, e.z - squirrel.homeZ)).toBeLessThan(SQUIRREL_FORAGE_RADIUS);
    }
  });
  it("bugle intervals stay inside their (widened, independent-draw) bounds and shrink at dawn/dusk", () => {
    const unit = firstOf(SPECIES_ELK);
    // The schedule is a pure function of the absolute tick SLOT (slotTicks = the interval's
    // own max, boosted near dawn/dusk — see callIntervalNow), so a handful of slots is
    // enough to observe both properties this test checks: the noon slot is
    // ELK_BUGLE_INTERVAL[1] = 300 s long; stepping N_NOON_SLOTS of them covers every one of
    // the (3×-shorter, boosted) dawn slots that fit in the same span, N_NOON_SLOTS × 3 of
    // them — no need to run a full simulated hour to see either the ×3 boost or the gap
    // bound below, both of which are properties of any two/three consecutive slots.
    const slotTicks = Math.round(ELK_BUGLE_INTERVAL[1] * SIM_TICK_HZ);
    const N_NOON_SLOTS = 4;
    const horizon = N_NOON_SLOTS * slotTicks;
    const noon: number[] = [];
    const dawn: number[] = [];
    for (const [hour, sink] of [[12, noon], [DAWN_HOUR, dawn]] as const) {
      const u = createUnitState(unit, 0, SEED);
      const events: WildlifeEvent[] = [];
      let lastCall = 0;
      for (let t = 1; t <= horizon; t++) {
        stepUnit(u, t, far, SEED, hour, [], events);
        const e = events.find((ev) => ev.kind === "call" && ev.call === CALL_ELK_BUGLE);
        if (e) { sink.push((t - lastCall) / SIM_TICK_HZ); lastCall = t; events.length = 0; }
      }
    }
    // Each slot's own draw is still inside the (possibly boosted) interval, but consecutive
    // slots draw INDEPENDENTLY (the purity requirement — no chaining from the previous
    // call), so the observed GAP between two calls can range from the interval's floor (one
    // slot ends late, the next starts early) up to 2×max − min (one ends early, the next
    // starts late) rather than staying inside [lo, hi] the way a chained schedule would.
    const minGap = ELK_BUGLE_INTERVAL[0];
    const maxGap = 2 * ELK_BUGLE_INTERVAL[1] - ELK_BUGLE_INTERVAL[0];
    for (const gap of noon) { expect(gap).toBeGreaterThanOrEqual(minGap - 1); expect(gap).toBeLessThanOrEqual(maxGap + 1); }
    expect(dawn.length).toBeGreaterThan(noon.length * 2);
    void DAWN_DUSK_WINDOW;
    void RAVEN_CROAK_INTERVAL;
  });
  it("walks a cued animal to its mark at the gait it was asked for, then hands it back to rest", () => {
    // Eight metres due north of where it stands, with the player nowhere near: a cue is a
    // walk to a mark, and nothing about the species' own state machine interrupts it.
    expect(cueSeconds(false)).toBeCloseTo(8 / RABBIT_RETURN_SPEED, 1);
    expect(cueSeconds(true)).toBeCloseTo(8 / RABBIT_BOLT_SPEED, 1);
  });

  it("plays the walk clip for a stroll and the run clip for a bolt", () => {
    expect(clipForPhase(SPECIES_RABBIT, PHASE_CUE, true)).toBe("walk");
    expect(clipForPhase(SPECIES_RABBIT, PHASE_CUE, true, true)).toBe("run");
    // Every species, including the squirrel, whose clip is otherwise chosen by whether it
    // is moving at all rather than by its phase.
    expect(clipForPhase(SPECIES_SQUIRREL, PHASE_CUE, true)).toBe("walk");
    expect(clipForPhase(SPECIES_SQUIRREL, PHASE_CUE, true, true)).toBe("run");
    expect(clipForPhase(SPECIES_ELK, PHASE_CUE, false, true)).toBe("run");
  });

  it("keeps a cued squirrel on the ground rather than clinging to a trunk it has left", () => {
    // PHASE_CUE sorts above PHASE_RETURN, so every "on the trunk" test that reads as an
    // inequality would put a squirrel crossing the forest floor belly-first against bark.
    const squirrel = firstOf(SPECIES_SQUIRREL);
    const u = createUnitState(squirrel, 1000, SEED);
    startCue(u, squirrel.homeX + 8, squirrel.homeZ, false, 1000);
    for (let t = 1001; t <= 1030; t++) stepUnit(u, t, far, SEED, 12, [], []);
    expect(u.phase).toBe(PHASE_CUE);
    expect(u.poses[0]!.pitch).toBe(0);
    expect(Math.hypot(u.poses[0]!.x - u.x, u.poses[0]!.z - u.z)).toBeLessThan(0.01);
  });

  it("glides a cued flier's whole circle to the mark and leaves it flying there", () => {
    // A bird has no walk: its position is a loop around a centre, so the cue moves the
    // centre and the bird keeps circling from wherever it ends up — no snap back to the
    // anchor the moment the cue ends.
    const gull = firstOf(SPECIES_GULL);
    const u = createUnitState(gull, 1000, SEED);
    const markX = gull.homeX + 40, markZ = gull.homeZ + 30; // 50 m away
    startCue(u, markX, markZ, false, 1000);
    let t = 1001;
    for (; t <= 1001 + 10 * SIM_TICK_HZ && u.phase === PHASE_CUE; t++) stepUnit(u, t, far, SEED, 12, [], []);
    expect(u.phase).toBe(PHASE_REST);
    expect((t - 1001) / SIM_TICK_HZ).toBeCloseTo(50 / GULL_SPEED, 1);
    expect(u.x).toBeCloseTo(markX, 6);
    expect(u.z).toBeCloseTo(markZ, 6);
    // Still flying its own circle, now centred on the mark rather than on the anchor.
    for (let k = 0; k < 120; k++) stepUnit(u, t + k, far, SEED, 12, [], []);
    expect(u.x).toBeCloseTo(markX, 6);
    for (const pose of u.poses) expect(Math.hypot(pose.x - markX, pose.z - markZ)).toBeLessThan(gull.radius * 1.2);
  });

  it("clear is the identity; rain grounds birds; dread keeps only ravens", () => {
    const clear = wildlifePresenceUnder(WEATHER_PRESETS.clear);
    expect(clear.ground).toBe(1); expect(clear.aloft).toBe(1); expect(clear.raven).toBe(1);
    expect(clear.callGain).toEqual(new Array(SPECIES_COUNT).fill(1));
    const rain = wildlifePresenceUnder(WEATHER_PRESETS.rain);
    expect(rain.aloft).toBeCloseTo(0.3, 5); expect(rain.ground).toBe(1); expect(rain.raven).toBeCloseTo(0.5, 5);
    const eerie = wildlifePresenceUnder(WEATHER_PRESETS.eerie);
    expect(eerie.ground).toBe(0); expect(eerie.aloft).toBe(0); expect(eerie.raven).toBe(2);
    expect(eerie.callGain[SPECIES_ELK]).toBe(0); expect(eerie.callGain[SPECIES_RAVEN_ROOST]).toBe(2);
  });
  it("dread crosses the threshold exactly at 0.5", () => {
    const half = wildlifePresenceUnder({ cloudCover: 0, mist: 0, rain: 0, wetness: 0, dread: 0.5 });
    expect(half.ground).toBe(0);
    expect(half.aloft).toBe(0);
    expect(half.raven).toBe(2);
  });
});
