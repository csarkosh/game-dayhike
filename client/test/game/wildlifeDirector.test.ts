import { describe, expect, it } from "vitest";
import { hash3 } from "../../src/sim/field.js";
import { PHASE_CUE, PHASE_REST } from "../../src/game/wildlifeBehaviour.js";
import {
  SPECIES_BUTTERFLY, SPECIES_DEER, SPECIES_EAGLE, SPECIES_ELK, SPECIES_GULL, SPECIES_RABBIT,
  SPECIES_RAVEN_PAIR, SPECIES_RAVEN_ROOST, SPECIES_SQUIRREL,
} from "../../src/game/wildlifeField.js";
import {
  DIRECTOR_ID_BASE, GAP, HIDE_RANGE, HOLLOW_QUIET, LEAD, NIGHT_RELAX, NOTICE, PLACE_BODY_H, RECYCLE,
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
    const behind = { id: 9, species: chosen, x: 0, y: 0.3, z: -10, moveX: 0, moveZ: -10, onScreen: false, phase: PHASE_REST };

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
    const distant = { ...behind, z: -(RECYCLE + 10), moveZ: -(RECYCLE + 10) };
    expect(stageCue(s, view(), flat, [distant], day, tick, 3, out)).toBe(true);
    expect(out[0]!.kind).toBe("place");

    // Nor is one the player is looking straight at.
    out.length = 0;
    const inFrame = { ...behind, z: 10, moveZ: 10, onScreen: true };
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

      // With an off-screen one of its own species in reach, every cue drives. Sixty metres
      // UP and thirty back: within reach across the ground, which is the only distance a
      // cue has to cover, though further than that through the air.
      out.length = 0;
      const nearby: Candidate = { id: 4, species, x: v.x, y: 60, z: v.z - 30, moveX: v.x, moveZ: v.z - 30, onScreen: false, phase: PHASE_REST };
      expect(Math.hypot(nearby.y - v.y, 30)).toBeGreaterThan(RECYCLE);
      expect(placementValid(v, flat, nearby.x, nearby.y, nearby.z, 0)).toBe(true);
      expect(stageCue(s, v, flat, [nearby], day, tick, 5, out)).toBe(true);
      expect(out[0]!.kind).toBe("drive");

      // With none in reach, the beat redraws until it finds a species it can put into the
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

  it("measures a flier's mark from the circle it flies, not from the bird on it", () => {
    // The two are not the same place and the gap between them is the loop's radius — up to
    // fifty metres for a gull. The goal replaces the ANCHOR, so a mark measured off the
    // bird would put the circle that far from where the cue aimed it.
    const s = createDirectorState(3);
    s.sinceSighting = 20; s.targetGap = 5;
    const tick = tickDrawing(s, 3, 100, (sp) => sp === SPECIES_GULL);
    const at = (bearing: number, range: number) => ({ x: range * Math.sin(bearing), z: range * Math.cos(bearing) });
    const centre = at(2.09, 50);   // 120 degrees round, behind the right shoulder
    const bird = at(-1.75, 20);    // 100 degrees the other way, and much nearer
    const gull: Candidate = {
      id: 9, species: SPECIES_GULL, x: bird.x, y: 30, z: bird.z,
      moveX: centre.x, moveZ: centre.z, onScreen: false, phase: PHASE_REST,
    };
    const out: CueEvent[] = [];
    expect(stageCue(s, view(), flat, [gull], day, tick, 3, out)).toBe(true);
    const e = out[0]!;
    expect(e.kind).toBe("drive");
    if (e.kind !== "drive") return;
    // At the CIRCLE's range and across from the CIRCLE's side. Measured off the bird the
    // mark would come back at 20 m and on the other side of the frame, so both halves of
    // the convention are pinned here.
    expect(Math.hypot(e.goalX, e.goalZ)).toBeCloseTo(50, 6);
    expect(e.goalX).toBeLessThan(0);
    // And the bird, not the circle, is what the invariant was judged on: the circle's
    // centre is out of sight here too, so make the bird the only thing that could have
    // disqualified it — put the centre in plain view and the cue must refuse.
    out.length = 0;
    const seenCentre: Candidate = { ...gull, moveX: 0, moveZ: 30 };
    expect(placementValid(view(), flat, seenCentre.moveX, 30, seenCentre.moveZ, 0)).toBe(false);
    expect(stageCue(s, view(), flat, [seenCentre], day, tick, 3, out)).toBe(true);
    expect(out[0]!.kind).toBe("drive");
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
    const gone: Candidate = { id: DIRECTOR_ID_BASE + 1, species: SPECIES_RABBIT, x: 0, y: 0.3, z: -100, moveX: 0, moveZ: -100, onScreen: false, phase: PHASE_REST };
    expect(Math.abs(gone.z)).toBeGreaterThan(REMOVE_FACTOR * NOTICE[SPECIES_RABBIT]!);
    for (let i = 0; i < REMOVE_SECONDS * 10 - 1; i++) step(s, view(), flat, [gone], day, 0.1, 100, 3, out);
    expect(out.filter((e) => e.kind === "remove")).toHaveLength(0);
    for (let i = 0; i < 2; i++) step(s, view(), flat, [gone], day, 0.1, 100, 3, out);
    expect(out.filter((e) => e.kind === "remove")).toEqual([{ kind: "remove", id: gone.id }]);

    // A unit of the field's own making is never the director's to take away, and a pool
    // unit still walking its cue is exempt however far off it started.
    for (const held of [{ ...gone, id: 7 }, { ...gone, phase: PHASE_CUE }]) {
      const s2 = createDirectorState(3);
      const out2: CueEvent[] = [];
      for (let i = 0; i < REMOVE_SECONDS * 120; i++) step(s2, view(), flat, [held], day, 1 / 60, 100, 3, out2);
      expect(out2.filter((e) => e.kind === "remove")).toHaveLength(0);
    }
  });

  it("never places, drives or removes on screen: seven seeds, a thousand seconds each, with a walking, turning player", () => {
    for (const SEED of [3, 5, 11, 17, 23, 29, 31]) {
      const s = createDirectorState(SEED);
      type Unit = Candidate & { goalX: number; goalZ: number; speed: number };
      const units: Unit[] = [];
      const out: CueEvent[] = [];
      let violations = 0, cues = 0, x = 0, z = 0, nextId = DIRECTOR_ID_BASE;
      const stagings = new Set<number>();
      const kinds = new Set<string>();
      for (let tick = 0; tick < 1000 * 60; tick += 6) { // a thousand seconds, in steps of 0.1 s
        // A hiker, not a carousel: 1.4 m/s along a trail that weaves, with the head swinging
        // side to side over it. A player who only ever turned would circle a fixed patch of
        // woods and never leave anything behind, which is the one walk that never exercises
        // the recycling half of the invariant.
        const t = tick / 60;
        const yaw = 0.8 * Math.sin(t * 0.07) + 0.35 * Math.sin(t * 0.23);
        x += 0.14 * Math.sin(yaw); z += 0.14 * Math.cos(yaw);
        const v = view(yaw, x, z);
        out.length = 0;
        step(s, v, flat, units, day, 0.1, tick, SEED, out);
        for (const e of out) {
          cues++;
          kinds.add(e.kind);
          if (e.kind === "place") {
            // At the height the event names: the director validated that exact point, and
            // the shell is required to seat the animal there.
            if (!placementValid(v, flat, e.x, e.y, e.z, 0)) violations++;
            units.push({ id: nextId++, species: e.species, x: e.x, y: e.y, z: e.z, moveX: e.x, moveZ: e.z, onScreen: false, phase: PHASE_CUE, goalX: e.goalX, goalZ: e.goalZ, speed: cueSpeed(e.species, e.run) });
            stagings.add(stagingFor(e.species));
          }
          if (e.kind === "drive") {
            const u = units.find((c) => c.id === e.id)!;
            // The strict predicate, not merely "not on screen": an animal a degree outside
            // the frame must not be seen turning either.
            if (!placementValid(v, flat, u.x, u.y, u.z, 0)) violations++;
            u.goalX = e.goalX; u.goalZ = e.goalZ; u.phase = PHASE_CUE; u.speed = cueSpeed(u.species, e.run);
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
        // Walk every cued unit toward its mark, then refresh the on-screen flags.
        for (const u of units) {
          if (u.phase !== PHASE_CUE) continue;
          const dx = u.goalX - u.x, dz = u.goalZ - u.z, d = Math.hypot(dx, dz), stepD = u.speed * 0.1;
          if (d <= stepD) { u.x = u.goalX; u.z = u.goalZ; u.phase = PHASE_REST; }
          else { u.x += (dx / d) * stepD; u.z += (dz / d) * stepD; }
          // These animals are their own anchor; a flier's would not be (see `Candidate`).
          u.moveX = u.x; u.moveZ = u.z;
        }
        for (const u of units) u.onScreen = onScreen(v, flat, u, 0);
    }
    expect(violations).toBe(0);
    // A floor, not a target: at one animal per five to ten seconds the woods owe the
    // player a hundred or so cues over this walk, and the point of the number is that the
    // invariant above was checked against a real stream of events rather than an empty one.
    expect(cues).toBeGreaterThan(50);
    expect(stagings.size).toBeGreaterThanOrEqual(2);
    // Every kind of event the director can emit was actually exercised — an invariant test
    // that never staged anything would prove nothing.
    expect([...kinds].sort()).toEqual(["drive", "place", "remove"]);
    // The gaps' median lies inside the band itself (the log holds (tick, species) pairs) —
    // the cadence the whole feature is for, measured rather than assumed.
    const gaps: number[] = [];
    for (let i = 1; i < s.logCount; i++) gaps.push((s.log[i * 2]! - s.log[(i - 1) * 2]!) / 60);
    gaps.sort((a, b) => a - b);
    expect(gaps.length).toBeGreaterThan(5);
    const med = gaps[Math.floor(gaps.length / 2)]!;
    expect(med).toBeGreaterThanOrEqual(GAP[0]);
    // Above the band's top, and known to be: measured 9.2 to 12.1 s over these seven
    // seeds. A logged gap is not the target gap — it is the target gap less `LEAD`, plus
    // however long the staged animal takes to walk into frame, plus the second of
    // `SIGHTING_DWELL` before the look counts. That sum is what the bound spells out, and
    // `LEAD` is the lever that would close it; it has deliberately not been pulled.
    expect(med).toBeLessThanOrEqual(GAP[1] + LEAD + SIGHTING_DWELL);
    }
  });
});
