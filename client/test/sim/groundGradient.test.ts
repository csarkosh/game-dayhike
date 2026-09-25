import { describe, expect, it } from "vitest";
import "../../src/sim/passes/index.js";
import { elevationSampleAt } from "../../src/sim/terrain.js";
import { passHash } from "../../src/sim/forest.js";
import { treeInCell, treesInRect } from "../../src/sim/vegetation.js";
import {
  clutterInCell,
  clutterInRect,
  CLUTTER_CLASS_COUNT,
  CLUTTER_ROCK,
  CLUTTER_ROCK_CELL,
} from "../../src/sim/clutter.js";

const SEED = 0x5eed1;

/**
 * FNV-1a over the float64 bits of every census field. Bit-exact on purpose: the
 * scatter is pure field math, so a difference of any size is a difference, and
 * rounding here would only create a blind spot — the same argument
 * `registryDigest` makes about tunables.
 */
const bits = new DataView(new ArrayBuffer(8));
function mix(h: number, v: number): number {
  bits.setFloat64(0, v, true);
  h = Math.imul(h ^ bits.getUint32(0, true), 16777619);
  return Math.imul(h ^ bits.getUint32(4, true), 16777619);
}

/** Rect origins chosen so that EVERY class has instances in its box — several
 * classes (boulder, driftwood, flower) are empty near the world origin, and a
 * checksum over an empty list asserts nothing. */
const CLUTTER_CENSUS: readonly (readonly [number, number, number, number])[] = [
  // grass: 366 -> 987 on 2026-09-23 (the ground-cover field: grass now
  // grows wherever the floor is grass, thinning toward every edge instead
  // of gating shut, so this rect's occupancy rises with it).
  // grass: 987 -> 2491 on 2026-09-24 (the canopy floor rose from 0.15 to
  // 0.5, so grass now clears this class's threshold under closed canopy
  // where it used to thin below it).
  [600, -3000, 2491, 1727801207],
  [-200, -3000, 325, -601764019],
  [1800, -2200, 7, 570987439],
  [-600, -1400, 3, 956292241],
  // fungus: 553 -> 544 on 2026-09-10 (the trees' slope gate; hash re-pinned below).
  [-200, -3000, 544, 1329983015],
  [-200, -3000, 2128, -12565656],
  // meadow: 48 -> 51 on 2026-09-23 (shares the ground-cover field's grass reading).
  [-600, -3000, 51, 932472230],
  // flower: 105 -> 281 on 2026-09-23 (its base is the same field's grass reading).
  // flower: 281 -> 586 on 2026-09-24 (the canopy floor rose from 0.15 to
  // 0.5, raising the same field's grass reading flower is based on).
  [600, -3000, 586, -1819412639],
  // litter: along the stem near the trailhead, not near the world origin.
  // 111 -> 164 on 2026-09-24 (CLUTTER_LITTER_D 0.6 -> 0.9: a neglected trail
  // carries more stray stone and twig litter along its margin).
  [-500, -100, 164, 952976979],
];

describe("instances carry the ground gradient", () => {
  it("gives trees the exact dx/dz of their own ground sample", () => {
    let checked = 0;
    for (let cz = 0; cz < 40 && checked < 12; cz++) {
      for (let cx = 0; cx < 40 && checked < 12; cx++) {
        const t = treeInCell(SEED, cx, cz);
        if (t === null) continue;
        const s = elevationSampleAt(SEED, t.x, t.z);
        expect(t.groundH).toBe(s.h);
        expect(t.groundDx).toBe(s.dx);
        expect(t.groundDz).toBe(s.dz);
        checked++;
      }
    }
    expect(checked).toBe(12);
  });

  it("gives clutter the exact dx/dz of its own ground sample, in every class", () => {
    for (let cls = 0; cls < CLUTTER_CLASS_COUNT; cls++) {
      const [ox, oz] = CLUTTER_CENSUS[cls] as readonly [number, number, number, number];
      const list = clutterInRect(SEED, cls, ox, oz, ox + 200, oz + 200);
      expect(list.length).toBeGreaterThan(0);
      for (const c of list.slice(0, 8)) {
        const s = elevationSampleAt(SEED, c.x, c.z);
        expect(c.groundH).toBe(s.h);
        expect(c.groundDx).toBe(s.dx);
        expect(c.groundDz).toBe(s.dz);
      }
    }
  });

  it("gives clutterInCell the same fields the rect walker returns", () => {
    // CLUTTER_ROCK_CELL is 9 m; the cell index of an instance is therefore
    // floor(x / 9). No conditional guard here on purpose: a test that only
    // asserts when a lookup happens to land is a test that asserts nothing.
    const c = clutterInRect(SEED, CLUTTER_ROCK, -200, -3000, -100, -2900)[0];
    expect(c).toBeDefined();
    const cell = clutterInCell(SEED, CLUTTER_ROCK, Math.floor(c!.x / CLUTTER_ROCK_CELL), Math.floor(c!.z / CLUTTER_ROCK_CELL));
    expect(cell).not.toBeNull();
    expect(cell!.x).toBe(c!.x);
    expect(cell!.groundDx).toBe(c!.groundDx);
    expect(cell!.groundDz).toBe(c!.groundDz);
  });
});

