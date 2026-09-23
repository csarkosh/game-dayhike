import { describe, expect, it } from "vitest";
import { SPECIES_DEER, SPECIES_ELK, SPECIES_RABBIT } from "../../src/game/wildlifeField.js";
import {
  GAP, HIDE_RANGE, HOLLOW_QUIET, LEAD, NIGHT_RELAX, NOTICE, SIGHTING_DWELL, SMALL_TO_LARGE, STILL_RELAX, STILL_SECONDS, VIEW_MARGIN,
  createDirectorState, hideRange, inCone, lineOfSight, observe, onScreen, relaxFor, type MatchState, type View,
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
