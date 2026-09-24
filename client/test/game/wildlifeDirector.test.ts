import { describe, expect, it, vi } from "vitest";
import { hash3 } from "../../src/sim/field.js";
import { PHASE_CUE, PHASE_REST } from "../../src/game/wildlifeBehaviour.js";
import {
  SPECIES_BUTTERFLY, SPECIES_DEER, SPECIES_EAGLE, SPECIES_ELK, SPECIES_GULL, SPECIES_RABBIT,
  SPECIES_RAVEN_PAIR, SPECIES_RAVEN_ROOST, SPECIES_SQUIRREL, unitId, WILDLIFE_RADIUS, WILDLIFE_SPREAD,
} from "../../src/game/wildlifeField.js";
import {
  CUE_PATIENCE, DIRECTOR_ID_BASE, GAP, GAP_CEILING, HIDE_RANGE, HOLLOW_QUIET, LEAD, NIGHT_RELAX, NOTICE, PLACE_BODY_H, RECYCLE,
  REMOVE_FACTOR, REMOVE_SECONDS, SIGHTING_DWELL, SMALL_TO_LARGE, STAGING_COVER, STAGING_CROSS, STAGING_TREELINE, STILL_RELAX, STILL_SECONDS, VIEW_MARGIN,
  createDirectorState, hideRange, inCone, lineOfSight, observe, onScreen, pickSpecies, placementValid, relaxFor,
  stageCue, stagingFor, step, type Candidate, type CueEvent, type DirectorState, type MatchState, type View,
} from "../../src/game/wildlifeDirector.js";

const flat = (): number => 0;
// A wall across x in (20, 24]: the closed upper bound puts the 30 m ray's
// fourth sample (at fraction 0.8, exactly x = 24) inside it, matching the
// story below ("a ridge between the eye and a deer at x = 30 hides it") —
// with the open interval as first drafted, none of the four fixed sample
// fractions (0.2/0.4/0.6/0.8 of 30 m: x = 6, 12, 18, 24) ever lands strictly
// inside (20, 24), so the wall would go undetected.
const ridge = (x: number): number => (x > 20 && x <= 24 ? 6 : 0);
const view = (yaw = 0, x = 0, z = 0): View => ({ x, y: 1.7, z, yaw, pitch: 0, fov: 1.4, aspect: 16 / 9 });
// What each species covers a cue at (m/s), mirroring `cueSpeed` in wildlifeBehaviour.ts:
// a gull crossing the frame at 12 m/s and an elk walking in at 2 are a different cue
// entirely, and a harness that moved both at one speed would test neither.
const cueSpeed = (species: number, run: boolean): number => {
  switch (species) {
    case SPECIES_ELK: case SPECIES_DEER: return run ? 9 : 2;
    case SPECIES_RABBIT: return run ? 8 : 3;
    case SPECIES_SQUIRREL: return run ? 6 : 2.5;
    case SPECIES_GULL: return 12;
    case SPECIES_EAGLE: return 8;
    default: return 10;
  }
};
// The three species whose "position" is a circle tens of metres across rather than a
// point: there is no spot the director could drop one of these where every bird of it
// starts out of frame, so it never places them.
const LOOP_FLIERS: readonly number[] = [SPECIES_RAVEN_PAIR, SPECIES_GULL, SPECIES_EAGLE];
/** The first tick from `from` whose species draw satisfies `want`. The draw is a pure
 * function of (seed, tick), so this is a lookup for the tick that asks the question the
 * test is about — not a hunt for a seed that happens to answer it. */
const tickDrawing = (s: DirectorState, seed: number, from: number, want: (sp: number) => boolean): number => {
  for (let tick = from; tick < from + 100; tick++) if (want(pickSpecies(s, hash3(seed, tick, 2, 0)))) return tick;
  throw new Error("no tick in range draws such a species");
};
/** A point at `bearing` radians right of where the view faces, `range` metres out. */
const at = (bearing: number, range: number, v = view()) => ({
  x: v.x + range * Math.sin(v.yaw + bearing), z: v.z + range * Math.cos(v.yaw + bearing),
});
/** The sighting log, read as the ring it is: once more than `RECYCLE_LOG` sightings have
 * been recorded the oldest live entry is the one the next write would overwrite, and
 * walking the array from index zero instead splices the newest run onto the oldest and
 * reads one gap as a large negative number. It does not bite over a thousand seconds; it
 * bites at four, which is exactly where a cadence measurement would want to go. */
const gapsOf = (s: DirectorState, relaxed?: readonly boolean[]): number[] => {
  const slots = s.log.length / 2;
  const kept = Math.min(s.logCount, slots);
  const first = s.logCount - kept;
  const gaps: number[] = [];
  for (let i = 1; i < kept; i++) {
    // With `relaxed` given, only the gaps the player walked the whole of.
    if (relaxed !== undefined && relaxed[first + i] === true) continue;
    const now = s.log[((first + i) % slots) * 2]!, prev = s.log[((first + i - 1) % slots) * 2]!;
    gaps.push((now - prev) / 60);
  }
  return gaps;
};
/** Whether the director's own stillness clock has passed the point where `relaxFor`
 * stretches the cadence — read off the director rather than re-derived from the walk. */
const standingStill = (s: DirectorState): boolean => s.stillFor > STILL_SECONDS;

