/**
 * The Babylon shell for ambient wildlife. Owns the
 * memoized collector, one `UnitState` per unit in the disc, the creature-pool
 * slots for every ground member, and the bird thin instances. Pure
 * decisions live in wildlifeField.ts / wildlifeBehaviour.ts; this file only
 * moves nodes. Rebuilds the unit set every WILDLIFE_REBUILD_STEP metres of
 * travel — the clutter cadence — and steps every unit every frame the tick
 * advances.
 *
 * Renderer-only by design: nothing here may migrate into sim/ (the
 * wildlifeField.ts rule). Wildlife is cosmetic and must not move the level id.
 */
// Side-effect import, and it is load-bearing: `thinInstanceSetBuffer` and
// `thinInstanceCount` are prototype extensions Babylon only installs when this
// module is pulled in — the same note `clutterMeshes.ts` carries.
import "@babylonjs/core/Meshes/thinInstanceMesh.js";
import type { Scene } from "@babylonjs/core/scene.js";
import type { Node } from "@babylonjs/core/node.js";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import type { Material } from "@babylonjs/core/Materials/material.js";
import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import type { AssetContainer } from "@babylonjs/core/assetContainer.js";
import { loadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader.js";
import { registerBuiltInLoaders } from "@babylonjs/loaders/dynamic.js";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import catalog from "../../assets/catalog.json" with { type: "json" };
import { hash3 } from "../sim/field.js";
import { elevationAt, elevationSampleAt } from "../sim/terrain.js";
import { SIM_TICK_HZ, TICK_DT } from "../sim/constants.js";
import type { WeatherParams } from "./weather.js";
import { modelUrl } from "./assetUrls.js";
import { seatOnGround } from "./groundTilt.js";
import { fadeWeight } from "./distanceFadePlugin.js";
import { attachWing, WING_TIME_WRAP } from "./wingPlugin.js";
import {
  createWildlifeCollector, DIRECTOR_POOL, FIRST_BIRD_SPECIES, SPECIES_BUTTERFLY, SPECIES_COUNT, SPECIES_DEER,
  SPECIES_ELK, SPECIES_RAVEN_PAIR, SPECIES_RAVEN_ROOST, WILDLIFE_RADIUS, type WildlifeUnit,
} from "./wildlifeField.js";
import {
  createUnitState, PHASE_REST, startCue, stepUnit, wildlifePresenceUnder,
  type PlayerPoint, type UnitState, type WildlifeEvent,
} from "./wildlifeBehaviour.js";
import { createCreaturePool, type CreatureInstance, type CreaturePool } from "./creatureModel.js";
import {
  createDirectorState, DIRECTOR_ID_BASE, onScreen, PLACE_BODY_H, step as stepDirector,
  type Candidate, type CueEvent, type Ground, type MatchState, type View,
} from "./wildlifeDirector.js";

/**
 * Catalog ids per species; null for the four bird species, which render as
 * thin instances rather than pooled containers. Indexed by species;
 * wildlifeMeshes.test.ts holds it to SPECIES_COUNT entries, so a species added
 * to wildlifeField.ts without an entry here fails a test rather than silently
 * rendering nothing.
 */
export const SPECIES_ASSET: readonly (string | null)[] = [
  "wildlife.elk", "wildlife.deer", "wildlife.rabbit", "wildlife.squirrel", null, null, null, null, null,
];
/**
 * The FLYING model each bird species renders as, indexed by species; null for
 * the four ground species, which are pooled containers rather than thin
 * instances. A roost and a pair are both ravens on the wing and share one
 * bucket — the bucket is the MODEL, not the species, so two species that fly
 * the same model share its geometry, its material and its wing plugin.
 *
 * The butterfly's own entry is the one asset id in this table with no catalog
 * output behind it at all: `loadBirdAssets` recognises it and builds
 * `butterflyGeometry` in code instead of fetching a GLB — see there.
 *
 * Held to SPECIES_COUNT entries by a test, like `SPECIES_ASSET`.
 */
export const BIRD_ASSET: readonly (string | null)[] = [
  null, null, null, null, "wildlife.raven", "wildlife.raven", "wildlife.gull", "wildlife.eagle", "wildlife.butterfly",
];
/**
 * The one bucket that is not a flight pose: a roost in PHASE_REST is sitting on
 * its snag, and a beating-winged raven card held still there reads as a bird
 * frozen mid-flap. Its members move to `BIRD_ASSET[SPECIES_RAVEN_ROOST]` the
 * moment the roost lifts.
 */
export const BIRD_PERCHED_ASSET = "wildlife.crow_perched";

// Wing-beat rates. Every ω is an exact 2π·n / WING_TIME_WRAP so the shader's
// time wrap is phase-continuous — wingPlugin.ts's rule, inherited from wind.
const RAVEN_WING_OMEGA = (2 * Math.PI * 900) / WING_TIME_WRAP; // 3 Hz
const GULL_WING_OMEGA = (2 * Math.PI * 750) / WING_TIME_WRAP;  // 2.5 Hz
/**
 * The butterfly's wing rate (rad/s), exported rather than kept as a private local like the
 * two above — `wildlifeMeshes.test.ts` checks the wing plugin receives exactly this value.
 * 12 Hz: a butterfly's wings beat far faster than any bird's, which is most of what makes
 * the card read as a different kind of motion at a glance, before its small size even
 * registers.
 */
export const BUTTERFLY_OMEGA = (2 * Math.PI * 3600) / WING_TIME_WRAP; // 12 Hz
/**
 * Wing-beat rate per species (rad/s). Eagles are zero: an eagle at 120–250 m
 * soars, and `poseBirds` gives it amp 0 as well, so both halves of the product
 * agree that it never flaps.
 */
export const BIRD_OMEGA: readonly number[] = [
  0, 0, 0, 0, RAVEN_WING_OMEGA, RAVEN_WING_OMEGA, GULL_WING_OMEGA, 0, BUTTERFLY_OMEGA,
];

/**
 * The ω a bucket's material takes, resolved from the asset id rather than the
 * species, because a bucket can serve two species (both ravens) and a material
 * carries exactly one plugin. The perched bucket matches nothing here and takes
 * 0 — it is only ever drawn with amp 0.
 */
export function birdBucketOmega(assetId: string): number {
  for (let s = FIRST_BIRD_SPECIES; s < BIRD_ASSET.length; s++) {
    if (BIRD_ASSET[s] === assetId) return BIRD_OMEGA[s] ?? 0;
  }
  return 0;
}

/**
 * The three looks a butterfly can wear — a warm monarch orange, a cool morpho blue, a pale
 * cabbage white — chosen to read as distinct creatures rather than one animal under three
 * lighting accidents. Each is a whole-animal TINT, multiplied over the wing pattern
 * `butterflyGeometry` bakes into the vertex colours; the two together are what reaches the
 * screen. Which one an individual wears is drawn per instance from its own unit id (see
 * `SALT_BUTTERFLY_COLOURWAY`), so a meadow shows all three at once out of one bucket.
 */
export const BUTTERFLY_COLOURWAYS: readonly (readonly [number, number, number])[] = [
  [0.82, 0.42, 0.05],
  [0.12, 0.32, 0.62],
  [0.86, 0.83, 0.72],
];
/** The colourway at `i`, wrapping (negatives included) — a caller drawing one need not know
 * how many there are. */
export function butterflyColourway(i: number): readonly [number, number, number] {
  const n = BUTTERFLY_COLOURWAYS.length;
  return BUTTERFLY_COLOURWAYS[((Math.trunc(i) % n) + n) % n]!;
}
/** Half the body's width (m) — the gap the two wings hinge across, so the body itself is
 * this doubled: 1 cm. */
export const BUTTERFLY_BODY_HALF = 0.005;
/** Wing span (m), body to tip — the "4 cm" of the two 4 cm quads. */
export const BUTTERFLY_WING_SPAN = 0.04;
/** Wing chord (m), front to back. */
export const BUTTERFLY_WING_CHORD = 0.03;
/**
 * The wing PATTERN, as a brightness per vertex in the order each wing's four are built:
 * hinge-front, tip-front, tip-back, hinge-back. Two gradients at once — dark at the hinge
 * running bright to the tip, and the trailing half a shade under the leading half — which
 * across a four-vertex quad is as much marking as eight vertices can carry, and is the
 * shape a real forewing has. It is deliberately COLOURLESS: the hue arrives per instance
 * from `BUTTERFLY_COLOURWAYS`, and a pattern that carried its own would multiply the two
 * and tint the tips twice.
 */
const BUTTERFLY_PATTERN: readonly number[] = [0.45, 1, 0.75, 0.34];

/**
 * The butterfly's geometry, built in code rather than loaded from a file — the design's
 * cheapest small cue there is: two 4 cm quads, one per wing, hinged on the 1 cm gap
 * between them where the body sits (drawn by nothing — at the range the butterfly is ever
 * noticed at, an unmodelled centimetre is not a gap a player could name). Eight vertices in
 * all, no ninth for a body.
 *
 * Flat in the XZ plane, wings running out along ±X from the hinge: `wingPlugin.ts` rotates
 * a vertex about that same axis by `|x| / halfSpan`, so this is exactly the shape a bird's
 * wing card already takes, just two of them meeting at the body instead of one continuous
 * span — the one thing the bird card path gains for this species is which geometry sits
 * inside it, not a second kind of hinge.
 *
 * ONE geometry serves every butterfly in the world, because they all ride one thin-instance
 * bucket. That is why it takes no colourway: a colour baked in here would be the colour of
 * every butterfly there is. It carries the pattern, which is the same on all of them, and
 * the colourway rides the per-instance buffer instead (`bucket.tint`).
 *
 * No UVs: nothing samples a texture on this material, and an unread buffer is still a
 * buffer uploaded per bucket.
 */
export function butterflyGeometry(): {
  positions: Float32Array; normals: Float32Array; colors: Float32Array; indices: Uint16Array;
} {
  const innerR = BUTTERFLY_BODY_HALF;
  const outerR = BUTTERFLY_BODY_HALF + BUTTERFLY_WING_SPAN;
  const halfChord = BUTTERFLY_WING_CHORD / 2;
  // Right wing (+x), then left (-x, mirrored) — 4 vertices each, 8 in all: hinge-front,
  // tip-front, tip-back, hinge-back, wound so both wings' front faces point +Y.
  const positions = new Float32Array([
    innerR, 0, halfChord, outerR, 0, halfChord, outerR, 0, -halfChord, innerR, 0, -halfChord,
    -innerR, 0, halfChord, -outerR, 0, halfChord, -outerR, 0, -halfChord, -innerR, 0, -halfChord,
  ]);
  const normals = new Float32Array(8 * 3);
  for (let i = 0; i < 8; i++) normals[i * 3 + 1] = 1; // a flat card, facing up
  const colors = new Float32Array(8 * 4);
  for (let i = 0; i < 8; i++) {
    const shade = BUTTERFLY_PATTERN[i % 4]!; // the two wings wear the same pattern, mirrored
    colors[i * 4] = shade; colors[i * 4 + 1] = shade; colors[i * 4 + 2] = shade; colors[i * 4 + 3] = 1;
  }
  // The left wing's winding is mirrored to match — moot once the material draws both faces
  // (see `buildButterflyMesh`), but a consistent +Y-facing normal on both wings is one less
  // thing to wonder about later.
  const indices = new Uint16Array([0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6]);
  return { positions, normals, colors, indices };
}

/**
 * The mesh `loadBirdAssets` adopts for `BIRD_ASSET[SPECIES_BUTTERFLY]` — white albedo over
 * vertex colour (`terrainMaterialFor`'s convention in renderer.ts: PBR multiplies the two,
 * so tinting the material as well would apply the pattern twice), two-sided because a flat
 * card is seen from both sides as it wanders, and never a shadow caster for the same reason
 * no other clutter-scale card is (see `adoptBirdBucket`'s own note on birds).
 *
 * The material is created HERE rather than coming out of a loaded container, which makes
 * this bucket the one whose material nothing else owns — `dispose` has to free it by hand
 * (see `ownedMaterials`).
 */
function buildButterflyMesh(scene: Scene): Mesh {
  const mesh = new Mesh("wildlife_butterfly", scene);
  const geo = butterflyGeometry();
  const data = new VertexData();
  data.positions = geo.positions;
  data.normals = geo.normals;
  data.colors = geo.colors;
  data.indices = geo.indices;
  data.applyToMesh(mesh, false);
  mesh.useVertexColors = true;
  const material = new PBRMaterial("wildlife_butterfly_mat", scene);
  material.albedoColor = new Color3(1, 1, 1);
  material.metallic = 0;
  material.roughness = 1;
  material.backFaceCulling = false;
  mesh.material = material;
  return mesh;
}

/** Instances a bird bucket's first real allocation covers, then doubling —
 * `clutterMeshes.ts`'s BUCKET_MIN_INSTANCES, at the same size. A 400 m disc
 * holds tens of birds per bucket, so this is usually the only allocation. */
const BIRD_MIN_INSTANCES = 64;
/** Shared zero-length placeholder for a bucket that has never held an instance. */
const EMPTY_BUFFER = new Float32Array(0);
/** Salt for the per-instance wing phase draw; local to this file's hash3 use. */
const SALT_WING_PHASE = 41;
/** Salt for the per-instance colourway draw. Kept clear of `SALT_WING_PHASE` so an
 * individual's colour and the beat of its wings are independent — one hash driving both
 * would tie every orange butterfly to the same point in its flap. */
const SALT_BUTTERFLY_COLOURWAY = 43;

/**
 * One bird model's thin-instance bucket: EVERY geometry-bearing mesh of its
 * LOD0, the matrix buffer and the `wing` (phase, amp) buffer the plugin reads,
 * both reused across frames and grown by doubling — never per-frame
 * allocation, the clutter contract.
 *
 * `meshes` is a list for the reason `clutterMeshes.ts`'s `Bucket` is: the
 * shipped model's primitives are merged BY MATERIAL, so a bird authored with
 * a second material — a beak, an eye, a separate feather sheet — arrives as two
 * primitives under one LOD0 root. Adopting only the first would drop half the
 * bird silently. All of them share one matrix buffer and one
 * `wing` buffer, because they are one bird.
 */
type BirdBucket = {
  meshes: Mesh[];
  /** Matrix data; capacity is `matrices.length / 16`. */
  matrices: Float32Array;
  /** Per-instance (phase, amp) pairs, stride 2, in lockstep with `matrices`. */
  wing: Float32Array;
  /**
   * Per-instance RGBA albedo tint, stride 4, in lockstep with `matrices` — or null for a
   * bucket whose model needs none, which is every bird: a raven is the colour its GLB
   * says it is and one buffer per bucket is not free.
   *
   * Only the butterfly carries one, and it is what makes its three colourways reachable at
   * all: the geometry is shared by every instance, so a colour baked into the vertices
   * would be the colour of every butterfly in the world. Uploaded under Babylon's own
   * `color` thin-instance kind, which becomes the `instanceColor` attribute and multiplies
   * the vertex colour the pattern is in — so pattern × colourway is what lands on screen,
   * with no plugin of ours in the path.
   *
   * The ALPHA must stay 1, and that is load-bearing rather than tidy. Declaring this
   * attribute is what turns on PBR's `INSTANCESCOLOR`, and under that define the fragment
   * stage starts reading `vColor.a` into the surface alpha — a channel this material never
   * consulted before the tint existed. Both alphas are exactly 1 (the pattern's and this
   * one's), so the product is 1 and nothing changes; a colourway given a fractional alpha
   * would quietly turn every butterfly wearing it translucent.
   */
  tint: Float32Array | null;
  /** Instances this frame — counted in pass 1, reused as the write cursor in pass 2. */
  count: number;
  /** Set when the buffers were replaced this frame, so the GPU buffers need a
   * fresh `thinInstanceSetBuffer` rather than an in-place upload. */
  grown: boolean;
};

/** Metres of travel between unit-set rebuilds. */
export const WILDLIFE_REBUILD_STEP = 8;
/** Width of the fade band at the outer edge of every species' disc (m): 130–150 of 150. */
export const WILDLIFE_FADE_BAND = 20;
/** Feet sit this far above the analytic ground so a flat-footed rig never z-fights the terrain. */
export const FOOT_LIFT = 0.02;
/** Seconds the ground presence takes to traverse a weather change. */
export const PRESENCE_RAMP_SECONDS = 3;
/**
 * Pool keys are `unit.id · SLOT_STRIDE + member`, the encoding creatureModel.ts
 * documents. Every species' member count is below the stride (the largest is
 * elk's 8, WILDLIFE_MEMBERS) and `unit.id` is unique per (species, cell) since
 * it became a packed int, so two units can never collide on a key.
 */
export const SLOT_STRIDE = 16;
/**
 * Stride between one species' director-pool ids and the next, above
 * `DIRECTOR_ID_BASE`: `id = DIRECTOR_ID_BASE + species * DIRECTOR_POOL_STRIDE + slot`.
 * Comfortably above the largest `DIRECTOR_POOL` entry (3), the same margin
 * `SLOT_STRIDE` keeps over the largest member count, so no species' pool
 * slots ever reach into the next species' ids. Purely a namespace offset —
 * kept apart from the field's own ids so the two can never collide on one
 * `states` map key — and never read back as a test of ownership: see
 * `poolIds` and `DIRECTOR_ID_BASE`'s own doc in wildlifeDirector.ts.
 */
const DIRECTOR_POOL_STRIDE = 16;
/**
 * An undrained `events` backlog is dropped at this length rather than grown
 * without bound. `events` is cleared by its consumer (the audio shell),
 * never here — see `update` — so a build with no consumer wired would otherwise
 * accumulate one call event per roost per half-minute for the length of a
 * session. Far above any single frame's output, so a live consumer never sees it.
 */
const EVENT_BACKLOG_CAP = 4096;
/** As `EVENT_BACKLOG_CAP`, for `directorRemovals` — a test seam nothing in production ever
 * drains, so it is dropped at this length rather than grown without bound across a session
 * no test happens to be watching it in. */
const DIRECTOR_REMOVAL_BACKLOG_CAP = 4096;

/**
 * The shadow registry, satisfied by `lighting.addShadowMesh` /
 * `removeShadowMesh`. Both halves are required: a pooled creature's meshes
 * outlive neither the animal nor the shell, and this Babylon build's
 * `AbstractMesh.dispose` does not take itself out of a shadow generator's
 * render list, so an add with no matching remove leaks every animal that ever
 * left the disc into the shadow map.
 */
export type WildlifeShadows = { add(mesh: AbstractMesh): void; remove(mesh: AbstractMesh): void };
export type WildlifeMeshesOptions = {
  radiusScale?: number;
  pool?: CreaturePool;
  shadows?: WildlifeShadows;
  /**
   * NullEngine escape hatch, the `clutterMeshes.ts` `assets` idiom: bird bucket
   * meshes keyed by catalog id (`BIRD_ASSET`'s entries plus
   * `BIRD_PERCHED_ASSET`) in place of the shipped GLBs. Adopted synchronously, so
   * a test can assert on the first update's buffers. A list stands in for a
   * model whose LOD0 carries more than one primitive — what merge-by-material
   * leaves behind — which is the seam the multi-mesh bucket
   * is tested through. Meshes passed in belong to the caller and are not
   * disposed here.
   */
  birds?: Record<string, Mesh | Mesh[]>;
};
export type WildlifeMeshes = {
  update(
    camX: number,
    camZ: number,
    tick: number,
    players: readonly PlayerPoint[],
    weather: WeatherParams,
    hour: number,
    /**
     * The wildlife director's view of this frame, when the caller has one:
     * the camera it judges visibility against and the match state it goes
     * quiet under. Omitted — every test that does not pass it, and any world
     * with no camera to speak of — the director never runs at all: no cue is
     * ever staged and no pool unit is ever created. See wildlifeDirector.ts.
     */
    director?: { view: View; match: MatchState },
  ): void;
  /**
   * Calls, lifts and flee starts, appended as they happen and never cleared
   * here: the consumer (the audio shell) drains the array when it has read
   * it, and may do so whenever it likes. Nothing in this file reads it across a
   * frame boundary — `update` takes the disturbances it feeds back to
   * `stepUnit` out of the events IT appended, before returning.
   */
  readonly events: WildlifeEvent[];
  /**
   * The director's own sighting log, read straight off its `DirectorState`:
   * `(tick, species)` pairs in the order they were recorded, oldest first, up
   * to the ring's own capacity (see wildlifeDirector.ts's `createDirectorState`)
   * — a test seam, and empty for as long as `update` has never been given a
   * seventh argument.
   */
  directorLog(): readonly number[];
  /**
   * How many units the director currently has out of its pool — a test seam
   * for "no pool unit was ever created" that does not lean on the shape of
   * an id, since ownership is no longer something an id encodes at all.
   */
  poolCount(): number;
  /**
   * A copy of every id the director has asked to be given back since the
   * last drain, in request order — appended before `applyDirectorEvent`
   * decides whether to honour it, so this is what the director REQUESTED,
   * not what the shell actually did. A test seam for exactly the failure
   * `owned` exists to prevent: with `Candidate.owned` set wrong, this fills
   * with real, natural ids the director wrongly believes are its own to
   * recycle, even on a build whose own remove-guard quietly absorbs the
   * resulting bad requests and would otherwise look, from
   * `poolCount`/`acquired` alone, like nothing went wrong. Capped the same
   * way `events` is (see `DIRECTOR_REMOVAL_BACKLOG_CAP`) — nothing drains
   * this in production, so a session with no test ever reading it must not
   * grow it without bound either.
   */
  directorRemovals(): readonly number[];
  dispose(): void;
};

/**
 * A step of `step` toward `target`, landing exactly ON it rather than past it.
 * Linear and measured in sim ticks, so a weather change takes the same
 * PRESENCE_RAMP_SECONDS at any frame rate and actually ARRIVES — an exponential
 * lag would approach and never reach, leaving ghost-scaled animals under dread.
 */
function rampTo(current: number, target: number, step: number): number {
  const gap = target - current;
  return Math.abs(gap) <= step ? target : current + Math.sign(gap) * step;
}

/**
 * Grows a bucket's buffers to hold `count` instances, doubling from
 * BIRD_MIN_INSTANCES. Old contents are dropped rather than copied: every live
 * instance is rewritten immediately afterwards. The buffers grow together
 * under one `grown` flag so their capacities can never disagree — a `wing`
 * or `tint` buffer shorter than the matrix buffer would leave Babylon reading
 * past its end for the tail instances.
 */
function ensureBirdCapacity(bucket: BirdBucket): void {
  const needed = bucket.count * 16;
  if (bucket.matrices.length >= needed) {
    bucket.grown = false;
    return;
  }
  let capacity = Math.max(bucket.matrices.length, BIRD_MIN_INSTANCES * 16);
  while (capacity < needed) capacity *= 2;
  bucket.matrices = new Float32Array(capacity);
  bucket.wing = new Float32Array((capacity / 16) * 2);
  if (bucket.tint !== null) bucket.tint = new Float32Array((capacity / 16) * 4);
  bucket.grown = true;
}

/**
 * Pushes a filled bucket to its mesh. Grown buffers need the whole GPU buffer
 * recreated; buffers written in place need only the live prefix re-uploaded,
 * which is what `thinInstanceBufferUpdated` does once `thinInstanceCount` is
 * set. Created UPDATABLE (`staticBuffer` false) for the reason
 * `clutterMeshes.ts` records: `updateDirectly` silently no-ops on a
 * non-updatable buffer, so the flock would freeze at the last wholesale set.
 *
 * A zero-count bucket is disabled outright — with `instancesCount` 0 Babylon's
 * `hasThinInstances` is false and the bare bucket mesh would be drawn once at
 * the origin, a single raven stuck at world zero.
 */
function applyBirdBucket(bucket: BirdBucket): void {
  const count = bucket.count;
  for (const mesh of bucket.meshes) {
    if (bucket.grown) {
      // Sets `thinInstanceCount` to the full CAPACITY as a side effect, which
      // the assignment below immediately trims to the live count.
      mesh.thinInstanceSetBuffer("matrix", bucket.matrices, 16, false);
      mesh.thinInstanceSetBuffer("wing", bucket.wing, 2, false);
      // "color" is Babylon's own kind name; it registers the buffer under
      // `instanceColor`, the attribute its shaders multiply the vertex colour
      // by. Nothing of ours declares it.
      if (bucket.tint !== null) mesh.thinInstanceSetBuffer("color", bucket.tint, 4, false);
      mesh.thinInstanceCount = count;
    } else {
      mesh.thinInstanceCount = count;
      if (count > 0) {
        mesh.thinInstanceBufferUpdated("matrix");
        mesh.thinInstanceBufferUpdated("wing");
        if (bucket.tint !== null) mesh.thinInstanceBufferUpdated("color");
      }
    }
    mesh.setEnabled(count > 0);
  }
}

/**
 * The catalog `output` for an asset id, or null if the catalog has no such
 * entry. Resolved here rather than through `modelUrl` directly because
 * `modelUrl` THROWS on an output it does not know: the catalog has no bird
 * entries yet, so calling it for an absent asset would take down startup
 * instead of simply leaving the sky empty (`creatureModel.ts`'s `urlFor` note,
 * from the other side).
 */
function birdOutputFor(assetId: string): string | null {
  const entries = (catalog as { assets?: unknown }).assets;
  if (!Array.isArray(entries)) return null;
  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null) continue;
    const a = entry as { id?: unknown; output?: unknown };
    if (a.id === assetId && typeof a.output === "string") return a.output;
  }
  return null;
}