describe("the scatter censuses are untouched", () => {
  it("keeps every tree field bit-identical", () => {
    const list = treesInRect(SEED, -200, -200, 200, 200);
    let h = 2166136261 | 0;
    for (const t of list) {
      for (const v of [t.x, t.z, t.groundH, t.species, t.scale, t.cohort, t.hash]) h = mix(h, v);
    }
    // Re-baselined 2026-09-08 from (1095, -2103669857): `landmarkMask` becomes
    // real — a carved clearing in this rect now zeroes trees
    // inside its disc, a deliberate content change (the four landmarks are
    // live), not a side effect.
    // Re-baselined 2026-09-09 from (1048, 1955083315): the builder now carves the
    // plateau edges (spine and forks) as well as the ascent chain, so the
    // ground under this rect moved where a trail crosses it and the trees that
    // sit on it moved with it. A deliberate elevation-field change.
    // Re-baselined 2026-09-09 from (1036, -164309270): a later fix
    // moved the graph itself -- the anti-overlap invariant, the hard slope
    // ceiling and the fork half-chord cap each reject candidates the builder
    // used to take, so spine nodes, fork endpoints and one carved landmark in
    // this rect all sit somewhere else. A deliberate elevation-field change,
    // for the same reason as the entry above.
    // Re-baselined 2026-09-09 from (1044, 547269171): the builder
    // stopped reading the wall's rim spline and instead
    // plans the ascent against a nominal hillside grade, ending it at a fixed
    // ASCENT_END_U -- the whole graph shifts, so the trees under it do too. A
    // deliberate elevation-field change, not a side effect.
    // Re-baselined 2026-09-09 from (1028, -623164624): the wall
    // stage was deleted; the trailhead pad is its own stage over the base terrain's own
    // hillside instead of a carved face, so the ground under this rect (and
    // the trees on it) moved again. A deliberate elevation-field change.
    // Re-baselined 2026-09-09 from (1023, 1462900230): the trail is now cut
    // as a bench — the bed sits TRAIL_BENCH_DEPTH below the chord and the
    // downhill fade shrank from a symmetric 3 m corridor to a TRAIL_LIP-wide
    // lip, so the carved ground under this rect (and two more trees that now
    // clear the lowered/narrowed corridor) moved. A deliberate change.
    // Re-baselined 2026-09-09 from (1025, 2012291737): the bench
    // cut's coverage (where the field blends into the bed) and grade (how
    // overlapping edges' chords mix) are now two separate weights, coverage
    // adaptive and grade back to the pre-bench-cut fixed radius. The tree
    // count is unchanged; only the carved ground's exact shape near
    // overlaps moved, so the hash moves. A deliberate elevation-field change.
    // Re-baselined 2026-09-09 from (1025, -1993371890): a new chord
    // predicate (every candidate edge — ascent leg, spine step, fork half —
    // is checked against the pre-trail ground along its chord, not just its
    // slope) rejects candidates the builder used to take without looking at
    // the ground between the endpoints, so the ascent (re-tuned to
    // ASCENT_LEG_DZ_MIN 90 / ASCENT_MAX_LEGS 8 to keep clearing it), the
    // spine and the forks all move — 17 more trees now clear the moved
    // corridors and beds under this rect. A deliberate elevation-field
    // change, not a side effect.
    // Re-baselined 2026-09-09 from (1042, 1417765926):
    // the fallback ranking became a true lexicographic (cap, then gap, then
    // chord) comparison rather than a weighted max, and ASCENT_LEG_DZ_MIN
    // moved again (100 -> 90) chasing the 219-seed walkability scan. Both
    // move the graph again, so the trees under this rect do too.
    // Re-baselined again 2026-09-09 from (1041, 299761177):
    // TRAIL_CLEAR 3 -> 6 (trees keep off the bench cut's bank, not
    // just its bed, which is what closed the root-plate daylight artefact
    // instead of widening groundedProps.test.ts's ceilings), the fork fan
    // widened to 9 rays / 20 m steps, and ASCENT_LEG_DZ_MIN swept to 113.
    // The first alone removes trees from this rect; the other two move the
    // graph they are measured against. All three deliberate.
    // Re-baselined 2026-09-09 from (1013, 1280149694): the apron
    // pulls the coast blend out to APRON_BLEND_END and
    // fades the cliff terraces off the ground inside the trail's z-window
    // (|z| < APRON_Z_HALF = 700); this rect (z ∈ [-200, 200]) sits well
    // inside it, so the ground under the trees — and which trees clear it —
    // moves. A deliberate elevation-field change, not a side effect.
    // Re-baselined 2026-09-09 from (953, -763478955): the
    // fan-and-chord builder was replaced with a Dijkstra
    // tree on the walkability grid, so the trail runs somewhere else entirely
    // inside this rect — its bed is the ground's own profile rather than an
    // eased chord over a bench cut, and the trees that clear its corridor
    // (TRAIL_CLEAR of every edge) move with it. A deliberate elevation-field
    // change, not a side effect.
    // Re-baselined 2026-09-09 from (947, 589664445), same day:
    // the apron had moved the HIGHWAY 32–50 m inland inside its own z-window
    // (roadOffsetD reads a fraction of the blend window), and putting the road
    // back on the headland/bay window moves the road, the trailhead, the graph
    // and every tree measured against them. A deliberate field change — the
    // road is where it was before the apron, which is where it belongs.
    // Re-baselined 2026-09-10 from (944, -320359444): TRAIL_CLEAR 6 -> 8 with
    // TRAIL_CORRIDOR_HALF 4 -> 7 (the bench's shoulder widened from a 3 m to
    // a 6 m blend, and the tree clearance follows the corridor), so the trees
    // within 6-8 m of every edge in this rect are gone. Deliberate.
    // Re-baselined 2026-09-11 from (924, -1988333636):
    // TRAILHEAD_U 44 -> 9 and BOWL_U_MIN 30 -> 8 move the pad 35 m toward the
    // road, and the pad's height (and the ground the builder routes from
    // inside the road corridor) is now the road's own grade rather than the
    // pre-road terrain's, so the trailhead, the graph and the ground near it
    // all move — 22 more trees now clear the moved bed/corridors in this
    // rect. A deliberate elevation-field change, not a side effect.
    // Re-baselined 2026-09-11 from (946, -3637490): the
    // fork-and-chord graph is replaced with a stem to a made peak — the
    // trail runs somewhere else entirely under this rect, and 32 more trees
    // now clear the moved bed/corridors. A deliberate elevation-field change.
    // Re-baselined 2026-09-11 from (978, -681137001):
    // TRAIL_MOVE_GRADE_MAX (trailGrid.ts) forbids a single grid move
    // steeper than 0.7 everywhere, not only near the peak, so the search finds
    // a different route past every steep flank in the whole region, including
    // near the pad; 19 fewer trees clear the moved bed/corridors in this rect.
    // A deliberate elevation-field change.
    // Re-baselined 2026-09-11 from (959, -1951915265):
    // the peak's radius 220 -> 300 and its rise 60-90 -> 50-80
    // (features.ts), so the dome's flank is gentle enough for the search to
    // plan under the fine check instead of being corrected against it, and
    // PEAK_LOWER_STEP 5 -> 10. The stem takes a different line on every seed
    // that touches the dome, and `routeTo`'s reroute now blames only the cells
    // under its own over-cap samples, so the routes it settles on differ near
    // every steep flank — including under this rect, where 18 more trees clear
    // the moved bed. A deliberate elevation-field change.
    // Re-baselined 2026-09-11 from (977, -1803508458):
    // loops actually build now (0 of 426 planned before, 131 after), so
    // PROBE_SEED carries a meadow or pond stage and two more
    // trail corridors that were simply absent from the field this census was
    // pinned against; 68 fewer trees clear the bed under this rect. A
    // deliberate elevation-field change.
    // Re-baselined 2026-09-11 from (909, 472705604): the
    // placement levers and the meadow's outer apron
    // move which feature PROBE_SEED gets and where it stands, so the ground the
    // trees stand on moves with it; 50 fewer clear the bed under this rect.
    // Re-baselined 2026-09-11 from (859, -480439138):
    // closing the meadow's own disc to the loop search moves which
    // route the loop under this rect takes, and three more trees clear the
    // moved bed. The LEVEL ID does not move (see `passHash` below): no
    // FEATURE_TUNABLES value changed here.
    // Re-baselined 2026-09-11 from (862, -190885617):
    // `forestDensity` now multiplies by the feature mask's `tree` factor, and
    // SEED (0x5eed1)'s own bowl carries a made feature whose disc reaches
    // into this rect (|x|, |z| < 200): the mask thins the canopy toward a
    // peak's treeline, or zeroes it on a meadow's flat / a pond's shore, so
    // fewer trees clear the gates. No tunable moved — `featureMask` reads
    // FEATURE_TUNABLES already declared earlier — so `passHash` below
    // is unchanged; this is a pure content change, not a level-id move.
    // Re-baselined 2026-09-11 from (733, -1206632833): a
    // later fix re-cuts the peak's tree mask — TREELINE_BELOW_CREST 35 ->
    // 15 and TREELINE_BAND 60 -> 35 so the ramp completes inside the dome,
    // times a PEAK_RIM_FADE radial fade so it meets the forest outside the
    // disc continuously instead of jumping the whole amplitude at the rim.
    // SEED's own bowl carries a feature whose disc reaches this rect, so the
    // canopy under it is thinned on a different curve and one more tree
    // clears the gates. A deliberate content change; the level id moves with
    // it (see `passHash` below) because the two treeline constants and the
    // new PEAK_RIM_FADE are all FEATURE_TUNABLES.
    // Re-baselined 2026-09-16 from (734, -1724507358): the braid's own
    // tunables now fold into the level id, and the strands and rungs they
    // add carve new trail bed under this rect, so three fewer trees clear
    // it. A deliberate elevation-field change.
    expect(list.length).toBe(731);
    expect(h | 0).toBe(1979230377);
  });

  it("keeps every clutter field bit-identical, class by class", () => {
    for (let cls = 0; cls < CLUTTER_CLASS_COUNT; cls++) {
      const [ox, oz, n, sum] = CLUTTER_CENSUS[cls] as readonly [number, number, number, number];
      const list = clutterInRect(SEED, cls, ox, oz, ox + 200, oz + 200);
      let h = 2166136261 | 0;
      for (const c of list) {
        for (const v of [c.cls, c.x, c.z, c.groundH, c.scale, c.variant, c.hash]) h = mix(h, v);
      }
      expect([cls, list.length]).toEqual([cls, n]);
      expect([cls, h | 0]).toEqual([cls, sum]);
    }
  });
});