/**
 * The players the cadence is measured against. `aimFrame` predicts where someone will be
 * looking, so the only honest way to grade it is against more than one kind of head.
 *
 * The first two are `graded` — every cadence assertion below runs on them.
 *
 * The first is a hiker on a trail: 1.4 m/s along a line that weaves, the head swinging
 * gently over it, peaking at 0.14 rad/s. A player who only ever turned would circle a
 * fixed patch of woods and never leave anything behind, which is the one walk that never
 * exercises the recycling half of the invariant, so this one covers ground.
 *
 * The second is a hiker who actually looks around: nine seconds of walking, then five
 * standing still and turning most of a right angle toward something and back, over and
 * over. It peaks at 0.44 rad/s — three times the first — and 35.5 % of its frames are
 * standing, which is what makes it hard on a predictor: the stops break the
 * constant-velocity guess the aim is built on. Its medians run 6.6 to 7.4 s where the
 * first runs 7.3 to 7.9, so it has real margin to lose before the band's floor.
 *
 * Neither is uniformly harder than the other, which is why both are kept: halving
 * `AIM_AHEAD` to 1.5 fails the first and not the second, while the second is the one with
 * the tighter median. A change that hurts the prediction shows up in one or the other.
 *
 * The last two are NOT graded, and must not be. A head sweeping through most of a circle
 * without pause for a thousand seconds is a stress input rather than a player, and an
 * assertion on one would either fail honestly or force a tune that makes the real cases
 * worse. They are here so the figures the design's gates section quotes can be reproduced
 * by whoever runs the gate later, and because the invariant IS asserted on them — it is
 * the promise that must hold under any head at all, not just a plausible one.
 */
type Walk = { name: string; graded: boolean; pose: (t: number) => { yaw: number; step: number } };
const WALKS: readonly Walk[] = [
  {
    name: "a hiker on a weaving trail",
    graded: true,
    pose: (t) => ({ yaw: 0.8 * Math.sin(t * 0.07) + 0.35 * Math.sin(t * 0.23), step: 0.14 }),
  },
  {
    name: "a hiker who stops and looks around",
    graded: true,
    pose: (t) => {
      const cycle = t % 14;
      const walking = cycle < 9;
      const drift = 0.5 * Math.sin(t * 0.05) + 0.3 * Math.sin(t * 0.35);
      const look = walking ? 0
        : (t % 28 < 14 ? 1 : -1) * 0.5 * (1 - Math.cos(2 * Math.PI * (cycle - 9) / 5)) / 2;
      return { yaw: drift + look, step: walking ? 0.14 : 0 };
    },
  },
  { name: "scanning sweeps, never pausing (ungraded)", graded: false, pose: (t) => ({ yaw: 1.4 * Math.sin(t * 0.57), step: 0.14 }) },
  { name: "fast mouse turns (ungraded)", graded: false, pose: (t) => ({ yaw: 3.0 * Math.sin(t * 0.8), step: 0.14 }) },
];
const day: MatchState = { phase: 0, hollowDistance: Infinity, hollowHunting: false, inWorld: true, hour: 12, mist: 0 };

describe("the on-screen predicate", () => {
  it("is inside the cone with a margin, within notice, nearer than the hide range, and not behind terrain", () => {
    expect(VIEW_MARGIN).toBeCloseTo(5 * Math.PI / 180, 12);
    // Yaw 0 looks down +z. A rabbit 10 m ahead is seen; 10 m behind is not; at 14 m off the edge of a 1.4 rad cone it is not.
    expect(inCone(view(), 0, 0.3, 10, VIEW_MARGIN)).toBe(true);
    expect(inCone(view(), 0, 0.3, -10, VIEW_MARGIN)).toBe(false);
    const halfW = Math.tan(1.4 / 2) * (16 / 9); // horizontal half-extent per metre of depth
    expect(inCone(view(), halfW * 10 * 1.2, 0.3, 10, VIEW_MARGIN)).toBe(false);
    expect(onScreen(view(), flat, { id: 1, species: SPECIES_RABBIT, x: 0, y: 0.3, z: 10 }, 0)).toBe(true);
    expect(onScreen(view(), flat, { id: 1, species: SPECIES_RABBIT, x: 0, y: 0.3, z: NOTICE[SPECIES_RABBIT]! + 1 }, 0)).toBe(false);
    expect(onScreen(view(), flat, { id: 1, species: SPECIES_ELK, x: 0, y: 1.2, z: 40 }, 0)).toBe(true);
    expect(onScreen(view(), flat, { id: 1, species: SPECIES_ELK, x: 0, y: 1.2, z: 46 }, 0)).toBe(false);
    // Fog: at mist 1 the hide range is 40 m, so the elk at 40 m is gone.
    expect(hideRange(0)).toBe(HIDE_RANGE[0]); expect(hideRange(1)).toBe(HIDE_RANGE[1]);
    expect(onScreen(view(), flat, { id: 1, species: SPECIES_ELK, x: 0, y: 1.2, z: 40 }, 1)).toBe(false);
    // Terrain: a 6 m ridge between the eye and a deer at x = 30 hides it; looking along +x.
    expect(lineOfSight(ridge, view(Math.PI / 2), 30, 1.2, 0)).toBe(false);
    expect(lineOfSight(ridge, view(Math.PI / 2), 15, 1.2, 0)).toBe(true);
    expect(onScreen(view(Math.PI / 2), ridge, { id: 2, species: SPECIES_DEER, x: 30, y: 1.2, z: 0 }, 0)).toBe(false);
  });
});

