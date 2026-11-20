/**
 * Day Hike's mountain: the place this game lays over the engine's coast. A bowl inland of the
 * cove with the trailhead's pad at its door, the peak and the other made features, the lakes,
 * and the trail cut up through them, with what the rest of the world asks about the place: how
 * far the trail is, where trees and rocks are held off, where the lakes lie, where the forest
 * comes down to the road. Importing this file registers the coast with the mountain on it as
 * the terrain `olympic`; `passes/index.ts` imports it, and every thread that builds a world
 * imports that.
 *
 * Same contract as the coast's own stages: dx/dz are the exact analytic derivatives of h, and
 * the arithmetic is the simulation's (no trig, no Math.pow, no `**`, no hypot).
 */
import { COVE_Z, coastGround, registerOlympic, roadCenterX, roadCorridorOverD, roadFrameAt, roadGradeAt } from "./olympic.js";
import type { LakeSource, TerrainSample } from "./terrain.js";
import {
  BOWL_TUNABLES, BOWL_Z_HALF, TRAIL_Z_ANCHOR, TRAILHEAD_U,
  inBowl, padD, apronWindowD, apronKeepD, APRON_BLEND_END,
} from "./bowl.js";
import {
  TRAIL_TUNABLES, trailCorridorD, trailSinkD, trailDistance as graphTrailDistance,
  type TrailGraph,
} from "./trail.js";
import { TRAIL_GRID_TUNABLES } from "./trailGrid.js";
import { buildTrail } from "./trailBuild.js";
import {
  LANDMARK_TUNABLES, landmarkMaskAt, type Landmark, type LandmarkMask,
} from "./landmarks.js";
import { FEATURE_TUNABLES, featureStageD, lakeStageD, featureMaskAt, type Feature } from "./features.js";
import { BRAID_TUNABLES, type Braid } from "./trailBraid.js";
import { forestDensityUnmasked } from "./vegetation.js";
import { boulderDensityUnmasked, CLUTTER_BOULDER_SLOPE_LO } from "./clutter.js";
import { STRIP_FOREST_FLOOR, STRIP_LIFT, shoreStrip } from "./shoreStrip.js";

if (TRAIL_Z_ANCHOR !== COVE_Z) throw new Error("the trail is anchored where the cove lies");

/** The pad sits on the road's shoulder: its height is
 * the road grade at the anchor, which corridorD already imposes there. */
function padHeightFor(seed: number): number {
  return roadGradeAt(seed, TRAIL_Z_ANCHOR).h;
}

/**
 * The field the graph builder and landmark placement sample for heights:
 * the coast's ground (`coastGround`) → trailhead pad → road corridor. The road corridor
 * joins this field so the builder's own field matches
 * the composed one inside |u| < ROAD_CORRIDOR_HALF — the pad sits on the
 * road's shoulder now, so the ground the builder routes from must already be
 * cut to the road grade there. No trail, no landmarks — it must not read
 * the graph.
 */
export function olympicPreTrailSample(seed: number, x: number, z: number): TerrainSample {
  const { u, uDz, ground } = coastGround(seed, x, z);
  const padded = inBowl(u, z) ? padD(u, uDz, z, padHeightFor(seed), ground) : ground;
  return roadCorridorOverD(seed, z, u, uDz, padded);
}

/** Everything the bowl owns for one seed: the trail graph, its made features
 * (the peak, and the loop features) and its two scenery
 * landmarks — found where the seed's terrain provides, carved where it does
 * not. All three come out of one build (`buildTrail`): the landmarks are
 * chosen among the cells the trail can actually reach, so there is no second
 * pass to place them. */
export type Bowl = { graph: TrailGraph; landmarks: Landmark[]; features: Feature[]; braid: Braid };
const BOWL_CACHE = new Map<number, Bowl>();
export function bowlFor(seed: number): Bowl {
  let b = BOWL_CACHE.get(seed);
  if (b === undefined) {
    // Placement reads UNMASKED densities over the pre-trail field: the mask is
    // derived from these placements, so reading it here would be circular.
    b = buildTrail(seed, {
      roadCenterX: (z) => roadCenterX(seed, z),
      sample: (x, z) => olympicPreTrailSample(seed, x, z),
      treeDensity: (x, z) => forestDensityUnmasked(seed, x, z, olympicPreTrailSample(seed, x, z)),
      boulderDensity: (x, z) => boulderDensityUnmasked(seed, x, z, olympicPreTrailSample(seed, x, z)),
      boulderSlopeMin: CLUTTER_BOULDER_SLOPE_LO,
    });
    BOWL_CACHE.set(seed, b);
  }
  return b;
}

/**
 * Takes a bowl `bowlFor(seed)` made in another thread of the same build (a
 * worker's, cloned across) as this thread's, so the trail is not built twice.
 * False, and the bowl dropped, where the seed already has one: its graph and
 * features may already be in other hands, and two bowls of one seed, equal as
 * they are, are two objects.
 */