/**
 * EVERY geometry-bearing mesh under the container's `LOD0` root, with each
 * transform baked into its own vertices and its parenting dropped —
 * `clutterMeshes.ts`'s `lodMeshes`, for one LOD level. Baking is not tidiness:
 * thin instances compose as `world * instanceMatrix`, so any leftover mesh
 * transform would move the whole flock rather than each bird.
 *
 * The root is located BY NAME anywhere in the node graph, and a container with
 * no `LOD0` returns nothing at all. The old fallback — scan
 * the whole container, take the first mesh with vertices — would silently adopt
 * an LOD1 or LOD2 mesh and draw the lowest level at full size, which is the
 * exact failure the by-name lookup exists to make impossible. No bucket is a
 * failure the caller already handles everywhere.
 *
 * World matrices are snapshotted BEFORE any transform is reset: if one bucket
 * mesh were an ancestor of another, resetting it first would corrupt the
 * descendant's world matrix mid-loop.
 */
export function birdLodMeshes(container: AssetContainer): Mesh[] {
  const nodes: Node[] = [...container.transformNodes, ...container.meshes];
  const root = nodes.find((n) => n.name === "LOD0");
  if (root === undefined) return [];
  const out: Mesh[] = [];
  for (const node of [root, ...root.getChildMeshes(false)]) {
    if (node instanceof Mesh && node.getTotalVertices() > 0 && !out.includes(node)) out.push(node);
  }
  const worlds = out.map((mesh) => mesh.computeWorldMatrix(true).clone());
  for (const [i, mesh] of out.entries()) {
    mesh.bakeTransformIntoVertices(worlds[i] as Matrix);
    mesh.position.setAll(0);
    mesh.rotationQuaternion = null;
    mesh.rotation.setAll(0);
    mesh.scaling.setAll(1);
    mesh.parent = null;
  }
  return out;
}