describe("the clock", () => {
  it("counts a sighting after the dwell, resets, and redraws the gap inside the band", () => {
    const s = createDirectorState(7);
    expect(s.targetGap).toBeGreaterThanOrEqual(GAP[0]); expect(s.targetGap).toBeLessThanOrEqual(GAP[1]);
    const rabbit = { id: 1, species: SPECIES_RABBIT, x: 0, y: 0.3, z: 10 };
    for (let i = 0; i < 30; i++) observe(s, view(), flat, [rabbit], day, 1 / 60, 7); // 0.5 s: no sighting yet
    expect(s.logCount).toBe(0);
    for (let i = 0; i < 40; i++) observe(s, view(), flat, [rabbit], day, 1 / 60, 7); // past SIGHTING_DWELL
    expect(s.logCount).toBe(1);
    expect(s.sinceSighting).toBeLessThan(0.2);
    expect(s.lastSpecies).toBe(SPECIES_RABBIT);
    // Off screen the clock runs: measure the INCREASE over these 5 s, not the
    // absolute value — the dwell that just fired the sighting used up 60 of
    // the previous 70 frames, leaving a ~1/6 s remainder already on the
    // clock, and the delta is what isolates "sinceSighting advances by dt
    // while nothing is on screen" from that remainder.
    const beforeOffScreen = s.sinceSighting;
    for (let i = 0; i < 300; i++) observe(s, view(), flat, [], day, 1 / 60, 7);
    expect(s.sinceSighting - beforeOffScreen).toBeCloseTo(5, 1);
    expect(SIGHTING_DWELL).toBe(1); expect(LEAD).toBe(2); expect(SMALL_TO_LARGE).toBe(6);
  });
  it("keeps the current candidate while it stays on screen, even once another arrives", () => {
    const s = createDirectorState(7);
    const rabbit = { id: 1, species: SPECIES_RABBIT, x: 0, y: 0.3, z: 10 };
    const elk = { id: 2, species: SPECIES_ELK, x: 0, y: 1.2, z: 40 };
    for (let i = 0; i < 30; i++) observe(s, view(), flat, [rabbit], day, 1 / 60, 7); // 0.5 s on the rabbit alone
    expect(s.logCount).toBe(0);
    // The elk arrives and stays visible alongside the rabbit for the rest of
    // the dwell — it must not steal or reset the rabbit's accumulating dwell.
    for (let i = 0; i < 40; i++) observe(s, view(), flat, [rabbit, elk], day, 1 / 60, 7);
    expect(s.logCount).toBe(1);
    expect(s.lastSpecies).toBe(SPECIES_RABBIT);
  });
  it("counts a second animal in view as its own sighting, and the first only once while it stays", () => {
    // The log is what the cadence is read off, so it has to say what the player saw. A deer
    // grazing in frame for a minute must not write sixty entries — but it must not silence
    // the log either, and it used to: the director latched onto the first animal it counted
    // and ignored everything else until that one left, so a stretch with two and three
    // animals coming and going read back as twenty seconds of empty woods.
    const s = createDirectorState(7);
    const rabbit = { id: 1, species: SPECIES_RABBIT, x: 0, y: 0.3, z: 8 };
    const elk = { id: 2, species: SPECIES_ELK, x: 0, y: 1.2, z: 40 };
    const seconds = (n: number, units: typeof rabbit[]) => {
      for (let i = 0; i < n * 60; i++) observe(s, view(), flat, units, day, 1 / 60, 7);
    };
    seconds(2, [rabbit]);           // the rabbit alone: one sighting, and only one
    expect(s.logCount).toBe(1);
    seconds(2, [rabbit, elk]);      // the elk walks in beside it: a second animal, a second entry
    expect(s.logCount).toBe(2);
    expect(s.lastSpecies).toBe(SPECIES_ELK);
    seconds(5, [rabbit, elk]);      // both still standing there: nothing new to report
    expect(s.logCount).toBe(2);
    seconds(2, [elk]);              // the rabbit leaves and comes back, which is a fresh look
    seconds(2, [rabbit, elk]);
    expect(s.logCount).toBe(3);
    expect(s.lastSpecies).toBe(SPECIES_RABBIT);
  });
  it("switches to the nearest already-on-screen unit once the current candidate leaves", () => {
    const s = createDirectorState(7);
    const elk = { id: 2, species: SPECIES_ELK, x: 0, y: 1.2, z: 40 };
    const rabbit = { id: 1, species: SPECIES_RABBIT, x: 0, y: 0.3, z: 8 }; // nearer
    const deer = { id: 3, species: SPECIES_DEER, x: 0, y: 1.2, z: 20 }; // farther
    for (let i = 0; i < 10; i++) observe(s, view(), flat, [elk], day, 1 / 60, 7); // elk dwells, partial
    expect(s.logCount).toBe(0);
    // The elk leaves; the rabbit and the deer are both already on screen the
    // very frame it does — the nearer of the two becomes the new candidate,
    // with a fresh dwell (the elk's partial dwell is discarded, not banked).
    for (let i = 0; i < 60; i++) observe(s, view(), flat, [rabbit, deer], day, 1 / 60, 7);
    expect(s.logCount).toBe(1);
    expect(s.lastSpecies).toBe(SPECIES_RABBIT);
  });
  it("relaxes when still, at night, and goes quiet for the chase, the Hollow and other screens", () => {
    const s = createDirectorState(7);
    expect(relaxFor(s, day)).toBe(1);
    s.stillFor = STILL_SECONDS + 0.1;
    expect(relaxFor(s, day)).toBe(STILL_RELAX);
    s.stillFor = 0;
    expect(relaxFor(s, { ...day, hour: 2 })).toBe(NIGHT_RELAX);
    // Both at once: the larger relaxation wins rather than compounding — a
    // still player at night getting the product (1.8 x 2.5 = 4.5) would
    // stretch the 5-10 s GAP band to as much as 45 s, which reads as empty
    // woods rather than a relaxed cadence.
    s.stillFor = STILL_SECONDS + 0.1;
    expect(relaxFor(s, { ...day, hour: 2 })).toBe(NIGHT_RELAX);
    s.stillFor = 0;
    expect(relaxFor(s, { ...day, phase: 1 })).toBe(Infinity);
    expect(relaxFor(s, { ...day, hollowDistance: HOLLOW_QUIET - 1 })).toBe(Infinity);
    expect(relaxFor(s, { ...day, hollowHunting: true })).toBe(Infinity);
    expect(relaxFor(s, { ...day, inWorld: false })).toBe(Infinity);
  });
  it("tracks stillness from the view's own movement", () => {
    const s = createDirectorState(7);
    for (let i = 0; i < 240; i++) observe(s, view(0, 0, 0), flat, [], day, 1 / 60, 7); // 4 s still
    expect(s.stillFor).toBeGreaterThan(STILL_SECONDS);
    observe(s, view(0, 0, 1), flat, [], day, 1 / 60, 7); // 60 m/s for a frame
    expect(s.stillFor).toBe(0);
  });
});