export function installBowl(seed: number, bowl: Bowl): boolean {
  if (BOWL_CACHE.has(seed)) return false;
  BOWL_CACHE.set(seed, bowl);
  return true;
}

/**
 * Distance to the nearest trail edge, or `Infinity` outside the bowl.
 *
 * `treeInCell` calls this for every surviving tree ANYWHERE in the world, and
 * without the gate each call loops the graph's edges and builds the bowl for
 * the seed. Every node of the graph is a walkability-grid cell centre, which is
 * at least half a cell (4 m) inside the region's box, and every landmark is
 * LANDMARK_BOWL_MARGIN (50 m) inside it — so a query outside `inBowl` is more
 * than 4 m from every edge, and every consumer of this hook is a threshold test
 * at 6 m or less. Cheapest test first: the z band costs two compares, the road
 * frame costs a coast lookup.
 */
function trailDistanceHook(seed: number, x: number, z: number): number {
  if (Math.abs(z - TRAIL_Z_ANCHOR) > BOWL_Z_HALF) return Infinity;
  const { u } = roadFrameAt(seed, x, z);
  if (!inBowl(u, z)) return Infinity;
  return graphTrailDistance(bowlFor(seed).graph, x, z);
}
function trailGraphHook(seed: number): TrailGraph {
  return bowlFor(seed).graph;
}
function landmarkMaskHook(seed: number, x: number, z: number): LandmarkMask {
  return landmarkMaskAt(bowlFor(seed).landmarks, x, z);
}

/** One lake per pond feature, as the world's water bodies list them after the sea. */
function lakesOf(seed: number): LakeSource[] {
  const list: LakeSource[] = [];
  for (const f of bowlFor(seed).features) {
    if (f.kind !== "pond" || f.shape === undefined) continue;
    list.push({
      kind: "lake", level: f.height, x: f.x, z: f.z, murk: f.murk ?? 0.5, lobe: f.lobe ?? null,
      shape: f.shape, bound: f.shape.bound,
    });
  }
  return list;
}

/** The mountain's ground over the coast's: the pad, the made features, the lakes, then the trail's bench and its sink. */
function mountainD(seed: number, x: number, z: number, u: number, uDz: number, coved: TerrainSample): TerrainSample {
  let staged = coved;
  if (inBowl(u, z)) {
    // The trailhead pad — bit-identity outside its own small window.
    // Cheaply gated by `inBowl` like every bowl
    // stage: the pad's own disc + fade never reaches the bowl's edge.
    staged = padD(u, uDz, z, padHeightFor(seed), coved);
  }
  // The made features: applied for EVERY point,
  // not only inside `inBowl` — the peak's 300 m dome is centred up to
  // BOWL_U_MAX − TRAIL_GRID_CELL in and can reach past u = 1000, and a
  // straight cut at the bowl's own edge would slice through its skirt.
  // `featureStageD` is its own cheap gate (one distance test per feature,
  // `base` back unchanged outside every disc), and `bowlFor` is memoised per
  // seed, so this costs one map lookup plus a few compares everywhere else in
  // the world.
  const bowl = bowlFor(seed);
  staged = featureStageD(bowl.features, x, z, staged);
  staged = lakeStageD(seed, bowl.features, x, z, staged);
  if (inBowl(u, z)) {
    // The trail corridor over every edge: every edge's own grid cell lies
    // inside the bowl, so its corridor never needs to reach past this gate.
    staged = trailCorridorD(bowl.graph.nodes, bowl.graph.edges, x, z, staged);
    staged = trailSinkD(bowl.graph.nodes, bowl.graph.edges, x, z, staged);
  }
  return staged;
}

registerOlympic({
  tunables: {
    ...BOWL_TUNABLES,
    ...TRAIL_TUNABLES,
    ...TRAIL_GRID_TUNABLES,
    ...LANDMARK_TUNABLES,
    ...FEATURE_TUNABLES,
    ...BRAID_TUNABLES,
  },
  blend: { end: APRON_BLEND_END, windowD: apronWindowD },
  cliffKeepD: apronKeepD,
  shapeD: mountainD,
  lakes: lakesOf,
  trailDistance: trailDistanceHook,
  trailGraph: trailGraphHook,
  sceneryLandmarks: (seed) => bowlFor(seed).landmarks,
  landmarkMask: landmarkMaskHook,
  featureMask: (seed, x, z, h) => featureMaskAt(bowlFor(seed).features, x, z, h),
  prepare: bowlFor,
  install: (seed, prepared) => installBowl(seed, prepared as Bowl),
  isPrepared: (seed) => BOWL_CACHE.has(seed),
  shoreStrip: { lift: STRIP_LIFT, forestFloor: STRIP_FOREST_FLOOR, at: shoreStrip },
  clearing: { z: TRAIL_Z_ANCHOR, x: (seed) => roadCenterX(seed, TRAIL_Z_ANCHOR) + TRAILHEAD_U },
});