describe("the level id does not move", () => {
  it("pins passHash so shared invite links keep working", () => {
    // passHash is probeDigest ^ registryDigest. Adding return fields to an
    // instance touches neither: probeDigest hashes the collider boxes a pass
    // EMITS, and registryDigest hashes declared tunables. If this number
    // changes, every invite link already shared for this world is dead, and
    // that must be a deliberate decision rather than a side effect.
    //
    // Re-baselined 2026-09-01 from -1794627320, deliberately: the beach-dune
    // field declared ten DUNE_* tunables, which is exactly the registryDigest
    // move this pin is built to catch. Dunes change the elevation field, so
    // peers on older builds MUST refuse rather than desync -- the dead invite
    // links are the price of that guarantee.
    //
    // Re-baselined again 2026-09-08 from 113699843: an earlier change
    // composed the bowl's wall, trailhead flat and ascent corridor
    // into the olympic field and spread BOWL_TUNABLES/TRAIL_TUNABLES into its
    // tunables record, moving registryDigest for the same reason as the
    // dune move above -- the elevation field itself changed inside the bowl.
    //
    // Re-baselined again 2026-09-08 from 1907515112: the landmark pass spread
    // LANDMARK_TUNABLES (now including the carve floors STAND_CARVED_DENSITY /
    // TALUS_CARVED_DENSITY) into the tunables record and added landmarkDomeD
    // as a real terrain stage after trailCorridorD -- again a deliberate
    // elevation-field and tunables-record move, not a side effect.
    //
    // Re-baselined again 2026-09-08 from -549201205: a fix added
    // LANDMARK_BOWL_MARGIN to LANDMARK_TUNABLES (keeps every landmark
    // footprint inside the inBowl gate), moving registryDigest again for the
    // same reason -- this seed's five-landmark census does not relocate far
    // enough to change the tree census count above, but the tunables record
    // itself changed.
    // Re-pinned 2026-09-09 from 1305688635: pass 8 (trailhead) registered and
    // PROBE_CHUNKS extended for it. (The `from` clause was missing from this
    // entry; recovered from git history 2026-09-09 so the chain reconstructs.)
    //
    // Re-pinned again 2026-09-09 from -774908124: this pass declared two new
    // trail tunables (ASCENT_DU_MIN, PLATEAU_PEAK_SLOPE_MAX) and made every
    // graph edge carve terrain rather than only the ascent chain. Both halves
    // of the digest move, and both deliberately -- peers on older builds MUST
    // refuse rather than desync on a different elevation field.
    //
    // Re-pinned again 2026-09-09 from -1215006612: the spine's sidestep search
    // declared SPINE_SIDESTEP, a third new trail tunable, and moves where some
    // spine nodes land -- registryDigest and probeDigest both again.
    //
    // Re-pinned again 2026-09-09 from 1027596279: a later fix
    // replaced PLATEAU_PEAK_SLOPE_MAX with TRAIL_HARD_SLOPE_MAX and declared
    // eleven more trail tunables (TRAIL_EDGE_GAP, TRAIL_JUNCTION_R,
    // ASCENT_DZ_TRIES, SPINE_STEP_MIN/HALVINGS/SIDE_SPAN, BOWL_MARGIN,
    // RIM_OVERSHOOT, LEG_RETRIES) plus seven landmark ones (FORK_FAN_RAYS/LEAN
    // replacing FORK_FAN_COS, LANDMARK_SCAN_STEP, FORK_BEND_JITTER,
    // STAND_TREE_MIN, CLEARING_TREE_MAX, CLEARING_H_MIN, TALUS_BOULDER_MIN),
    // all of which used to steer the graph as module-private constants. Both
    // halves of the digest move, and both deliberately: the carved field is
    // different, so peers on older builds MUST refuse rather than desync.
    //
    // Re-pinned 2026-09-09 from -357992711: an earlier change
    // retired RIM_OVERSHOOT and declared ASCENT_FACE_GRADIENT / ASCENT_END_U —
    // the ascent now plans against a nominal hillside and ends at a fixed u.
    //
    // Re-pinned again 2026-09-09 from -1075156344: the wall
    // stage was deleted, along with its eleven WALL_* tunables; the trailhead pad is its own
    // stage.
    //
    // Re-pinned again 2026-09-09 from 1474871486: three new
    // trail tunables were declared (TRAIL_BENCH_DEPTH, TRAIL_LIP, TRAIL_FADE_MORPH) and cut
    // the trail as a bench — the bed sits below the chord and the downhill
    // fade is a lip rather than a symmetric corridor. Both halves of the
    // digest move, and both deliberately: the carved field is different, so
    // peers on older builds MUST refuse rather than desync.
    //
    // Re-pinned again 2026-09-09 from 1636925843: the bed scan
    // found TRAIL_FADE_MORPH's adaptive radius contaminating the grade
    // mix between overlapping edges via the quotient rule (unbounded on real
    // terrain, not just the 219-seed sweep set). trailCorridorD now splits
    // coverage (adaptive) from grade (the pre-bench-cut fixed radius), and
    // TRAIL_FADE_MORPH reverts to 1 — registryDigest moves (the
    // tunable's own bits) and probeDigest moves (the carved field's exact
    // shape near overlaps), both deliberately.
    //
    // Re-pinned again 2026-09-09 from 1057972368: three new
    // trail tunables were declared (TRAIL_CHORD_STEP, TRAIL_FILL_MAX, TRAIL_CUT_MAX; 31 →
    // 34) for the chord fill/cut predicate every candidate edge is now held
    // to, and re-tuned ASCENT_LEG_DZ_MIN (120 → 90) / ASCENT_MAX_LEGS (6 → 8)
    // so the ascent keeps clearing it — registryDigest moves (the tunables'
    // own bits) and probeDigest moves (the whole graph shifts: shorter,
    // more numerous ascent legs, and spine/fork candidates that used to pass
    // on slope alone now also have to follow the ground), both deliberately.
    // Re-pinned again 2026-09-09 from 755696564: the
    // fallback ranking's `fallbackScore` became a true lexicographic (cap,
    // then gap, then chord) comparison, and ASCENT_LEG_DZ_MIN moved again
    // (100 -> 90) against the 219-seed walkability scan. Both halves of the
    // digest move (the retuned tunable's own bits, and the graph's shape),
    // deliberately.
    // Re-pinned again 2026-09-09 from -818273564: moves
    // THREE declared tunables — TRAIL_CLEAR 3 -> 6, FORK_FAN_RAYS 5 -> 9,
    // FAN_STEP 25 -> 20 — and ASCENT_LEG_DZ_MIN 90 -> 113, so registryDigest
    // moves on their own bits and probeDigest moves on the graph they build.
    // Deliberate: an invite link shared against an older build must refuse
    // rather than put two peers on different ground.
    //
    // Re-pinned again 2026-09-09 from 762122623: two new clutter tunables
    // were declared (CLUTTER_GRASS_TRAIL_NEAR/FAR) that
    // gate grass, meadow and flowers off the trail bed via trailDistance —
    // registryDigest moves on the tunables' own bits, and probeDigest moves
    // because the trailhead probe chunks ([-8, 0], [-8, -1]) held grass on
    // the bed before this gate existed. Both deliberately: an invite link
    // shared against an older build must refuse rather than put two peers on
    // different ground clutter.
    //
    // Re-pinned again 2026-09-09 from 1167896174: the apron
    // declares five new tunables in BOWL_TUNABLES
    // (APRON_Z_HALF, APRON_Z_FADE, APRON_BLEND_END, APRON_CLIFF_U,
    // APRON_CLIFF_FADE) — registryDigest moves on their own bits, and
    // probeDigest moves because the apron changes the ground (and hence the
    // clutter placed on it) near the trailhead. Deliberate: an invite link
    // shared against an older build must refuse rather than put two peers on
    // different ground.
    //
    // Re-pinned again 2026-09-09 from -404963193: forest.ts's PROBE_CHUNKS
    // (pass 8, trailhead) moved from [-8, 0]/[-8, -1] to [-7, 0]/[-7, -1] —
    // the apron's coastFrame change moves roadOffsetD's dr, hence the
    // trailhead's world x for PROBE_SEED too, so probeDigest's own probe
    // window had to follow it (see forest.ts's dated comment on
    // PROBE_CHUNKS). Same deliberate reasoning: an invite link shared
    // against an older build must refuse.
    //
    // Re-pinned again 2026-09-09 from 2117615609: the builder was
    // rewritten. registryDigest moves because
    // TRAIL_TUNABLES is a different set of 15 keys (the ascent, spine and fan
    // tunables are gone; TRAIL_GRID_CELL/CAP/SLOPE_COST/REUSE_FACTOR,
    // TRAIL_SIMPLIFY_TOL, TRAIL_PROFILE_STEP/SMOOTH and TRAIL_REROUTE_MAX are
    // in) and LANDMARK_TUNABLES swapped its four fan keys for the four
    // placement ones; probeDigest moves because the graph — and so the ground
    // and the scatter on it — is a Dijkstra tree on the walkability grid now.
    // Deliberate: an invite link shared against an older build must refuse
    // rather than put two peers on different ground.
    //
    // Re-pinned again 2026-09-09 from 870994930, same day: the
    // apron is no longer allowed to move the HIGHWAY (`coastFrame` hands the
    // road its own un-aproned blend window), so the road, the trailhead, the
    // graph and every scatter placed against them move — and `forest.ts`'s
    // PROBE_CHUNKS move back to [-8, 0]/[-8, -1] with the trailhead, which
    // (x=−248.63, z=0) is where it sat before the apron, bit for bit.
    // registryDigest does not move (no tunable changed); probeDigest does.
    // Deliberate.
    //
    // Re-pinned again 2026-09-10 from -1875708017:
    // the trailhead pass lays its props out in the DEPARTURE FRAME instead of
    // fixed world axes, so `passes/trailhead.ts` no longer declares
    // CAR_OFFSET_X = -3 (registryDigest moves on the tunable's own bits: it
    // is now 5, not -3 -- at -3's old magnitude of 3 the car's own half-extent
    // pushed its required clearance past what 3 m from the trailhead NODE can
    // ever give, so the value had to grow, not just flip sign) and every
    // prop's actual world position now depends on the graph's own departure
    // bearing rather than the world x/z axes (probeDigest moves: PROBE_SEED's
    // car/post/sign all land somewhere else). Deliberate: an invite link
    // shared against an older build must refuse rather than put two peers on
    // different ground.
    //
    // Re-pinned again 2026-09-10 from 1645024215:
    // `departureFrame` now bisects the WIDEST FREE WEDGE among
    // ALL edges incident to the trailhead, not just the lowest-index one
    // (now verified green over all 227 seeds). No
    // tunable value changed, so this is `registryDigest` holding and
    // `probeDigest` moving on the algorithm alone -- and it moves even for
    // PROBE_SEED, whose trailhead has only ONE incident edge (so `a` itself
    // is unchanged, still `-u`): this change also redefines `r` from
    // `(-u.z, u.x)` to `(-a.z, a.x)`, which is `a`'s own right-hand
    // perpendicular rather than `u`'s, and for a single-edge trailhead those
    // are exact negations of each other, so POST and SIGN (both have a
    // nonzero lateral offset.z) flip to the opposite side of the pad on
    // every one-edge world, PROBE_SEED included. Deliberate: an invite link
    // shared against an older build must refuse rather than put two peers on
    // different ground.
    //
    // Re-pinned 2026-09-10 from -1611929090: CLUTTER_FUNGUS_TRAIL_CLEAR (2.5)
    // joins CLUTTER_TUNABLES (registryDigest moves on the new key) and the
    // fungus class -- the mushroom cluster and the cut stump -- now rejects
    // its jittered instance within that distance of the trail (probeDigest
    // moves wherever PROBE_SEED had one on the bed). A stump was found
    // standing in the gravel. Deliberate: an invite link shared against an
    // older build must refuse rather than put two peers on different ground.
    //
    // Re-pinned 2026-09-10 from 1125479387: CLUTTER_FUNGUS_SLOPE_LO/HI join
    // CLUTTER_TUNABLES (registryDigest moves on the two new keys) and fungus
    // now closes over the trees' slope band (probeDigest moves wherever
    // PROBE_SEED had a stump or mushroom cluster on ground the forest itself
    // has given up). Trees and stumps were found growing out of a
    // cobblestone floor. Deliberate: an invite link shared against an older
    // build must refuse rather than put two peers on different ground.
    //
    // Re-pinned 2026-09-10 from 1359942156: TRAIL_CORRIDOR_HALF 4 -> 7,
    // TRAIL_EDGE_GAP 4 -> 2 and TRAIL_CLEAR 6 -> 8 (registryDigest moves on
    // three tunable values; probeDigest moves because every bench shoulder is
    // now a 6 m blend and the trees within 6-8 m of a bed are gone). The
    // shoulder was widened after its 3 m blend aliased into
    // stripes on the inner clipmap ring. Deliberate: an invite link shared
    // against an older build must refuse rather than put two peers on
    // different ground.
    //
    // Re-pinned 2026-09-11 from 897461981:
    // TRAILHEAD_U 44 -> 9, BOWL_U_MIN 30 -> 8, and CAR_ROAD_U/CAR_ROAD_Z
    // replace CAR_OFFSET_X/CAR_OFFSET_Z. registryDigest moves on the two
    // retuned bowl tunables and the pass 8 tunable-key swap; probeDigest
    // moves because the trailhead (and everything measured against it — the
    // graph, the ground under it, and every prop pass 8 emits) sits 35 m
    // closer to the road now, with the car parked in the road frame instead
    // of the departure frame. Deliberate: an invite link shared against an
    // older build must refuse rather than put two peers on different ground.
    //
    // Re-pinned 2026-09-11 from -765838276:
    // FORK_COUNT/OVERLOOK_*/CLEARING_* removed, FEATURE_TUNABLES folded in
    // (olympic.ts's own tunables record), LANDMARK_MIN_PATH ->
    // LANDMARK_SCENERY_MIN_PATH, and PEAK_LOWER_TRIES retuned 3 -> 20
    // (measured against the 227-seed sweep: the peak's own skirt needed up to
    // 14 tries, none over 15). registryDigest moves on all of that;
    // probeDigest moves because the graph is a completely different SHAPE
    // now — a stem climbing to one made peak instead of a fan to four
    // landmarks — so every tree, boulder and rock measured against it (and
    // the two scenery landmarks themselves, no longer routed to) moves too.
    // Folded into the same re-pin: CLUTTER_BOULDER_TRAIL_CLEAR (clutter.ts)
    // joins CLUTTER_TUNABLES — a boulder collider found standing in the last
    // stem edge before a crest (0.52 m off centreline, 0.57 m tall, over
    // STEP_HEIGHT) is now rejected within trailDistance 4, moving probeDigest
    // again for the same rect. Deliberate throughout: an invite link shared
    // against an older build must refuse rather than put two peers on
    // different ground.
    //
    // Re-pinned 2026-09-11 from 28538523:
    // `peakD` now holds a flat summit platform over PEAK_CREST_RADIUS instead
    // of a pointed apex (registryDigest does not move — PEAK_CREST_RADIUS's
    // VALUE is unchanged, only how it is used — but probeDigest does, because
    // the ground under and past the crest is shaped differently); an
    // earlier crest re-pin (SUMMIT_RAW_BLEND) that once shipped
    // to paper over the pointed apex is deleted along with it, and
    // PEAK_LOWER_TRIES reverts 20 -> 3 (registryDigest moves on its own bits).
    // Every tree, boulder and rock near a stem that used to retry or blend
    // moves again. Deliberate: an invite link shared against an older build
    // must refuse rather than put two peers on different ground.
    //
    // Re-pinned 2026-09-11 from 2036299419:
    // TRAIL_MOVE_GRADE_MAX (trailGrid.ts) joins TRAIL_GRID_TUNABLES —
    // registryDigest moves on the new key; a single grid move steeper than
    // 0.7 is forbidden everywhere in the region, not only near the peak, so
    // the search takes a different route past every steep flank the dome's
    // keep-passability rule left passable, moving probeDigest for every tree,
    // boulder and rock measured against the changed graph. Deliberate: an
    // invite link shared against an older build must refuse rather than put
    // two peers on different ground.
    //
    // Re-pinned 2026-09-11 from -1157604462:
    // registryDigest moves on three FEATURE_TUNABLES values —
    // PEAK_RADIUS_MIN/MAX 220 -> 300, PEAK_RISE_MIN/MAX 60/90 -> 50/80 and
    // PEAK_LOWER_STEP 5 -> 10 (no keys added or removed). probeDigest moves
    // because the peak is a wider, lower dome on every seed, and because the
    // stem routed to it takes a different line: the flank is now under the
    // routing grid's own cap, so the search no longer has to climb ground
    // its corridor union could not take, and `routeTo`'s reroute blames only
    // the cells under its own over-cap samples instead of every cell of every
    // new edge near the failure (which used to seal the crest and spend the
    // whole reroute budget on one attempt). Every tree, boulder and rock
    // measured against the changed graph and the changed dome moves with
    // them. Deliberate: an invite link shared against an older build must
    // refuse rather than put two peers on different ground.
    //
    // Re-pinned 2026-09-11 from 900062098: the loops.
    // registryDigest moves on one new key, PEAK_SHOULDER (FEATURE_TUNABLES 46
    // -> 47): a loop candidate's peak exclusion is now
    // PEAK_SHOULDER * peak.radius + its own radius rather than the full dome
    // radius. probeDigest does NOT move for this seed on its own
    // account — PROBE_SEED (0x0badf00d) plans 3 loops and builds 0 of them
    // (every candidate rejected),
    // so the tree/boulder/rock census this hash covers sits on exactly the
    // same ground as before — but registryDigest's move is enough by
    // itself to move the combined hash. Deliberate: an invite link shared
    // against an older build must refuse rather than put two peers on
    // different ground.
    //
    // Re-pinned 2026-09-11 from 2065749428:
    // registryDigest moves on three FEATURE_TUNABLES values —
    // MEADOW_SLOPE_MAX 0.12 -> 0.35, POND_SLOPE_MAX 0.08 -> 0.25, MEADOW_RIM
    // 25 -> 35 (no keys added or removed, still 47). The candidate filter
    // used to judge a loop feature's RAW, unlevelled disc; it now judges the
    // ground the feature's own stage is about to level, so the caps had to
    // widen to match (see MEADOW_SLOPE_MAX's own comment). probeDigest does
    // NOT move for this seed on its own account either — PROBE_SEED still
    // plans 3 loops and builds 0 (the overlap check's own shortfall, not
    // this fixture) — but the
    // registryDigest move alone is enough to move the combined hash.
    // Deliberate: an invite link shared against an older build must refuse
    // rather than put two peers on different ground.
    //
    // Re-pinned 2026-09-11 from -851457605:
    // registryDigest moves on one new key, LOOP_JOIN_REACH
    // (FEATURE_TUNABLES 47 -> 48): the overlap count's junction exemption
    // gets its own named tunable (30 m) instead of borrowing splitAt's
    // SPLIT_SNAP (14 m, sized for a different purpose and measured 4-12 m
    // short earlier). probeDigest does not move for this seed on its
    // own account — PROBE_SEED still plans 3 loops and builds 0 —
    // but the registryDigest move
    // alone is enough to move the combined hash. Deliberate: an invite link
    // shared against an older build must refuse rather than put two peers on
    // different ground.
    // Re-baselined 2026-09-11 from 1083717304:
    // moves one FEATURE_TUNABLES value, LOOP_LEN_MAX 500 -> 700 (still 48
    // keys, none added or removed). `probeDigest` moves too this time — unlike
    // every earlier re-pin, PROBE_SEED now BUILDS a loop, so the
    // feature stage and the loop's own corridors change the ground the tree,
    // boulder and rock scatter stands on.
    // Re-baselined 2026-09-11 from 1815109543:
    // `registryDigest` moves on these FEATURE_TUNABLES values changed
    // — FEATURE_SPACING 250 -> 180, LOOP_LATERAL_MAX 120 -> 200, the six
    // LOOP_BAND_* fractions (0.25/0.4, 0.45/0.6, 0.65/0.8 -> 0.20/0.50,
    // 0.35/0.70, 0.55/0.85), MEADOW_RADIUS_MIN/MAX 70/110 -> 50/90 — still 48
    // keys, none added or removed. `probeDigest` moves too: PROBE_SEED builds a
    // loop, and its feature and corridors both moved.
    //
    // Re-baselined 2026-09-11 from -764381044 — one re-pin
    // for a whole batch of changes, naming every constant that moves in it:
    //   * pass 8's tunables: POST_OFFSET_X/Z and SIGN_OFFSET_X/Z
    //     are gone and POST_ROAD_U/Z and SIGN_ROAD_U/Z replace them — the post
    //     and the sign left the departure frame for the ROAD frame beside the
    //     car, because "away from the trail" pointed at the highway once
    //     TRAILHEAD_U moved to 9 (38 of the first 40 sweep seeds stood a prop on
    //     the pavement). `probeDigest` moves with it: the props pass 8 emits
    //     into the probe chunks are somewhere else.
    //   * FEATURE_TUNABLES: TREELINE_BELOW_CREST 35 -> 15,
    //     TREELINE_BAND 60 -> 35 (sum 50 = PEAK_RISE_MIN, so the tree ramp
    //     completes inside every dome) and the new PEAK_RIM_FADE = 40 — 48 keys
    //     -> 49.
    //   * FEATURE_TUNABLES: the new PEAK_CENTRE_TRIES = 3 — the
    //     builder tries the highest reachable band cell and then the next two
    //     before a world gets no peak at all, and which centre a world's stem
    //     ends on is a different world, so the count is a tunable — 49 keys
    //     -> 50. `probeDigest` does not move for it: PROBE_SEED routes to its
    //     first centre and never falls back.
    //   * FEATURE_TUNABLES: LOOP_TRIES (24) and TREE_PENALTY (8)
    //     move out of `trailBuild.ts` into the table, and the candidate scan's
    //     bare `c += 2` becomes LOOP_SCAN_STRIDE (2) — three keys at their
    //     shipped values, so the WORLDS do not change, but the level id must
    //     fold them in before anyone pulls the "LOOP_TRIES 16" lever later — 50
    //     keys -> 53.
    // Re-baselined 2026-09-15 from 1594363661: the register's sign posts are
    // pass 9, a new registry entry with its own tunables, and the level-id
    // probe gained the chunk that holds a post. Both move this on purpose:
    // a peer without the posts has different collision at every fork.
    // Re-baselined 2026-09-16 from -1513056523: the trail bench narrowed
    // (TRAIL_BED_HALF 1 -> 0.75) and sank (the new TRAIL_SINK, TRAIL_SINK_RAMP
    // tunables), moving every trail's tread on purpose.
    // Re-baselined 2026-09-16 from -1283394394: the litter class (the id
    // moved through CLUTTER_TUNABLES, nine new constants) and the grass
    // gate's retune to the new bench edge (CLUTTER_GRASS_TRAIL_NEAR/FAR
    // 2/5 -> 0.75/2.5) both move this on purpose — every ground scatter near
    // a trail shifts.
    // Re-baselined 2026-09-16 from 49567251: the braid's own tunables
    // (BRAID_TOP_MAX and the rest) join FEATURE_TUNABLES and TRAIL_TUNABLES
    // in the level id, and the strands and rungs they add carry more trail
    // for the litter and grass gates to scatter along. Both move this on
    // purpose.
    // Re-baselined 2026-09-23 from 309897140: the ground-cover field's new
    // constants — the canopy floor, the patch floor, the interior boost, the
    // duff terms, the trail ramp's reach and its own salt, and the drift
    // noise's wavelength and salt — join CLUTTER_TUNABLES, so a peer without
    // them scatters grass differently at every canopy, trail and road edge.
    // Re-baselined 2026-09-24 from -1219139371: CLUTTER_LITTER_D 0.6 -> 0.9
    // is a CLUTTER_TUNABLES value, so a peer on the old density scatters
    // litter along every trail's margin differently.
    // Re-baselined again 2026-09-24 from -608564206: CLUTTER_GRASS_CANOPY_FLOOR
    // rose from 0.15 to 0.5, an existing CLUTTER_TUNABLES value, so a peer on
    // the old floor scatters grass differently under every closed canopy.
    // Re-baselined 2026-09-25 from -1330924340: the cliff modules' placement
    // moved into the simulation, and every constant that steers where a
    // module stands — CLIFF_CELL, CLIFF_JITTER, CLIFF_STAND_MARGIN,
    // CLIFF_ROCK_MIN, CLIFF_DENSITY, the scale band, the yaw jitter and its
    // tangent, CLIFF_SINK, CLIFF_LONG_NEIGHBOURS, the lean cap and its cosine
    // and sine, CLIFF_PROBE_SPAN, the run's spacing, length and reach, the
    // field's salt and draw index, and the two models' sizes — joins the
    // clutter pass's tunables as CLIFF_TUNABLES. probeDigest does not move
    // (no pass emits a cliff collider yet); registryDigest does. Deliberate:
    // a wall one peer sees and another does not is a different world, so an
    // old client cannot join a new host.
    // Re-baselined 2026-09-25 from -1705178804: the cliff modules became
    // solid. Both halves move. registryDigest: CLIFF_TUNABLES left the
    // clutter pass for the new pass 10, cliffs, which declares them with
    // CLIFF_BOX_STEP; the field's salt CLIFF_SALT moved 0xc11f -> 0xc1f0 (it
    // had duplicated the terrain's CLIFF_PHASE_SALT); and the draw slots
    // CLIFF_DRAW_DENSITY, CLIFF_DRAW_X and CLIFF_DRAW_Z joined
    // CLIFF_DRAW_RUN in the table. probeDigest: pass 10 emits a row of
    // collision boxes per module, and the probe gained chunk [-1, -15],
    // which holds three of them for PROBE_SEED. Deliberate: a peer without
    // the colliders walks through walls another peer stops at, so an old
    // client cannot join a new host.
    // Re-baselined 2026-09-25 from 149824213: each cliff box now bounds the
    // module's whole drawn solid, from the model's base up, not only the
    // part above the sink line — the lean drops the front of the base below
    // the sunk origin, into the open where the ground falls away. No
    // tunable moves, so registryDigest is unchanged; probeDigest moves,
    // because every box in probe chunk [-1, -15] starts lower.
    // Re-baselined 2026-09-25 from 1586641572: the cliff models' base sits a
    // little below their origin, and the colliders now bound the model from
    // there (CLIFF_MODEL_BASE_A = -0.42, CLIFF_MODEL_BASE_B = -0.16, new
    // CLIFF_TUNABLES keys, so registryDigest moves) to its true top rather
    // than from the origin to the full extent above it (so every cliff box
    // in probe chunk [-1, -15] moves, and probeDigest with it).
    expect(passHash()).toBe(466850785);
  });
});