describe("cues", () => {
  it("weights small over large six to one and never repeats the last species", () => {
    const s = createDirectorState(3);
    const counts = new Map<number, number>();
    for (let i = 0; i < 10000; i++) { const sp = pickSpecies(s, (i + 0.5) / 10000); counts.set(sp, (counts.get(sp) ?? 0) + 1); }
    const small = [SPECIES_RABBIT, SPECIES_SQUIRREL, SPECIES_RAVEN_ROOST, SPECIES_RAVEN_PAIR, SPECIES_GULL, SPECIES_BUTTERFLY]
      .reduce((a, sp) => a + (counts.get(sp) ?? 0), 0);
    const large = [SPECIES_DEER, SPECIES_ELK, SPECIES_EAGLE].reduce((a, sp) => a + (counts.get(sp) ?? 0), 0);
    expect(small / large).toBeGreaterThan(SMALL_TO_LARGE * 0.9);
    expect(small / large).toBeLessThan(SMALL_TO_LARGE * 1.1);
    // Two species a cue never draws, for two different reasons: the roost is bolted to its
    // snag, so there is no mark to send it to, and the eagle flies higher than anything can
    // be made out from, so a cue for one would be a beat spent on nothing the player sees.
    expect(counts.get(SPECIES_RAVEN_ROOST) ?? 0).toBe(0);
    expect(counts.get(SPECIES_EAGLE) ?? 0).toBe(0);
    s.lastSpecies = SPECIES_RABBIT;
    for (let i = 0; i < 1000; i++) expect(pickSpecies(s, (i + 0.5) / 1000)).not.toBe(SPECIES_RABBIT);
  });

  it("stages by species: cross for birds, cover for rabbit and squirrel, tree line for deer and elk", () => {
    expect(stagingFor(SPECIES_GULL)).toBe(STAGING_CROSS);
    expect(stagingFor(SPECIES_BUTTERFLY)).toBe(STAGING_CROSS);
    expect(stagingFor(SPECIES_RABBIT)).toBe(STAGING_COVER);
    expect(stagingFor(SPECIES_SQUIRREL)).toBe(STAGING_COVER);
    expect(stagingFor(SPECIES_ELK)).toBe(STAGING_TREELINE);
    expect(stagingFor(SPECIES_DEER)).toBe(STAGING_TREELINE);
  });

  it("gives every species a cue can produce an entry in every table read per unit", () => {
    // The field's own scans stop at SPECIES_COUNT, so a table with eight entries looks
    // complete right up until the director puts a butterfly in the world and something
    // reads index eight off the end of it.
    for (const species of [SPECIES_ELK, SPECIES_DEER, SPECIES_RABBIT, SPECIES_SQUIRREL, SPECIES_RAVEN_PAIR, SPECIES_GULL, SPECIES_BUTTERFLY]) {
      expect(NOTICE[species]).toBeDefined();
      expect(WILDLIFE_RADIUS[species]).toBeDefined();
      expect(WILDLIFE_SPREAD[species]).toBeDefined();
    }
    // A butterfly is eight centimetres of wing: it stops reading as an animal nearer than
    // a rabbit does, and its disc has to outreach that so it is never culled while it
    // could still count.
    expect(NOTICE[SPECIES_BUTTERFLY]!).toBeLessThan(NOTICE[SPECIES_RABBIT]!);
    expect(WILDLIFE_RADIUS[SPECIES_BUTTERFLY]!).toBeGreaterThan(NOTICE[SPECIES_BUTTERFLY]!);
    expect(WILDLIFE_RADIUS[SPECIES_BUTTERFLY]!).toBeLessThan(WILDLIFE_RADIUS[SPECIES_SQUIRREL]!);
  });

  it("holds the invariant's predicate: in frame and in range is the only place a cue may not start", () => {
    // 10 m straight ahead, unobstructed, in clear air: the one forbidden case.
    expect(placementValid(view(), flat, 0, 1, 10, 0)).toBe(false);
    // Behind the player, and out past the frame's widened edge at the same depth.
    expect(placementValid(view(), flat, 0, 1, -10, 0)).toBe(true);
    const halfW = Math.tan(1.4 / 2) * (16 / 9);
    expect(placementValid(view(), flat, halfW * 10 * 1.3, 1, 10, 0)).toBe(true);
    // Behind the ridge, looking along +x; and past the mist, which closes to 40 m at mist 1.
    expect(placementValid(view(Math.PI / 2), ridge, 30, 1, 0, 0)).toBe(true);
    expect(placementValid(view(), flat, 0, 1, 50, 1)).toBe(true);
    expect(placementValid(view(), flat, 0, 1, 50, 0)).toBe(false);
    // The widened cone, not the strict one: a point just outside the frame is still on the
    // wrong side of the margin, so it is no place to start an animal even though `onScreen`
    // would already call it unseen.
    const justOut = halfW * 10 * 1.02;
    expect(onScreen(view(), flat, { id: 1, species: SPECIES_ELK, x: justOut, y: 1, z: 10 }, 0)).toBe(false);
    expect(placementValid(view(), flat, justOut, 1, 10, 0)).toBe(false);
  });

  it("prefers to drive an existing off-screen unit, and places only when none is available", () => {
    const s = createDirectorState(3);
    s.sinceSighting = 20; s.targetGap = 5;
    const out: CueEvent[] = [];
    // The cue's species is a pure draw on (seed, tick), so the test can ask for it rather
    // than hunting for a seed whose draw happens to land where it wants. A tick drawing a
    // placeable species, so that both halves — drive and the fall-back to place — are on
    // the table; the loop fliers, which are never placed, have their own case in the sweep.
    const tick = tickDrawing(s, 3, 100, (sp) => !LOOP_FLIERS.includes(sp));
    const chosen = pickSpecies(s, hash3(3, tick, 2, 0));
    // Just past the frame's right edge at twenty metres: close enough that even an elk,
    // the slowest thing a cue can draw, can walk to its mark inside the cue's budget. An
    // animal DIRECTLY BEHIND the player is not a candidate however near it is — it cannot
    // get anywhere the player is looking in the time the beat has.
    const edge = at(1.1, 20);
    const behind = { id: 9, species: chosen, x: edge.x, y: 1, z: edge.z, moveX: edge.x, moveZ: edge.z, moveR: 0, onScreen: false, phase: PHASE_REST, owned: false };

    expect(stageCue(s, view(), flat, [behind], day, tick, 3, out)).toBe(true);
    expect(out[0]!.kind).toBe("drive");
    expect(out[0]).toMatchObject({ id: 9 });

    // Another species is no use to this cue, so it places one of its own instead.
    out.length = 0;
    const other = { ...behind, species: chosen === SPECIES_ELK ? SPECIES_DEER : SPECIES_ELK };
    expect(stageCue(s, view(), flat, [other], day, tick, 3, out)).toBe(true);
    expect(out[0]!.kind).toBe("place");
    expect(out[0]).toMatchObject({ species: chosen });

    // Nor is one of the right species that is too far away to walk in.
    out.length = 0;
    const far = at(1.1, RECYCLE + 10);
    const distant = { ...behind, x: far.x, z: far.z, moveX: far.x, moveZ: far.z };
    expect(stageCue(s, view(), flat, [distant], day, tick, 3, out)).toBe(true);
    expect(out[0]!.kind).toBe("place");

    // Nor is one the player is looking straight at.
    out.length = 0;
    const inFrame = { ...behind, x: 0, z: 10, moveX: 0, moveZ: 10, onScreen: true };
    expect(stageCue(s, view(), flat, [inFrame], day, tick, 3, out)).toBe(true);
    expect(out[0]!.kind).toBe("place");

    // Nor — and this is the whole margin — one sitting in the slack just past the frame's
    // edge: `onScreen` already calls it unseen, but one flick of the mouse brings it into
    // view, and an animal that turns on the spot as the player looks at it gives the game
    // away exactly as badly as one that appears out of nothing.
    out.length = 0;
    const halfW = Math.tan(1.4 / 2) * (16 / 9);
    const inMargin = { ...behind, x: halfW * 10, z: 10, y: 1, moveX: halfW * 10, moveZ: 10 };
    expect(onScreen(view(), flat, inMargin, 0)).toBe(false);
    expect(placementValid(view(), flat, inMargin.x, inMargin.y, inMargin.z, 0)).toBe(false);
    expect(stageCue(s, view(), flat, [inMargin], day, tick, 3, out)).toBe(true);
    expect(out[0]!.kind).toBe("place");

    // With nothing at all, a placement — and it starts somewhere the player cannot see.
    out.length = 0;
    expect(stageCue(s, view(), flat, [], day, tick, 3, out)).toBe(true);
    const placed = out[0]!;
    expect(placed.kind).toBe("place");
    if (placed.kind === "place") expect(placementValid(view(), flat, placed.x, placed.y, placed.z, 0)).toBe(true);
  });

  it("starts every species out of sight, at the height it says, and marks it where it will read as seen", () => {
    // A sweep over ticks rather than a hunt for a seed: the species is a pure draw on
    // (seed, tick), so four hundred ticks walk the whole weight table and put every
    // staging through the invariant, not just the two a single seed happens to pick.
    const s = createDirectorState(5);
    const v = view(0.3, 5, -5);
    const out: CueEvent[] = [];
    const drawn = new Set<number>();
    const staged = new Set<number>();
    const placedSpecies = new Set<number>();
    for (let tick = 0; tick < 400; tick++) {
      const species = pickSpecies(s, hash3(5, tick, 2, 0));
      drawn.add(species);
      staged.add(stagingFor(species));

      // With nothing to drive, the beat redraws until it finds a species it can put into the
      // world unseen. A loop flier's circle is tens of metres across and never can be, so
      // one is never placed — and with only two of them among seven cueable species and
      // four distinct draws to spend, a beat always finds something it can hide.
      out.length = 0;
      expect(stageCue(s, v, flat, [], day, tick, 5, out)).toBe(true);
      const e = out[0]!;
      expect(e.kind).toBe("place");
      if (e.kind !== "place") continue;
      expect(LOOP_FLIERS).not.toContain(e.species);
      placedSpecies.add(e.species);
      // At the height the event itself names — the director validated that point, so that
      // is the point the shell must seat the animal at.
      expect(e.y).toBe(PLACE_BODY_H);
      expect(placementValid(v, flat, e.x, e.y, e.z, 0)).toBe(true);
      // Breaking cover and walking out of the tree line both end in frame and in range —
      // an animal marched to a spot the director itself would not count as seen is a cue
      // that cannot land. A crossing ends at the far edge on purpose: the flier passes
      // through the frame and out of it.
      if (stagingFor(e.species) !== STAGING_CROSS) {
        expect(onScreen(v, flat, { id: 0, species: e.species, x: e.goalX, y: e.y, z: e.goalZ }, 0)).toBe(true);
      }
      expect(Math.hypot(e.goalX - v.x, e.goalZ - v.z)).toBeLessThanOrEqual(hideRange(0));
    }
    // Every species a cue can draw, and all three stagings.
    expect([...drawn].sort((a, b) => a - b)).toEqual(
      [SPECIES_ELK, SPECIES_DEER, SPECIES_RABBIT, SPECIES_SQUIRREL, SPECIES_RAVEN_PAIR, SPECIES_GULL, SPECIES_BUTTERFLY].sort((a, b) => a - b),
    );
    expect(staged.size).toBe(3);
    // The butterfly is the one flier with no loop, so it is the one flier that is placed.
    expect([...placedSpecies].sort((a, b) => a - b)).toEqual(
      [SPECIES_ELK, SPECIES_DEER, SPECIES_RABBIT, SPECIES_SQUIRREL, SPECIES_BUTTERFLY].sort((a, b) => a - b),
    );
  });

  it("never cues a loop flier at all: the whole circle has to be hidden and no such place is in reach", () => {
    // `placeable` already refuses to PLACE a raven pair, a gull flock or an eagle, because a
    // circle twenty to a hundred and forty metres across has nowhere to appear unseen. No
    // flock can be DRIVEN either, and this sweeps the whole space to show it: over every
    // altitude and loop radius the field draws, at every bearing and out to four hundred
    // metres, there is no flock the director will move. The zero-radius rows are the
    // interesting ones — a bird with no circle at all is refused too, so what rules a
    // crossing out is the flight budget rather than the circle or the reach (see
    // `placeable`), and this pins that by covering the case the circle cannot explain.
    //
    // So the two loop fliers left in the cue table are draws that always redraw. If this
    // ever goes red — a longer reach for fliers, a crossing that does not have to leave by
    // the far edge — that is the day a flier cue becomes possible, and the day the mark's
    // anchor space (see `Candidate`) gets an end-to-end fixture again.
    const shapes: [number, number[], number[]][] = [
      [SPECIES_GULL, [15, 25, 40], [0, 20, 35, 50]],
      [SPECIES_RAVEN_PAIR, [40, 60, 80], [0, 30, 45, 60]],
    ];
    for (const [species, altitudes, radii] of shapes) {
      const s = createDirectorState(3);
      s.sinceSighting = 20; s.targetGap = 5;
      const tick = tickDrawing(s, 3, 100, (sp) => sp === species);
      const out: CueEvent[] = [];
      for (const y of altitudes) for (const moveR of radii) {
        for (let bearing = 0; bearing < Math.PI; bearing += 0.2) for (let r = 10; r <= 400; r += 10) {
          const x = r * Math.sin(bearing), z = r * Math.cos(bearing);
          const flock: Candidate = { id: 9, species, x, y, z, moveX: x, moveZ: z, moveR, onScreen: false, phase: PHASE_REST, owned: false };
          out.length = 0;
          stageCue(s, view(), flat, [flock], day, tick, 3, out);
          for (const event of out) expect(event.kind).not.toBe("drive");
        }
      }
    }
  });

  it("refuses to drive a flock whose circle the player can see, however hidden its lead bird", () => {
    // The argument that stops a loop flier being PLACED — a circle tens of metres across
    // has nowhere to appear unseen — holds just as hard for turning one that is already
    // flying, because the cue moves the anchor and the anchor carries every bird on the
    // circle with it. A gull forty-eight metres off to the left is hidden; the loop it is
    // flying is centred twenty-eight metres dead ahead, and swinging that is the whole
    // formation wheeling in front of a player who is watching that patch of sky.
    const s = createDirectorState(3);
    s.sinceSighting = 20; s.targetGap = 5;
    const tick = tickDrawing(s, 3, 100, (sp) => sp === SPECIES_GULL);
    const flock: Candidate = {
      id: 9, species: SPECIES_GULL, x: -48, y: 20, z: 12,
      moveX: 0, moveZ: 28, moveR: Math.hypot(48, 16), onScreen: false, phase: PHASE_REST, owned: false,
    };
    // The bird alone would have cleared the invariant; the centre plainly does not.
    expect(placementValid(view(), flat, flock.x, flock.y, flock.z, 0)).toBe(true);
    expect(placementValid(view(), flat, flock.moveX, flock.y, flock.moveZ, 0)).toBe(false);
    const out: CueEvent[] = [];
    stageCue(s, view(), flat, [flock], day, tick, 3, out);
    for (const event of out) expect(event).not.toMatchObject({ kind: "drive", id: 9 });
  });

  it("waits out the retry and the quiet states before arranging anything", () => {
    const out: CueEvent[] = [];
    const s = createDirectorState(3);
    s.sinceSighting = 20; s.targetGap = 5;
    const tick = tickDrawing(s, 3, 100, (sp) => !LOOP_FLIERS.includes(sp));
    // Quiet: the chase owns the player's attention, so nothing is staged however overdue.
    step(s, view(), flat, [], { ...day, phase: 1 }, 1 / 60, tick, 3, out);
    expect(out).toHaveLength(0);
    // Due, but the previous beat's wait has not run out yet.
    s.nextTry = 10_000;
    step(s, view(), flat, [], day, 1 / 60, tick, 3, out);
    expect(out).toHaveLength(0);
    // Due and free.
    s.nextTry = 0;
    step(s, view(), flat, [], day, 1 / 60, tick, 3, out);
    expect(out).toHaveLength(1);
    // And having arranged one, it does not arrange another on the very next frame.
    out.length = 0;
    step(s, view(), flat, [], day, 1 / 60, tick + 1, 3, out);
    expect(out).toHaveLength(0);
  });

  it("gives a pool unit back only once it is far out of sight, and never one still on its way in", () => {
    const out: CueEvent[] = [];
    const s = createDirectorState(3);
    // A hundred metres behind the player: well past 1.5x the fifteen a rabbit reads at.
    const gone: Candidate = { id: DIRECTOR_ID_BASE + 1, species: SPECIES_RABBIT, x: 0, y: 0.3, z: -100, moveX: 0, moveZ: -100, moveR: 0, onScreen: false, phase: PHASE_REST, owned: true };
    expect(Math.abs(gone.z)).toBeGreaterThan(REMOVE_FACTOR * NOTICE[SPECIES_RABBIT]!);
    for (let i = 0; i < REMOVE_SECONDS * 10 - 1; i++) step(s, view(), flat, [gone], day, 0.1, 100, 3, out);
    expect(out.filter((e) => e.kind === "remove")).toHaveLength(0);
    for (let i = 0; i < 2; i++) step(s, view(), flat, [gone], day, 0.1, 100, 3, out);
    expect(out.filter((e) => e.kind === "remove")).toEqual([{ kind: "remove", id: gone.id }]);

    // A unit of the field's own making is never the director's to take away, and a pool
    // unit still walking its cue is exempt however far off it started.
    //
    // The field-made one carries an id shaped the way `unitId()` actually draws one — not a
    // small placeholder — and is unowned rather than merely differently numbered. `owned` is
    // what `sweepRemovals` reads now; a synthetic id chosen to sit anywhere on the number
    // line proves nothing about that, and a real field id is routinely FAR larger than
    // `DIRECTOR_ID_BASE` (a cell no distance from the origin already packs to north of 2^30 —
    // see `DIRECTOR_ID_BASE`'s own doc), which is exactly the shape of id that once read as
    // director-owned under the bare `id >= DIRECTOR_ID_BASE` this replaced.
    const fieldMade = { ...gone, owned: false, id: unitId(SPECIES_RABBIT, 40, -60) };
    expect(fieldMade.id).toBeGreaterThan(DIRECTOR_ID_BASE);
    for (const held of [fieldMade, { ...gone, phase: PHASE_CUE }]) {
      const s2 = createDirectorState(3);
      const out2: CueEvent[] = [];
      for (let i = 0; i < REMOVE_SECONDS * 120; i++) step(s2, view(), flat, [held], day, 1 / 60, 100, 3, out2);
      expect(out2.filter((e) => e.kind === "remove")).toHaveLength(0);
    }
  });

  it.each(WALKS)("never places, drives or removes on screen, and keeps the cadence's whole distribution: $name, seven seeds, a thousand seconds each", (walk) => {
    type Unit = Candidate & { goalX: number; goalZ: number; speed: number };
    const medians: number[] = [];
    for (const SEED of [3, 5, 11, 17, 23, 29, 31]) {
      const s = createDirectorState(SEED);
      const units: Unit[] = [];
      const out: CueEvent[] = [];
      const stagedSinceSighting = new Map<number, number>();
      let violations = 0, doubleStaged = 0, cues = 0, x = 0, z = 0, nextId = DIRECTOR_ID_BASE;
      let emptyRun = 0, longestEmpty = 0;
      const stagings = new Set<number>();
      const kinds = new Set<string>();
      // Which gaps the player walked through the whole of. The design's ceiling is on those:
      // once someone has stood still for `STILL_SECONDS` the cadence is SUPPOSED to stretch
      // by `STILL_RELAX`, so a long gap while they stand and look around is the feature
      // working, not the woods going quiet on a hiker.
      const relaxed: boolean[] = [];
      let relaxedThisGap = false;
      for (let tick = 0; tick < 1000 * 60; tick += 6) { // a thousand seconds, in steps of 0.1 s
        const t = tick / 60;
        const p = walk.pose(t);
        x += p.step * Math.sin(p.yaw); z += p.step * Math.cos(p.yaw);
        const v = view(p.yaw, x, z);
        out.length = 0;
        const logged = s.logCount;
        step(s, v, flat, units, day, 0.1, tick, SEED, out);
        // One unpaid cue at a time. A cue that has already been seen may be walked over the
        // top of, and so may one the beat has given up waiting on — but while a fresh cue is
        // still on its way in, a second animal must not be sent out on top of it.
        if (out.some((e) => e.kind !== "remove")) {
          if (units.some((u) => u.phase === PHASE_CUE && (stagedSinceSighting.get(u.id) ?? -Infinity) > t - CUE_PATIENCE)) doubleStaged++;
        }
        for (const e of out) {
          cues++;
          kinds.add(e.kind);
          if (e.kind === "place") {
            // At the height the event names: the director validated that exact point, and
            // the shell is required to seat the animal there.
            if (!placementValid(v, flat, e.x, e.y, e.z, 0)) violations++;
            units.push({
              id: nextId, species: e.species, x: e.x, y: e.y, z: e.z, moveX: e.x, moveZ: e.z, moveR: 0,
              // Every unit this drive ever creates comes from a `place` event, so `owned` is
              // true for the whole population here — this harness has no field-generated
              // units of its own at all; the dedicated removal test above is where an
              // unowned, realistically-numbered candidate is exercised.
              onScreen: false, phase: PHASE_CUE, owned: true, goalX: e.goalX, goalZ: e.goalZ, speed: cueSpeed(e.species, e.run),
            });
            stagedSinceSighting.set(nextId++, t);
            stagings.add(stagingFor(e.species));
          }
          if (e.kind === "drive") {
            const u = units.find((c) => c.id === e.id)!;
            // The strict predicate, not merely "not on screen": an animal a degree outside
            // the frame must not be seen turning either.
            if (!placementValid(v, flat, u.x, u.y, u.z, 0)) violations++;
            u.goalX = e.goalX; u.goalZ = e.goalZ; u.phase = PHASE_CUE; u.speed = cueSpeed(u.species, e.run);
            stagedSinceSighting.set(u.id, t);
            stagings.add(stagingFor(u.species));
          }
          if (e.kind === "remove") {
            const i = units.findIndex((c) => c.id === e.id);
            // Against THIS frame's view, like the other two arms — the cached flag is a
            // frame stale, and a stale flag is exactly what an invariant test must not trust.
            if (onScreen(v, flat, units[i]!, 0)) violations++;
            units.splice(i, 1);
          }
        }
        if (standingStill(s)) relaxedThisGap = true;
        while (relaxed.length < s.logCount) { relaxed.push(relaxedThisGap); relaxedThisGap = false; }
        if (s.logCount > logged) stagedSinceSighting.clear();
        // Walk every cued unit toward its mark, then refresh the on-screen flags.
        for (const u of units) {
          if (u.phase !== PHASE_CUE) continue;
          const dx = u.goalX - u.x, dz = u.goalZ - u.z, d = Math.hypot(dx, dz), stepD = u.speed * 0.1;
          if (d <= stepD) { u.x = u.goalX; u.z = u.goalZ; u.phase = PHASE_REST; }
          else { u.x += (dx / d) * stepD; u.z += (dz / d) * stepD; }
          // These animals are their own anchor; a flier's would not be (see `Candidate`).
          u.moveX = u.x; u.moveZ = u.z;
        }
        let anyOnScreen = false;
        for (const u of units) { u.onScreen = onScreen(v, flat, u, 0); anyOnScreen = anyOnScreen || u.onScreen; }
        emptyRun = anyOnScreen ? 0 : emptyRun + 0.1;
        longestEmpty = Math.max(longestEmpty, emptyRun);
      }
      expect(violations).toBe(0);
      expect(doubleStaged).toBe(0);
      // A floor, not a target: at one animal per five to ten seconds the woods owe the
      // player a hundred or so cues over this walk, and the point of the number is that the
      // invariant above was checked against a real stream of events rather than an empty one.
      expect(cues).toBeGreaterThan(50);
      expect(stagings.size).toBeGreaterThanOrEqual(2);
      // Every kind of event the director can emit was actually exercised — an invariant test
      // that never staged anything would prove nothing.
      expect([...kinds].sort()).toEqual(["drive", "place", "remove"]);
      // Everything above is asserted on every player, graded or not: the invariant is the
      // promise that has to hold under any head at all. What follows is the cadence, and a
      // cadence measured against a head nobody has is a number to record, not a bound to
      // hold code to — see `WALKS`.
      if (!walk.graded) continue;
      // The most direct statement of the promise there is, and the one no summary statistic
      // can flatter: this player walked the whole thousand seconds and was never without an
      // animal in frame for longer than the design's ceiling. (9.9 to 11.4 s when written.)
      expect(longestEmpty).toBeLessThanOrEqual(GAP_CEILING);

      const gaps = gapsOf(s);
      const walked = gapsOf(s, relaxed);
      expect(gaps.length).toBeGreaterThan(5);
      expect(walked.length).toBeGreaterThan(5);
      const ordered = gaps.slice().sort((a, b) => a - b);
      // THE WHOLE DISTRIBUTION, not a median. A median inside the band says nothing about
      // the tail, and the tail is what reads as lifeless: this same walk once had a median
      // of 7.2 s with a quarter of its gaps over twenty seconds and a worst case of ninety-
      // six, and every assertion here passed.
      //
      // - the median inside the band, which is the design's first half;
      // - MOST gaps inside it, not merely half of them either side of the middle — the
      //   promise is an animal every five to ten seconds, not an average of one. (81 to 87 %
      //   when written.)
      // - and nothing over `GAP_CEILING`, asserted twice over. Once on the gaps the player
      //   WALKED through, which is the design's second half word for word — standing still
      //   relaxes the cadence by `STILL_RELAX` on purpose, so a long gap while someone
      //   stands and looks around is the feature working. And once over EVERY gap, which
      //   is the stricter line and passes with room today (16.30 s on the first walk, 15.10
      //   on the second, against a ceiling of 20). The strict line is kept because it is
      //   free and because it is the one that catches a tail the walked filter would let
      //   through: before the crossing's range band was scaled to each species, the second
      //   walk's worst gap overall was 20.5 s while its worst walked gap was 11.8.
      //
      //   That filter is deliberately BROAD, and the gap between those two numbers is how
      //   broad: it drops a gap if the player stood at any point during it, not if the
      //   relaxed cadence was actually in force when the beat fell due. On the second walk
      //   35.5 % of frames are standing and that removes 64.1 % of the gaps. Narrowing it
      //   would be a better filter; keeping the strict line alongside is a better test.
      const median = ordered[Math.floor(ordered.length / 2)]!;
      expect(median).toBeGreaterThanOrEqual(GAP[0]);
      expect(median).toBeLessThanOrEqual(GAP[1]);
      const inBand = gaps.filter((g) => g >= GAP[0] && g <= GAP[1]).length;
      expect(inBand / gaps.length).toBeGreaterThan(0.5);
      expect(Math.max(...walked)).toBeLessThanOrEqual(GAP_CEILING);
      expect(ordered[ordered.length - 1]!).toBeLessThanOrEqual(GAP_CEILING);
      medians.push(median);
    }
    if (!walk.graded) return;
    // And the median of the medians, which is the figure a lucky seed cannot carry alone.
    const ordered = medians.slice().sort((a, b) => a - b);
    const middle = ordered[Math.floor(ordered.length / 2)]!;
    expect(middle).toBeGreaterThanOrEqual(GAP[0]);
    expect(middle).toBeLessThanOrEqual(GAP[1]);
  });

  it("makes no event and grows no storage on a quiet frame", () => {
    // What the design asks for is no allocation in the per-frame path, and the two ways this
    // module could break that are observable from outside: an event object made on a frame
    // that arranged nothing, and bookkeeping that grows with the length of the match. The
    // cue geometry's own scratch is module-level so that neither `markFor` nor `startFor`
    // makes a vector per try, and every loop on a per-frame path is indexed rather than
    // `for…of` so none of them makes an iterator. Neither of those is visible to a caller,
    // and no heap oracle here can stand in for them: `heapUsed` measures what the nursery
    // is holding rather than what was allocated, so a transient object per frame moves it
    // less than the runner's own churn does, and GC-event counts and the sampling heap
    // profiler both read zero either way. They are properties of the source, and the
    // comments at those loops say so. What follows is the part a caller CAN check.
    const s = createDirectorState(5);
    const log = s.log;
    const units: Candidate[] = [
      { id: 1, species: SPECIES_RABBIT, x: 0, y: 0.3, z: 8, moveX: 0, moveZ: 8, moveR: 0, onScreen: false, phase: PHASE_REST, owned: false },
      { id: DIRECTOR_ID_BASE, species: SPECIES_ELK, x: 30, y: 1.2, z: 5, moveX: 30, moveZ: 5, moveR: 0, onScreen: false, phase: PHASE_REST, owned: true },
    ];
    const out: CueEvent[] = [];
    const pushed = vi.spyOn(out, "push");
    // The chase owns the player's attention, so `step` observes and sweeps but never stages:
    // this is the path every frame of a real match takes between cues.
    const chase: MatchState = { ...day, phase: 1 };
    for (let i = 0; i < 20_000; i++) step(s, view(), flat, units, chase, 1 / 60, i, 5, out);
    expect(pushed).not.toHaveBeenCalled();
    expect(out).toHaveLength(0);
    pushed.mockRestore();

    // And over a long PLAYING match the log is still the one fixed ring it started as,
    // rather than an array that grows all afternoon. The rabbit walks in and out of view on
    // a four-second cycle, so the run banks far more sightings than the ring holds.
    const rabbit = units[0]!;
    for (let tick = 0; tick < 2000 * 60; tick += 6) {
      rabbit.z = (tick / 60) % 4 < 2 ? 8 : 500;
      out.length = 0;
      step(s, view(), flat, units, day, 0.1, tick, 5, out);
    }
    expect(s.logCount).toBeGreaterThan(s.log.length / 2);
    expect(s.log).toBe(log);
    expect(s.log).toHaveLength(log.length);
  });
});