export function createWildlifeMeshes(
  scene: Scene,
  seed: number,
  options: WildlifeMeshesOptions = {},
): WildlifeMeshes {
  const radiusScale = options.radiusScale ?? 1;
  // A pool handed in belongs to the caller; only one this created is disposed.
  const ownsPool = options.pool === undefined;
  const pool = options.pool ?? createCreaturePool();
  const shadows = options.shadows;
  const collector = createWildlifeCollector(seed);
  const states = new Map<number, UnitState>();
  const slots = new Map<number, CreatureInstance>();
  const events: WildlifeEvent[] = [];
  // The previous frame's herd flee starts, handed to `stepUnit` as this frame's
  // disturbances. `disturbPool` never shrinks, so re-filling `disturbances`
  // reuses the same point objects instead of allocating on the per-frame path.
  const disturbPool: { x: number; z: number }[] = [];
  const disturbances: PlayerPoint[] = [];
  // The wildlife director: its own state (the sighting clock and log), the
  // ground function it judges line of sight against (closed over `seed` once,
  // never rebuilt), and the candidate list `update`'s own per-unit loop fills
  // as it goes (see `pushCandidateFor`) rather than walking `states` a second
  // time — a second `values()` iterator per frame is exactly what the
  // `birdList` comment above rules out, and candidate-building is no
  // exception. `candidatePool` holds the actual objects, grown by need and
  // never shrunk — the `disturbPool` idiom above, applied to a list rebuilt
  // from a Map instead of an events array — so a steady disc allocates
  // nothing here once it has grown to its high-water mark. `candidateCount`
  // is that pool's write cursor for the frame, reset in `resetCandidates`;
  // `candidates` itself is trimmed to it once, after the per-unit loop, and
  // never reset to zero first — the same reasoning `captureDisturbances`'s
  // own use of this shape already carries: `.length = 0` right-trims an
  // array's backing store, so doing that every frame and then re-growing it
  // by writing costs a reallocation neither this array nor `disturbances`
  // needs to pay. `directorEvents` is reused the same way; `directorRemovals`
  // is a test-only log of every `remove` the director has asked for, kept
  // regardless of whether `applyDirectorEvent` went on to honour it, and
  // capped at `DIRECTOR_REMOVAL_BACKLOG_CAP` the same way `events` is capped
  // at `EVENT_BACKLOG_CAP`, since nothing in production ever drains it.
  // `lastDirectorTick` starts at -1 so the first director frame takes a sane
  // default `dt` instead of reading a nonsensical span back from before the
  // shell existed.
  //
  // `poolIds` is the shell's own record of which live `states` entries it
  // placed itself, rather than the seeded field — the thing `Candidate.owned`
  // tells the director, and the thing `rebuild`'s cleanup and a `remove`
  // event both have to ask before touching a unit. Not a range check against
  // the id: a real field id can land anywhere in its 31 bits (see
  // `DIRECTOR_ID_BASE`'s own doc in wildlifeDirector.ts), so the only
  // trustworthy record of "did I place this" is one this shell keeps itself.
  const directorState = createDirectorState(seed);
  const ground: Ground = (x, z) => elevationAt(seed, x, z);
  const candidatePool: Candidate[] = [];
  const candidates: Candidate[] = [];
  const directorEvents: CueEvent[] = [];
  const directorRemovals: number[] = [];
  const poolIds = new Set<number>();
  let candidateCount = 0;
  let lastDirectorTick = -1;
  const scratchQ = new Quaternion();
  const scratchScale = new Vector3();
  const scratchPos = new Vector3();
  const scratchMat = new Matrix();
  // Every bird unit in the disc, refreshed at each rebuild. An array rather
  // than a filter over `states` each frame: the bird pass walks it twice (count
  // then write), and two Map iterators per frame is exactly the per-frame
  // allocation this file's update path rules out.
  const birdList: UnitState[] = [];
  const birdBuckets: BirdBucket[] = [];
  const bucketByAsset = new Map<string, BirdBucket>();
  /** `bucketForSpecies[species]` is the FLYING bucket; null while unloaded. */
  const bucketForSpecies: (BirdBucket | null)[] = new Array<BirdBucket | null>(SPECIES_COUNT).fill(null);
  const birdContainers: AssetContainer[] = [];
  /**
   * Materials this shell created itself rather than adopting from a container — today just
   * the butterfly's. `Mesh.dispose()` leaves a material alone by default, which is right for
   * every GLB bird (its container owns the material and frees it), and wrong for exactly
   * this one: nothing else holds it, so without this list it would outlive every teardown,
   * still in `scene.materials` with its wing plugin and its compiled effect.
   */
  const ownedMaterials: Material[] = [];
  // Meshes handed in through `options.birds` belong to the caller; only ones
  // this loaded are disposed — the `ownsPool` rule, for the sky.
  const ownsBirds = options.birds === undefined;
  let perchedBucket: BirdBucket | null = null;
  let lastX = Infinity;
  let lastZ = Infinity;
  let presenceGround = 1;
  let presenceAloft = 1;
  let presenceRaven = 1;
  let presenceButterfly = 1;
  /**
   * The four ramps above, spread over every species and handed to the director
   * each frame. Refilled in place, never rebuilt: this is a per-frame path.
   *
   * The director cannot work this out for itself — presence is a function of the
   * weather and the clock, and the director is given neither — so it has to be
   * told, and it is told EXPLICITLY rather than through a field that could be
   * left out and read as "everything is visible". That default is the shape this
   * whole class of defect keeps coming back in.
   */
  const speciesPresence: number[] = new Array<number>(SPECIES_COUNT).fill(1);
  let lastPresenceTick = -1;
  let disposed = false;

  // Fire and forget. Nothing has to be re-driven when it resolves: `ensureSlot`
  // asks `pool.has` again for every member of every unit on every frame, so
  // slots simply start appearing the frame after the assets land.
  void pool.load(scene);

  /**
   * Flags every mesh of a bucket needs before it can hold thin instances, plus
   * the wing plugin on each one's material. Birds never cast and never receive:
   * the shadow budget is reserved for ground animals, and a shadow-casting
   * gull at 40 m altitude buys a smudge for a full extra shadow-map draw.
   *
   * The half span is measured across the WHOLE bird, not per mesh. The shader
   * divides |x| by it, so a two-material bird whose beak mesh
   * got its own narrow half span would flap that beak through its full
   * amplitude while the wings barely moved — one bird, one wingspan.
   */
  function adoptBirdBucket(assetId: string, meshes: readonly Mesh[]): void {
    if (meshes.length === 0) return;
    let minX = Infinity;
    let maxX = -Infinity;
    for (const mesh of meshes) {
      mesh.isPickable = false;
      mesh.receiveShadows = false;
      // Birds surround the camera exactly as clutter does, and syncing the
      // bucket's bounding box would rescan every matrix on every frame
      // (`thinInstanceRefreshBoundingInfo` inside `thinInstanceSetBuffer`).
      mesh.alwaysSelectAsActiveMesh = true;
      mesh.doNotSyncBoundingInfo = true;
      mesh.setEnabled(false); // nothing to draw until the first frame fills a buffer
      // Bake has run already, so the bound box is the placed geometry: a
      // model's wingtips are its x extremes.
      mesh.refreshBoundingInfo();
      const box = mesh.getBoundingInfo().boundingBox;
      minX = Math.min(minX, box.minimum.x);
      maxX = Math.max(maxX, box.maximum.x);
    }
    const halfSpan = 0.5 * (maxX - minX);
    for (const mesh of meshes) {
      if (mesh.material !== null) attachWing(mesh.material, halfSpan, birdBucketOmega(assetId));
    }
    // Keyed on the ASSET, like the wing beat above it: the bucket is the model, and it is
    // the butterfly's model — the one built in code from a single shared geometry — that
    // needs a per-instance colour. `EMPTY_BUFFER` rather than null marks "this bucket wants
    // a tint but has never held an instance"; `ensureBirdCapacity` sizes it on first use.
    const tint = assetId === BIRD_ASSET[SPECIES_BUTTERFLY] ? EMPTY_BUFFER : null;
    const bucket: BirdBucket = { meshes: [...meshes], matrices: EMPTY_BUFFER, wing: EMPTY_BUFFER, tint, count: 0, grown: false };
    birdBuckets.push(bucket);
    bucketByAsset.set(assetId, bucket);
    perchedBucket = bucketByAsset.get(BIRD_PERCHED_ASSET) ?? null;
    for (let s = 0; s < SPECIES_COUNT; s++) {
      const id = BIRD_ASSET[s];
      bucketForSpecies[s] = id === null || id === undefined ? null : (bucketByAsset.get(id) ?? null);
    }
  }

  /** Production path: one GLB per distinct bird model, `clutterMeshes.ts`'s
   * loading idiom. A species whose asset is not in the catalog simply has no
   * bucket and emits nothing, EXCEPT the butterfly's: that id names no catalog
   * output on purpose (`birdOutputFor` returns null for it, same as a
   * shipped-but-missing asset would), so it is built in code instead of skipped
   * — the one asset id in `wanted` this loop never fetches. */
  async function loadBirdAssets(): Promise<void> {
    const wanted = new Set<string>([BIRD_PERCHED_ASSET]);
    for (let s = FIRST_BIRD_SPECIES; s < SPECIES_COUNT; s++) {
      const id = BIRD_ASSET[s];
      if (id !== null && id !== undefined) wanted.add(id);
    }
    registerBuiltInLoaders();
    for (const assetId of wanted) {
      if (assetId === BIRD_ASSET[SPECIES_BUTTERFLY]) {
        // Disposed while an earlier asset was in flight: the same check the container
        // branch below makes, for the same reason — nothing should be built into a scene
        // this shell has already torn down.
        if (disposed) return;
        const mesh = buildButterflyMesh(scene);
        // No container brought this material, so nothing but `dispose` will ever free it.
        if (mesh.material !== null) ownedMaterials.push(mesh.material);
        adoptBirdBucket(assetId, [mesh]);
        continue;
      }
      const output = birdOutputFor(assetId);
      if (output === null) continue;
      try {
        const container = await loadAssetContainerAsync(modelUrl(output), scene);
        // Disposed while awaiting: dispose() has already walked a shorter
        // container list, so clean up what just landed here.
        if (disposed) {
          container.dispose();
          return;
        }
        birdContainers.push(container);
        container.addAllToScene();
        const meshes = birdLodMeshes(container);
        if (meshes.length === 0) continue;
        // Everything the container brought that is not in the bucket — LOD1,
        // LOD2, empty wrappers — is disabled, `clutterMeshes.ts`'s rule.
        for (const other of container.meshes) {
          if (other instanceof Mesh && !meshes.includes(other)) other.setEnabled(false);
        }
        adoptBirdBucket(assetId, meshes);
      } catch {
        // One bad asset costs its own bird and nothing else — the
        // degrade-don't-block rule the forest and clutter shells share.
      }
    }
  }

  if (options.birds !== undefined) {
    for (const [assetId, mesh] of Object.entries(options.birds)) {
      adoptBirdBucket(assetId, Array.isArray(mesh) ? mesh : [mesh]);
    }
  } else void loadBirdAssets();

  function releaseUnit(u: UnitState): void {
    const base = u.unit.id * SLOT_STRIDE;
    for (let m = 0; m < u.unit.members; m++) {
      const inst = slots.get(base + m);
      if (inst === undefined) continue;
      // Before the release: the meshes have to come out of the shadow map while
      // they still exist to be found in it.
      if (shadows !== undefined) for (const mesh of inst.root.getChildMeshes()) shadows.remove(mesh);
      slots.delete(base + m);
      pool.release(base + m);
    }
  }

  function rebuild(camX: number, camZ: number, tick: number): void {
    const units = collector.collect(camX, camZ, radiusScale);
    const keep = new Set<number>();
    for (const u of units) {
      keep.add(u.id);
      if (!states.has(u.id)) states.set(u.id, createUnitState(u, tick, seed));
    }
    for (const [id, u] of [...states]) {
      if (keep.has(id)) continue;
      // A director pool unit is not part of the seeded field the collector
      // walks, so it is never in `keep` — that is not the same as having left
      // the disc. It lives until the director's own `remove` event gives it
      // back (see `applyDirectorEvent`), or a cue mid-flight staged out of the
      // fog would vanish the moment the camera crossed a rebuild step. Tested
      // against `poolIds`, the shell's own record of what it placed — not a
      // range check on the id, which a real field id can land inside of just
      // as easily as a placed one's.
      if (poolIds.has(id)) continue;
      releaseUnit(u);
      states.delete(id);
    }
    birdList.length = 0;
    for (const u of states.values()) if (u.unit.species >= FIRST_BIRD_SPECIES) birdList.push(u);
  }

  /** True for the four species whose members are spread around a flown loop rather than a
   * point on the ground — the ones `poseBirds` runs for and whose full circle the
   * never-on-screen invariant has to cover (see `Candidate` in wildlifeDirector.ts). The
   * butterfly is species-numbered among the birds but has no loop of its own — placed and
   * driven like a mammal — so it is named out here explicitly rather than by the
   * `FIRST_BIRD_SPECIES` cutoff alone. */
  function isLoopFlier(species: number): boolean {
    return species >= FIRST_BIRD_SPECIES && species !== SPECIES_BUTTERFLY;
  }

  /**
   * The lowest free director-pool slot for `species`, or -1 once every slot
   * `DIRECTOR_POOL` allows it is already a live id in `states`. Read straight
   * off `states` rather than a separate count, so a slot freed by a `remove`
   * event is immediately available again with nothing else to keep in sync.
   */
  function poolSlotFor(species: number): number {
    const capacity = DIRECTOR_POOL[species] ?? 0;
    for (let slot = 0; slot < capacity; slot++) {
      if (!states.has(DIRECTOR_ID_BASE + species * DIRECTOR_POOL_STRIDE + slot)) return slot;
    }
    return -1;
  }

  /**
   * Carries out a director `place` event: takes the lowest free pool slot for
   * the species, builds it a `WildlifeUnit` at the event's own point — `h` is
   * recovered from the `y` the director validated line of sight to, since
   * `PLACE_BODY_H` is the fixed offset `startFor` added going the other way —
   * and sends the new unit straight into its cue. Silently declines when the
   * species' pool is already full: `RECYCLE`/`REMOVE_SECONDS` keep pool churn
   * low enough that this should not bind in practice, and a beat that cannot
   * be carried out is no worse than one the director never staged.
   */
  function applyPlace(e: Extract<CueEvent, { kind: "place" }>, tick: number): void {
    const slot = poolSlotFor(e.species);
    if (slot < 0) return;
    const id = DIRECTOR_ID_BASE + e.species * DIRECTOR_POOL_STRIDE + slot;
    const h = e.y - PLACE_BODY_H;
    const unit: WildlifeUnit = {
      species: e.species, id, cellX: 0, cellZ: 0,
      x: e.x, z: e.z, h,
      members: 1,
      refugeX: e.x, refugeZ: e.z,
      homeX: e.x, homeZ: e.z, homeH: h,
      homeScale: 1, altitude: 0, radius: 0,
      hash: 0, presenceDraw: 0,
    };
    const u = createUnitState(unit, tick, seed);
    startCue(u, e.goalX, e.goalZ, e.run, tick);
    states.set(id, u);
    poolIds.add(id);
  }

  /**
   * Carries out one of the director's three event kinds against `states`.
   *
   * Every `remove` the director ever asks for is recorded into
   * `directorRemovals` FIRST, before anything below has a chance to decide
   * whether to honour it — a test seam that watches what the director
   * REQUESTS rather than what the shell actually did with it, so a guard
   * that quietly swallowed a bad request (as this one does) cannot also hide
   * the request from a test written to catch it.
   *
   * A `remove` is then honoured only for an id `poolIds` still holds — the
   * shell's own record of what it placed, checked rather than assumed: the
   * director decides `remove` only for a `Candidate` `buildCandidates` itself
   * marked `owned`, so this should always hold, but a stale id from a unit
   * that left some other way this same frame costs nothing to rule out and a
   * mistaken one costs a real animal's whole state — gone until the next disc
   * rebuild recreates it from scratch, at its ORIGINAL spawn point rather
   * than wherever it had gotten to, which if the player is looking anywhere
   * near there is exactly the appearing-from-nowhere this feature exists to
   * prevent. `Set.delete` reports whether the id was there, which both
   * answers that question and clears the bookkeeping in one call — done
   * before the `states` lookup below, so an id that names a unit gone some
   * other way is never left stranded in `poolIds` just because this function
   * returned early. A `drive` carries no matching risk and is deliberately
   * not guarded the same way: driving a natural unit into view is the
   * preferred half of every cue, not a bug.
   */
  function applyDirectorEvent(e: CueEvent, tick: number): void {
    if (e.kind === "place") { applyPlace(e, tick); return; }
    if (e.kind === "remove") {
      if (directorRemovals.length > DIRECTOR_REMOVAL_BACKLOG_CAP) directorRemovals.length = 0;
      directorRemovals.push(e.id);
      const owned = poolIds.delete(e.id);
      const u = states.get(e.id);
      if (u === undefined || !owned) return;
      releaseUnit(u);
      states.delete(e.id);
      return;
    }
    const u = states.get(e.id);
    if (u === undefined) return; // the unit it named already left some other way
    startCue(u, e.goalX, e.goalZ, e.run, tick);
  }

  /** Resets the write cursor before a frame that runs the director rebuilds
   * `candidates` — called once, before the per-unit loop in `update`, so
   * that loop can fill this frame's candidates as it visits each unit rather
   * than `states` taking a second `values()` iterator of its own (see the
   * `birdList` comment above for why a second one matters here). Does NOT
   * touch `candidates.length`: that would right-trim the array's own backing
   * store to zero every single frame — `captureDisturbances`'s own idiom
   * elsewhere in this file sets `.length` only once, downward, after every
   * slot for the frame is written, which is the form that does not cost a
   * reallocation. Measured over 500k frames: the push-then-`length = 0` shape
   * this replaced cost 580 new-space and 290 old-space GC scavenges against
   * 2 and 2 for this one. */
  function resetCandidates(): void {
    candidateCount = 0;
  }

  /**
   * Candidate-fills the next slot of `candidatePool` from `u` and appends it
   * to `candidates` — called once per unit from inside `update`'s own
   * per-unit loop, immediately after that unit's `stepUnit` (or, for a unit
   * the presence gate is hiding this frame, in its place), so every candidate
   * reflects this frame's freshest pose rather than last frame's. A loop
   * flier is seated on its LEAD BIRD's pose, not its loop centre: `x/y/z` is
   * what the invariant judges, and for a flock that is the nearest bird, not
   * a point that can sit a hundred metres from any of them. Everything else
   * — a mammal, the butterfly, a placed pool unit — has no loop, so its own
   * position IS its anchor and `moveR` is zero. A flier not yet posed (the
   * one tick between `createUnitState` and its first `stepUnit`) is skipped
   * outright rather than read off its ground-seated placeholder, which would
   * report it at ground level: the same call this file already makes for a
   * bird's very first scheduled call.
   *
   * `owned` is read straight off `poolIds` — told to the director rather than
   * left for it to infer from the id, which is the whole point of carrying
   * the flag at all (see `Candidate`'s own doc in wildlifeDirector.ts).
   *
   * A unit at zero presence is NOT a candidate, for any species. It is not in
   * the world this frame at all — a ground animal drawn at scale 0, a bird
   * `updateBirds` skips outright — so offering it to the director would let it
   * be driven somewhere nobody can see it arrive and, worse, be counted as a
   * sighting the moment it sat in frame: the cadence credited for an animal the
   * player never saw. That is the same defect as a species with no model and a
   * species with no pool slot, reached through a third door, and this is where
   * it is shut for all three of dread, rain and the butterfly's own clock.
   * (The raven gate is folded in here too: `presenceFor` already returns -1
   * for a roost the draw is hiding, which used to be a candidate on the
   * argument that the presence gate was not the director's business. It is: a
   * hidden raven is not drawn either.)
   */
  function pushCandidateFor(u: UnitState, view: View, mist: number): void {
    if (presenceFor(u) <= 0) return;
    const flier = isLoopFlier(u.unit.species);
    if (flier && !u.posed) return;
    let c = candidatePool[candidateCount];
    if (c === undefined) {
      c = { id: 0, species: 0, x: 0, y: 0, z: 0, onScreen: false, phase: 0, moveX: 0, moveZ: 0, moveR: 0, owned: false };
      candidatePool[candidateCount] = c;
    }
    c.id = u.unit.id;
    c.species = u.unit.species;
    c.phase = u.phase;
    c.owned = poolIds.has(u.unit.id);
    if (flier) {
      const lead = u.poses[0]!;
      c.x = lead.x; c.y = lead.y; c.z = lead.z;
      c.moveX = u.x; c.moveZ = u.z; c.moveR = u.unit.radius;
    } else {
      c.x = u.x; c.y = u.y; c.z = u.z;
      c.moveX = u.x; c.moveZ = u.z; c.moveR = 0;
    }
    c.onScreen = onScreen(view, ground, c, mist);
    candidates[candidateCount] = c;
    candidateCount++;
  }

  /**
   * Which of the four live ramps a species is drawn at — the ONE mapping from
   * species to presence in this file. Everything that needs to know how visible
   * something is goes through here: `presenceFor` for a single unit, and
   * `speciesPresence` for the table the director is handed. Two hand-written
   * copies of this mapping would be a fifth way for the same defect to come
   * back, with the shell hiding an animal the director still thought was there.
   */
  function presenceOfSpecies(s: number): number {
    if (s === SPECIES_BUTTERFLY) return presenceButterfly;
    if (s === SPECIES_RAVEN_ROOST || s === SPECIES_RAVEN_PAIR) return presenceRaven;
    return s >= FIRST_BIRD_SPECIES ? presenceAloft : presenceGround;
  }

  /**
   * How present a unit is, in [0, ∞), whatever kind of animal it is. Negative
   * means "not here at all". Zero or less means it is not in the world this
   * frame — not merely undrawn — and that is the single question `updateBirds`,
   * `pushCandidateFor` and the pool hand-back in `update` all ask.
   *
   * Ravens carry their presence entirely in COUNT:
   * `wildlifeField.ts` places roosts to twice their density and
   * tags each with `presenceDraw = draw / D`, and showing one only while its
   * draw sits under the live raven presence gives the first half at `clear`,
   * both halves under dread, and half of the first half at rain — all without a
   * re-walk of the field. A surviving raven is then drawn at FULL SIZE: a
   * half-scale raven is a wrong-looking bird, whereas fewer ravens is exactly
   * what rain means. Gulls and eagles are the other way round — placed at 1×,
   * never gated, and carrying `aloft` in scale.
   *
   * The "ravens ×2" density boost reaches only ROOSTS: pairs are
   * gated by this same draw, which thins them correctly under rain, but
   * `wildlifeField.ts` rejects a pair at `presenceDraw >= 1` rather than 2, so
   * dread buys extra roosts and nothing else. Inherited by design.
   *
   * The raven draw is the one thing here that is per UNIT rather than per
   * species, which is why this wraps `presenceOfSpecies` rather than being it:
   * two roosts of the same species in the same weather can differ, one hidden
   * and one not.
   */
  function presenceFor(u: UnitState): number {
    return ravenHidden(u) ? -1 : presenceOfSpecies(u.unit.species);
  }

  /**
   * Whether the raven gate above hides this unit RIGHT NOW — i.e. it is not in
   * the world at all this frame, not merely undrawn.
   *
   * That distinction is the whole of it: a hidden roost that still ran its state
   * machine would still lift, still land, and still push the `call` events
   * `wildlifeAudio` voices at the ravens' full gain — a croak out of an empty
   * snag, and twice the intended raven call rate at `clear`, where the
   * gate hides half of every roost the field placed at 2xD. So the gate runs
   * before `stepUnit`, not after it.
   *
   * Its `UnitState` is KEPT and merely frozen, never released: when the dread
   * ramp lifts the gate the unit resumes from where it stopped, and `stepUnit`'s
   * MAX_CATCHUP_TICKS cap bounds the catch-up to six ticks however long it was
   * away. Nothing else needs to know: a frozen unit's poses are equally stale,
   * and `updateBirds` skips it on the same gate.
   */
  function ravenHidden(u: UnitState): boolean {
    const s = u.unit.species;
    return (s === SPECIES_RAVEN_ROOST || s === SPECIES_RAVEN_PAIR) && u.unit.presenceDraw >= presenceRaven;
  }

  /** The uniform scale a bird's instances take: 1 for a raven that passed the
   * gate, the aloft presence for everything else. */
  function birdScaleFor(u: UnitState, presence: number): number {
    const s = u.unit.species;
    if (s === SPECIES_RAVEN_ROOST || s === SPECIES_RAVEN_PAIR) return 1;
    return Math.min(1, presence);
  }

  /** The species' disc radius, SQUARED — the cull compares squared distances,
   * which is the same test without two `Math.hypot` square
   * roots per pose per frame. */
  function birdCullRadiusSquared(u: UnitState): number {
    const r = WILDLIFE_RADIUS[u.unit.species]! * radiusScale;
    return r * r;
  }

  /** The bucket a unit's members draw from this frame: a roost sitting on its
   * snag is a different model from the same roost in the air. */
  function birdBucketFor(u: UnitState): BirdBucket | null {
    if (u.unit.species === SPECIES_RAVEN_ROOST && u.phase === PHASE_REST) return perchedBucket;
    return bucketForSpecies[u.unit.species] ?? null;
  }

  /**
   * Every bird pose in the disc, gathered into its bucket's reused buffers.
   * Two passes so no buffer has to grow mid-fill (the clutter pattern): pass 1
   * counts, `ensureBirdCapacity` grows what it must, pass 2 writes.
   *
   * Birds CULL at the disc edge instead of fading: a gull shrinking
   * to nothing over the last 20 m of a 400 m disc is a gull the player cannot
   * see either way, and the fade band that saves a ground animal's pop-in buys
   * nothing 400 m out. Scale carries presence alone.
   */
  function updateBirds(camX: number, camZ: number): void {
    if (birdBuckets.length === 0) return;
    for (let i = 0; i < birdBuckets.length; i++) birdBuckets[i]!.count = 0;

    for (let i = 0; i < birdList.length; i++) {
      const u = birdList[i]!;
      // `<= 0`, not `< 0`: a gull at zero aloft presence is
      // gone, not shrunk. The ground path draws its animals at scale 0 to keep
      // a pooled slot warm; a thin instance has no slot to keep, so emitting
      // one buys a degenerate triangle and a buffer stride for nothing.
      if (presenceFor(u) <= 0) continue;
      const bucket = birdBucketFor(u);
      if (bucket === null) continue;
      const r2 = birdCullRadiusSquared(u);
      for (let m = 0; m < u.poses.length; m++) {
        const pose = u.poses[m]!;
        const dx = pose.x - camX;
        const dz = pose.z - camZ;
        if (dx * dx + dz * dz > r2) continue;
        bucket.count++;
      }
    }

    for (let i = 0; i < birdBuckets.length; i++) {
      const bucket = birdBuckets[i]!;
      ensureBirdCapacity(bucket);
      bucket.count = 0;
    }

    for (let i = 0; i < birdList.length; i++) {
      const u = birdList[i]!;
      const p = presenceFor(u);
      if (p <= 0) continue;
      const bucket = birdBucketFor(u);
      if (bucket === null) continue;
      const r2 = birdCullRadiusSquared(u);
      const presence = birdScaleFor(u, p);
      for (let m = 0; m < u.poses.length; m++) {
        const pose = u.poses[m]!;
        const dx = pose.x - camX;
        const dz = pose.z - camZ;
        if (dx * dx + dz * dz > r2) continue;
        const scale = pose.scale * presence;
        scratchScale.copyFromFloats(scale, scale, scale);
        Quaternion.RotationYawPitchRollToRef(pose.yaw, -pose.pitch, 0, scratchQ);
        scratchPos.copyFromFloats(pose.x, pose.y, pose.z);
        Matrix.ComposeToRef(scratchScale, scratchQ, scratchPos, scratchMat);
        scratchMat.copyToArray(bucket.matrices, bucket.count * 16);
        // (phase, amp). The phase is per (unit, member) and constant for the
        // life of the bird, so a flock beats out of step without the shader
        // needing anything but its own clock; the amp is the behaviour's, and
        // 0 is a glide — an eagle always, a gull between beats, a perched raven.
        bucket.wing[bucket.count * 2] = hash3(u.unit.id, m, SALT_WING_PHASE, seed) * 2 * Math.PI;
        bucket.wing[bucket.count * 2 + 1] = pose.wing;
        if (bucket.tint !== null) {
          // Drawn per (unit, member) off the same hash every other per-individual property
          // uses, so an individual keeps its colour for life and two peers agree on it
          // without exchanging anything — and rewritten every frame rather than cached,
          // because an instance's slot in the buffer is whatever the cull left it this
          // frame, not a property of the animal.
          //
          // Indexed, not destructured: `const [r, g, b] = …` goes through the iterator
          // protocol and makes an iterator per instance per frame, which is the one thing
          // this whole update path is written not to do.
          const draw = hash3(u.unit.id, m, SALT_BUTTERFLY_COLOURWAY, seed);
          const colourway = butterflyColourway(draw * BUTTERFLY_COLOURWAYS.length);
          const at = bucket.count * 4;
          bucket.tint[at] = colourway[0]; bucket.tint[at + 1] = colourway[1];
          bucket.tint[at + 2] = colourway[2]; bucket.tint[at + 3] = 1;
        }
        bucket.count++;
      }
    }

    for (let i = 0; i < birdBuckets.length; i++) applyBirdBucket(birdBuckets[i]!);
  }

  function ensureSlot(u: UnitState, m: number): CreatureInstance | null {
    const key = u.unit.id * SLOT_STRIDE + m;
    const existing = slots.get(key);
    if (existing !== undefined) return existing;
    const assetId = SPECIES_ASSET[u.unit.species];
    // A species with no shipped asset simply has no animals — there is no
    // capsule fallback for wildlife.
    if (assetId === null || assetId === undefined || !pool.has(assetId)) return null;
    const inst = pool.acquire(key, assetId);
    if (inst === null) return null;
    // Ground animals cast — a shadowless rabbit at 8 m floats.
    if (shadows !== undefined) for (const mesh of inst.root.getChildMeshes()) shadows.add(mesh);
    slots.set(key, inst);
    return inst;
  }

  /**
   * The herd flee starts among the events appended since `from`, copied into
   * `disturbances` for the next frame. Only a bolting herd disturbs a roost:
   * a squirrel's dash up a trunk and a rabbit's hop into a bush are
   * not events a raven notices, and a roost's own flee — pushed as it lifts —
   * must not feed itself, or no roost would ever settle again.
   */
  function captureDisturbances(from: number): void {
    let n = 0;
    for (let i = from; i < events.length; i++) {
      const e = events[i]!;
      if (e.kind !== "flee" || (e.species !== SPECIES_ELK && e.species !== SPECIES_DEER)) continue;
      let q = disturbPool[n];
      if (q === undefined) { q = { x: 0, z: 0 }; disturbPool[n] = q; }
      q.x = e.x;
      q.z = e.z;
      disturbances[n] = q;
      n++;
    }
    disturbances.length = n;
  }

  return {
    events,
    update(camX, camZ, tick, players, weather, hour, director) {
      if (events.length > EVENT_BACKLOG_CAP) events.length = 0;
      const eventsBefore = events.length;
      const dx = camX - lastX;
      const dz = camZ - lastZ;
      if (dx * dx + dz * dz >= WILDLIFE_REBUILD_STEP * WILDLIFE_REBUILD_STEP) {
        rebuild(camX, camZ, tick);
        lastX = camX;
        lastZ = camZ;
      }
      // All four presences ramp on the same clock (see `rampTo`): the sky has
      // to thin out at the same rate the ground does, or a weather change shows
      // the herd fading while the gulls snap out.
      // The very first update adopts the weather outright rather than fading in
      // from a full world the player never saw.
      const target = wildlifePresenceUnder(weather, hour);
      if (lastPresenceTick === -1) {
        presenceGround = target.ground;
        presenceAloft = target.aloft;
        presenceRaven = target.raven;
        presenceButterfly = target.butterfly;
      } else {
        const step = Math.max(0, tick - lastPresenceTick) / (PRESENCE_RAMP_SECONDS * SIM_TICK_HZ);
        presenceGround = rampTo(presenceGround, target.ground, step);
        presenceAloft = rampTo(presenceAloft, target.aloft, step);
        presenceRaven = rampTo(presenceRaven, target.raven, step);
        presenceButterfly = rampTo(presenceButterfly, target.butterfly, step);
      }
      lastPresenceTick = tick;
      for (let s = 0; s < SPECIES_COUNT; s++) speciesPresence[s] = presenceOfSpecies(s);

      if (director !== undefined) resetCandidates();
      for (const u of states.values()) {
        // A PLACED unit the presence gate has taken to zero goes straight back
        // to the pool. It has to happen here rather than through the director's
        // own `remove`, because `pushCandidateFor` no longer offers an
        // invisible unit at all and `sweepRemovals` can only give back what it
        // can see in `candidates` — so without this the slot would be held for
        // the rest of the match, and three dusks would leave the butterfly
        // unable to place another. Releasing it cannot break the
        // never-on-screen invariant the other way either: an animal drawn at
        // scale 0, or not drawn at all, is one nobody can watch leave. Deleting
        // the current key from a Map mid-iteration is defined behaviour and the
        // iterator carries on from the next entry.
        if (presenceFor(u) <= 0 && poolIds.has(u.unit.id)) {
          releaseUnit(u);
          poolIds.delete(u.unit.id);
          states.delete(u.unit.id);
          continue;
        }
        // A raven the presence gate hides is not here this frame — it neither
        // moves nor croaks (see `ravenHidden`). It is not a candidate either;
        // `pushCandidateFor`'s own gate drops it, and this call is kept only so
        // that the one place deciding what the director may act on stays the
        // one place.
        if (ravenHidden(u)) {
          if (director !== undefined) pushCandidateFor(u, director.view, director.match.mist);
          continue;
        }
        stepUnit(u, tick, players, seed, hour, disturbances, events);
        // After this unit's own `stepUnit`, not before: a candidate has to
        // reflect this frame's freshest pose, never last frame's.
        if (director !== undefined) pushCandidateFor(u, director.view, director.match.mist);
        if (u.unit.species >= FIRST_BIRD_SPECIES) continue; // thin instances — `updateBirds` below
        const r = WILDLIFE_RADIUS[u.unit.species]! * radiusScale;
        const edgeStart = Math.max(0, r - WILDLIFE_FADE_BAND);
        for (let m = 0; m < u.poses.length; m++) {
          const inst = ensureSlot(u, m);
          if (inst === null) continue;
          const pose = u.poses[m]!;
          const s = elevationSampleAt(seed, pose.x, pose.z);
          // A pitched pose (the squirrel clinging to a trunk) carries its own
          // height and wants no foot lift — it is not standing on anything.
          inst.root.position.set(pose.x, pose.pitch === 0 ? s.h + FOOT_LIFT : pose.y, pose.z);
          if (pose.pitch === 0) seatOnGround(pose.yaw, s.dx, s.dz, scratchQ);
          else Quaternion.RotationYawPitchRollToRef(pose.yaw, -pose.pitch, 0, scratchQ);
          if (inst.root.rotationQuaternion === null) inst.root.rotationQuaternion = scratchQ.clone();
          else inst.root.rotationQuaternion.copyFrom(scratchQ);
          // The disc edge fade, on the CPU. distanceFadePlugin.ts's per-instance
          // `fadeBands` attribute cannot do it here: a pooled creature is a
          // container clone, and its material is shared across every animal of
          // the species. Shrinking the root toward its own ground point is the
          // same shape of fade `fadeWeight` describes, at one multiply per
          // animal per frame.
          const fade = fadeWeight(Math.hypot(pose.x - camX, pose.z - camZ), edgeStart, r);
          const scale = pose.scale * presenceGround * fade;
          inst.root.scaling.set(scale, scale, scale);
          inst.play(pose.clip);
        }
      }
      updateBirds(camX, camZ);
      // This frame's flee starts, for next frame. Taken from the events this
      // call appended (never from the whole array), so a consumer that drains
      // `events` between updates cannot silently break the one cross-species
      // reaction wildlife has.
      captureDisturbances(eventsBefore);

      // The director, last: `candidates` is already this frame's, filled by
      // the per-unit loop above, and any unit it places or re-targets is
      // picked up by `stepUnit`/`ensureSlot` starting next frame — the same
      // one-tick lag `createUnitState`'s ground-seated placeholder already
      // carries for a brand new bird. Without a seventh argument this whole
      // block never runs: `candidates` is never even filled, `stepDirector`
      // is never called, and no pool unit is ever created.
      if (director !== undefined) {
        const dt = lastDirectorTick === -1 ? TICK_DT : Math.max(TICK_DT, (tick - lastDirectorTick) / SIM_TICK_HZ);
        lastDirectorTick = tick;
        // Trimmed down to this frame's live count, never up to it — the
        // `disturbances`/`captureDisturbances` shape, so a shrinking
        // population never leaves a stale tail past `candidateCount` for
        // `stepDirector` to read, and a growing one is already exactly this
        // long from `pushCandidateFor`'s own indexed writes.
        candidates.length = candidateCount;
        directorEvents.length = 0;
        stepDirector(directorState, director.view, ground, candidates, speciesPresence, director.match, dt, tick, seed, directorEvents);
        for (let i = 0; i < directorEvents.length; i++) applyDirectorEvent(directorEvents[i]!, tick);
      }
    },
    directorLog() {
      // The ring's own capacity, read off the log array rather than a second
      // constant kept in step with wildlifeDirector.ts's private `RECYCLE_LOG`.
      // Exact and in order for as long as fewer sightings than that capacity
      // have ever been recorded, which is every caller of this test seam so
      // far; past it the ring has begun overwriting its oldest entries, which
      // `DirectorState.log`'s own doc already says.
      const capacity = directorState.log.length / 2;
      const n = Math.min(directorState.logCount, capacity);
      return Array.from(directorState.log.subarray(0, n * 2));
    },
    poolCount() {
      return poolIds.size;
    },
    directorRemovals() {
      return directorRemovals.slice();
    },
    dispose() {
      for (const [key, inst] of slots) {
        if (shadows !== undefined) for (const mesh of inst.root.getChildMeshes()) shadows.remove(mesh);
        pool.release(key);
      }
      slots.clear();
      states.clear();
      poolIds.clear();
      directorRemovals.length = 0;
      birdList.length = 0;
      events.length = 0;
      if (ownsBirds) {
        // Only meshes this shell loaded. The containers own whatever the
        // buckets did not adopt (materials, other LOD levels, wrapper nodes);
        // `mesh.dispose` is idempotent, so the overlap is harmless.
        for (const bucket of birdBuckets) for (const mesh of bucket.meshes) mesh.dispose();
        for (const container of birdContainers) container.dispose();
        // What no container covers: see `ownedMaterials`.
        for (const material of ownedMaterials) material.dispose();
      }
      ownedMaterials.length = 0;
      birdContainers.length = 0;
      birdBuckets.length = 0;
      bucketByAsset.clear();
      bucketForSpecies.fill(null);
      perchedBucket = null;
      disposed = true;
      if (ownsPool) pool.dispose();
    },
  };
}
