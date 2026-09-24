import { describe, expect, it, vi } from "vitest";

/**
 * Every other case in this file hands `createWildlifeMeshes` its bird buckets through
 * `options.birds`, which skips `loadBirdAssets` outright. One case does not — the butterfly
 * is the only species whose bucket that function BUILDS rather than fetches, so it is the
 * only species whose production asset path a test can reach at all — and that case needs the
 * fetch half stubbed: the four GLB birds it walks past first are real catalog entries, and
 * `loadAssetContainerAsync` against a bundler URL under NullEngine either hangs or fails
 * slowly. Rejecting immediately is what a missing asset already does (`loadBirdAssets`
 * catches per asset and carries on: "one bad asset costs its own bird and nothing else"), so
 * the stub exercises the real control flow rather than a special one, and the recorded urls
 * are how that case proves nothing was fetched for the butterfly.
 */
const loaderStub = vi.hoisted(() => ({ urls: [] as string[] }));
vi.mock("@babylonjs/core/Loading/sceneLoader.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@babylonjs/core/Loading/sceneLoader.js")>();
  return {
    ...actual,
    loadAssetContainerAsync: (url: unknown) => {
      loaderStub.urls.push(String(url));
      return Promise.reject(new Error("the suite fetches no models"));
    },
  };
});

import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import catalog from "../../assets/catalog.json" with { type: "json" };
import "../../src/sim/passes/index.js";
import { elevationAt, elevationSampleAt, setActiveTerrainVariant } from "../../src/sim/terrain.js";
import { SIM_TICK_HZ } from "../../src/sim/constants.js";
import { WEATHER_PRESETS } from "../../src/game/weather.js";
import type { WeatherParams } from "../../src/game/weather.js";
import { fadeWeight } from "../../src/game/distanceFadePlugin.js";
import { WING_TIME_WRAP, WingPlugin } from "../../src/game/wingPlugin.js";
import { AssetContainer } from "@babylonjs/core/assetContainer.js";
import { TransformNode as BabylonTransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import {
  DIRECTOR_POOL, FIRST_BIRD_SPECIES, SPECIES_BUTTERFLY, SPECIES_COUNT, SPECIES_EAGLE, SPECIES_ELK, SPECIES_GULL,
  SPECIES_RAVEN_PAIR, SPECIES_RAVEN_ROOST, SPECIES_SQUIRREL, WILDLIFE_CELL, WILDLIFE_D, WILDLIFE_RADIUS,
  WILDLIFE_SPREAD, wildlifeUnitsInDisc,
} from "../../src/game/wildlifeField.js";
import {
  BIRD_ASSET, BIRD_OMEGA, BIRD_PERCHED_ASSET, BUTTERFLY_BODY_HALF, BUTTERFLY_COLOURWAYS, BUTTERFLY_OMEGA,
  BUTTERFLY_WING_CHORD, BUTTERFLY_WING_SPAN, birdBucketOmega, birdLodMeshes, butterflyColourway, butterflyGeometry,
  createWildlifeMeshes, SLOT_STRIDE, SPECIES_ASSET, WILDLIFE_FADE_BAND, WILDLIFE_REBUILD_STEP,
} from "../../src/game/wildlifeMeshes.js";
import { CUE_WEIGHT, GAP, LEAD, NOTICE, STILL_RELAX, type MatchState, type View } from "../../src/game/wildlifeDirector.js";
import type { ClipRole, CreatureInstance, CreaturePool } from "../../src/game/creatureModel.js";

setActiveTerrainVariant("olympic");

const SEED = 388817;
/**
 * A camera position whose disc holds all four ground species at once (the
 * origin's holds only squirrels). The far jump below lands somewhere with a
 * disjoint unit set.
 */
const CAM_X = 2000;
const CAM_Z = -500;
/** One player, parked far enough away that nothing ever reacts to it. */
const FAR_AWAY = [{ x: 1e6, z: 1e6 }];
const GROUND_ASSETS = ["wildlife.elk", "wildlife.deer", "wildlife.rabbit", "wildlife.squirrel"];
/**
 * A point with no ground-species unit anywhere in any species' disc — flat
 * water far from the trail. The director's own field of candidates is empty
 * here, so any sighting the tests below see can only be a unit the director
 * itself placed or drove: nothing natural is ever already sitting in frame to
 * confuse the two.
 */
const QUIET_X = -10000;
const QUIET_Z = -8000;
const DAY_MATCH: MatchState = { phase: 0, hollowDistance: Infinity, hollowHunting: false, inWorld: true, hour: 12, mist: 0 };

/**
 * A pool that records what the shell asks of it and hands back bare nodes.
 * `release` forgets the record as well as disposing the node, mirroring the
 * real pool, whose `release(key)` runs the instance's own `dispose` and drops
 * it from the live map — a fake that only disposed would make "released" and
 * "never acquired" indistinguishable to the tests below.
 */
function fakePool(scene: Scene, ids: string[]) {
  const acquired = new Map<number, { id: string; root: TransformNode; played: ClipRole[] }>();
  const state = { disposed: 0 };
  const pool: CreaturePool = {
    load: async () => {},
    has: (id) => ids.includes(id),
    acquire(key, id) {
      const existing = acquired.get(key);
      if (existing) {
        // The real pool hands back the same instance for a key it already holds.
        return { root: existing.root, play: (r) => existing.played.push(r), dispose: () => {} };
      }
      if (!ids.includes(id)) return null;
      const root = new TransformNode(`fake_${key}`, scene);
      // One child mesh per animal: what the shell hands to the shadow registry.
      const body = new Mesh(`fake_${key}_body`, scene);
      body.parent = root;
      const rec = { id, root, played: [] as ClipRole[] };
      acquired.set(key, rec);
      const inst: CreatureInstance = {
        root,
        play: (r) => rec.played.push(r),
        dispose: () => { root.dispose(); acquired.delete(key); },
      };
      return inst;
    },
    release: (key) => {
      acquired.get(key)?.root.dispose();
      acquired.delete(key);
    },
    dispose: () => { state.disposed++; },
  };
  return { pool, acquired, state };
}

describe("createWildlifeMeshes", () => {
  it("acquires one creature per member of every ground unit in the disc, and releases them when the disc moves on", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const { pool, acquired, state } = fakePool(scene, GROUND_ASSETS);
    const units = wildlifeUnitsInDisc(SEED, CAM_X, CAM_Z);
    const herd = units.find((u) => u.species === SPECIES_ELK);
    const w = createWildlifeMeshes(scene, SEED, { pool });
    w.update(CAM_X, CAM_Z, 1000, FAR_AWAY, WEATHER_PRESETS.clear, 12);
    const expected = units.filter((u) => u.species < 4).reduce((n, u) => n + u.members, 0);
    expect(acquired.size).toBe(expected);
    expect(expected).toBeGreaterThan(0);
    if (herd) for (const rec of acquired.values()) if (rec.id === "wildlife.elk") expect(rec.played[rec.played.length - 1]).toBe("graze");
    // A far jump releases everything from the old disc.
    w.update(5000, 5000, 1001, FAR_AWAY, WEATHER_PRESETS.clear, 12);
    for (const key of acquired.keys()) expect(units.some((u) => Math.floor(key / SLOT_STRIDE) === u.id)).toBe(false);
    w.dispose();
    // A pool handed in belongs to the caller: the shell releases its slots but
    // must not dispose it, or a second shell sharing it would find it empty.
    expect(state.disposed).toBe(0);
    expect(acquired.size).toBe(0);
    engine.dispose();
  });

  it("places every creature on the ground and seats it on the ground normal", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const { pool, acquired } = fakePool(scene, ["wildlife.elk"]);
    const w = createWildlifeMeshes(scene, SEED, { pool });
    w.update(CAM_X, CAM_Z, 1000, FAR_AWAY, WEATHER_PRESETS.clear, 12);
    expect(acquired.size).toBeGreaterThan(0);
    let sloped = 0;
    for (const rec of acquired.values()) {
      expect(rec.root.position.y).toBeGreaterThan(-1);
      // Scale is the fade's business (the case below); this herd's anchor sits
      // 147 m into a 150 m disc, so some of its members are legitimately faded
      // to nothing here.
      expect(rec.root.scaling.x).toBeGreaterThanOrEqual(0);
      expect(rec.root.scaling.x).toBeLessThanOrEqual(1);
      expect(rec.root.rotationQuaternion).not.toBeNull();
      // The model's own up must land on the terrain's normal at its feet:
      // a rotation that is only the yaw leaves an elk standing plumb on a
      // hillside with its hooves through the slope.
      const s = elevationSampleAt(SEED, rec.root.position.x, rec.root.position.z);
      const n = new Vector3(-s.dx, 1, -s.dz).normalize();
      const up = Vector3.Up().applyRotationQuaternion(rec.root.rotationQuaternion!);
      expect(up.x).toBeCloseTo(n.x, 6);
      expect(up.y).toBeCloseTo(n.y, 6);
      expect(up.z).toBeCloseTo(n.z, 6);
      if (Math.hypot(s.dx, s.dz) > 0.05) sloped++;
    }
    // Guards the check above against passing on flat ground, where every
    // rotation seats the same way and an unseated model would look identical.
    expect(sloped).toBeGreaterThan(0);
    w.dispose();
    engine.dispose();
  });

  it("shrinks a herd away across the last of its disc and leaves a near one at full size", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const herd = wildlifeUnitsInDisc(SEED, CAM_X, CAM_Z).find((u) => u.species === SPECIES_ELK);
    expect(herd).toBeDefined();
    const r = WILDLIFE_RADIUS[SPECIES_ELK]!;
    const edge = r - WILDLIFE_FADE_BAND;

    // 145 m from the anchor: inside the 150 m disc, and every member (spread
    // ≤ 12 m) is past the 130.5 m fade start whichever way its offset points.
    const far = fakePool(scene, ["wildlife.elk"]);
    const a = createWildlifeMeshes(scene, SEED, { pool: far.pool });
    a.update(herd!.x + 145, herd!.z, 1000, FAR_AWAY, WEATHER_PRESETS.clear, 12);
    let faded = 0;
    for (const [key, rec] of far.acquired) {
      if (Math.floor(key / SLOT_STRIDE) !== herd!.id) continue;
      const d = Math.hypot(rec.root.position.x - (herd!.x + 145), rec.root.position.z - herd!.z);
      expect(d).toBeGreaterThan(edge);
      expect(rec.root.scaling.x).toBeCloseTo(fadeWeight(d, edge, r), 6);
      expect(rec.root.scaling.x).toBeLessThan(1);
      faded++;
    }
    expect(faded).toBe(herd!.members);
    a.dispose();

    const near = fakePool(scene, ["wildlife.elk"]);
    const b = createWildlifeMeshes(scene, SEED, { pool: near.pool });
    b.update(herd!.x, herd!.z, 1000, FAR_AWAY, WEATHER_PRESETS.clear, 12);
    let full = 0;
    for (const [key, rec] of near.acquired) {
      if (Math.floor(key / SLOT_STRIDE) !== herd!.id) continue;
      expect(rec.root.scaling.x).toBe(1);
      full++;
    }
    expect(full).toBe(herd!.members);
    b.dispose();
    engine.dispose();
  });

  it("loses no unit to an id collision in a disc whose ids used to collide", () => {
    // `unit.id` is the key for both the state map and the pool slots. It used
    // to be a hash3 draw, and hash3 collides structurally on neighbouring
    // lattice cells — at the origin, two of the five squirrel units inside the
    // disc shared an id, so one animal was never rendered and whichever unit
    // left the disc last released the other's slot. wildlifeField.ts now packs
    // the id from (species, cell); this is that fix seen from the shell.
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const ground = wildlifeUnitsInDisc(SEED, 0, 0).filter((u) => u.species < FIRST_BIRD_SPECIES);
    expect(new Set(ground.map((u) => u.id)).size).toBe(ground.length);
    const { pool, acquired } = fakePool(scene, GROUND_ASSETS);
    const w = createWildlifeMeshes(scene, SEED, { pool });
    w.update(0, 0, 1000, FAR_AWAY, WEATHER_PRESETS.clear, 12);
    expect(acquired.size).toBe(ground.reduce((n, u) => n + u.members, 0));
    w.dispose();
    engine.dispose();
  });

  it("hides ground animals under dread and does not rebuild until the camera moves a step", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const { pool, acquired } = fakePool(scene, GROUND_ASSETS);
    const w = createWildlifeMeshes(scene, SEED, { pool });
    w.update(CAM_X, CAM_Z, 1000, [], WEATHER_PRESETS.eerie, 12);
    expect(acquired.size).toBeGreaterThan(0);
    for (const rec of acquired.values()) expect(rec.root.scaling.x).toBe(0);
    const before = acquired.size;
    w.update(CAM_X + WILDLIFE_REBUILD_STEP / 2, CAM_Z, 1001, [], WEATHER_PRESETS.eerie, 12);
    expect(acquired.size).toBe(before);
    w.dispose();
    engine.dispose();
  });

  it("puts a treed squirrel on the trunk: pitched, not seated, and with no foot lift", () => {
    // The other branch of the placement code. A pitched pose carries its own
    // height (trunk base + climb) and is NOT lifted off the ground or laid on
    // the ground normal — it is clinging to bark, not standing on soil.
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const squirrel = wildlifeUnitsInDisc(SEED, 0, 0).find((u) => u.species === SPECIES_SQUIRREL);
    expect(squirrel).toBeDefined();
    const { pool, acquired } = fakePool(scene, ["wildlife.squirrel"]);
    const w = createWildlifeMeshes(scene, SEED, { pool });
    const atTheTrunk = [{ x: squirrel!.homeX, z: squirrel!.homeZ }];
    const rec = () => acquired.get(squirrel!.id * SLOT_STRIDE);
    // Standing under the tree: REST → ALERT on the next tick, and ALERT → FLEE
    // on the one after (it is already at its trunk), which is the frame the
    // climb starts from zero.
    w.update(squirrel!.homeX, squirrel!.homeZ, 1000, atTheTrunk, WEATHER_PRESETS.clear, 12);
    expect(rec()).toBeDefined();
    expect(rec()!.root.position.y).toBeGreaterThan(squirrel!.homeH); // on the ground, lifted
    w.update(squirrel!.homeX, squirrel!.homeZ, 1001, atTheTrunk, WEATHER_PRESETS.clear, 12);
    w.update(squirrel!.homeX, squirrel!.homeZ, 1002, atTheTrunk, WEATHER_PRESETS.clear, 12);
    // Exactly the trunk base, to the bit: no FOOT_LIFT on a pitched pose.
    expect(rec()!.root.position.y).toBe(squirrel!.homeH);
    // Pitched a quarter turn, so the model's own up is horizontal — a ground
    // seat would leave it within a few degrees of world up.
    const up = Vector3.Up().applyRotationQuaternion(rec()!.root.rotationQuaternion!);
    expect(up.y).toBeCloseTo(0, 6);
    // And it climbs from there.
    w.update(squirrel!.homeX, squirrel!.homeZ, 1003, atTheTrunk, WEATHER_PRESETS.clear, 12);
    expect(rec()!.root.position.y).toBeGreaterThan(squirrel!.homeH);
    w.dispose();
    engine.dispose();
  });

  it("maps the four ground species to their catalog ids and leaves birds to the bird shell", () => {
    expect(SPECIES_ASSET).toHaveLength(SPECIES_COUNT);
    expect(SPECIES_ASSET.slice(0, 4)).toEqual(["wildlife.elk", "wildlife.deer", "wildlife.rabbit", "wildlife.squirrel"]);
    expect(SPECIES_ASSET.slice(4).every((id) => id === null)).toBe(true);
  });

  it("hands a herd's flee back to a roost one frame later, whatever the events consumer does", () => {
    // The one cross-species reaction in the design, and the one an
    // audio drain could silently kill: `update` must take the flee starts it
    // feeds back as `disturbances` from the events IT appended, not from
    // whatever happens to be sitting in the array when the next frame starts.
    // Elk herd at (1578.2, -2340.9) with a roost 45 m away — outside
    // RAVEN_LIFT_RANGE, so only the disturbance can lift it.
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const herd = wildlifeUnitsInDisc(SEED, 1578, -2341).find((u) => u.species === SPECIES_ELK);
    expect(herd).toBeDefined();
    const onTheHerd = [{ x: herd!.x, z: herd!.z }];

    // Control: nobody near the herd, so no flee and no lift.
    const quiet = fakePool(scene, GROUND_ASSETS);
    const c = createWildlifeMeshes(scene, SEED, { pool: quiet.pool });
    for (const tick of [1000, 1001, 1002]) c.update(herd!.x, herd!.z, tick, FAR_AWAY, WEATHER_PRESETS.clear, 12);
    expect(c.events.some((e) => e.kind === "lift")).toBe(false);
    c.dispose();

    const { pool } = fakePool(scene, GROUND_ASSETS);
    const w = createWildlifeMeshes(scene, SEED, { pool });
    w.update(herd!.x, herd!.z, 1000, onTheHerd, WEATHER_PRESETS.clear, 12);
    w.update(herd!.x, herd!.z, 1001, onTheHerd, WEATHER_PRESETS.clear, 12);
    expect(w.events.some((e) => e.kind === "flee" && e.species === SPECIES_ELK)).toBe(true);
    // The audio shell reads and empties the array between updates.
    w.events.length = 0;
    w.update(herd!.x, herd!.z, 1002, onTheHerd, WEATHER_PRESETS.clear, 12);
    expect(w.events.some((e) => e.kind === "lift")).toBe(true);
    w.dispose();
    engine.dispose();
  });

  it("registers every acquired mesh as a shadow caster and takes back exactly those", () => {
    // Ground animals cast. `lighting.addShadowMesh` has no inverse in
    // Babylon's own dispose path, so an add with no matching remove leaves
    // every animal that ever left the disc in the shadow map forever.
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const { pool, acquired } = fakePool(scene, GROUND_ASSETS);
    const added: AbstractMesh[] = [];
    const removed: AbstractMesh[] = [];
    const w = createWildlifeMeshes(scene, SEED, {
      pool,
      shadows: { add: (m) => added.push(m), remove: (m) => removed.push(m) },
    });
    w.update(CAM_X, CAM_Z, 1000, FAR_AWAY, WEATHER_PRESETS.clear, 12);
    // One body mesh per animal, registered once — not once per frame.
    expect(added).toHaveLength(acquired.size);
    w.update(CAM_X, CAM_Z, 1001, FAR_AWAY, WEATHER_PRESETS.clear, 12);
    expect(added).toHaveLength(acquired.size);
    expect(removed).toHaveLength(0);
    // A far jump releases the old disc: everything it took back must be
    // something it had registered.
    w.update(5000, 5000, 1002, FAR_AWAY, WEATHER_PRESETS.clear, 12);
    expect(removed.length).toBeGreaterThan(0);
    for (const mesh of removed) expect(added).toContain(mesh);
    w.dispose();
    expect(removed).toHaveLength(added.length);
    expect(new Set(removed).size).toBe(new Set(added).size);
    engine.dispose();
  });

  it("ramps presence to the new weather over three seconds and stops there", () => {
    // The 3 s ramp, measured in sim ticks so it is the same length at any
    // frame rate — and a ramp, not an exponential lag, so it arrives.
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const { pool, acquired } = fakePool(scene, ["wildlife.elk"]);
    const herd = wildlifeUnitsInDisc(SEED, 1578, -2341).find((u) => u.species === SPECIES_ELK);
    expect(herd).toBeDefined();
    const w = createWildlifeMeshes(scene, SEED, { pool });
    // Standing on the herd, so every member is deep inside the disc and the
    // edge fade is exactly 1 — leaving `presence` as the only factor in scale.
    w.update(herd!.x, herd!.z, 1000, FAR_AWAY, WEATHER_PRESETS.clear, 12);
    expect(acquired.size).toBeGreaterThan(0);
    for (const rec of acquired.values()) expect(rec.root.scaling.x).toBe(1);
    // Half the 180-tick ramp: exactly half way, which pins the ramp's length
    // (an exponential lag would be ~63% of the way here and never arrive).
    w.update(herd!.x, herd!.z, 1090, FAR_AWAY, WEATHER_PRESETS.eerie, 12);
    for (const rec of acquired.values()) expect(rec.root.scaling.x).toBeCloseTo(0.5, 6);
    // A step wider than what is left (110 ticks against 90) lands exactly ON
    // the target, never past it: an unclamped ramp would take presence
    // negative and inflate the animals inside out on the way back.
    w.update(herd!.x, herd!.z, 1200, FAR_AWAY, WEATHER_PRESETS.eerie, 12);
    for (const rec of acquired.values()) expect(rec.root.scaling.x).toBe(0);
    w.dispose();
    engine.dispose();
  });
});

describe("the wildlife director", () => {
  it("never runs, and never creates a pool unit, without a seventh argument", () => {
    // The negative made unambiguous: not "the log happened to stay empty this
    // run" (which also passes with the director wired up but simply unlucky)
    // but "the director is never called at all" — checked the only two ways
    // that is externally visible, however long the shell is driven.
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const { pool, acquired } = fakePool(scene, GROUND_ASSETS);
    const w = createWildlifeMeshes(scene, SEED, { pool });
    for (let tick = 0; tick < 900; tick++) {
      w.update(CAM_X, CAM_Z, tick, FAR_AWAY, WEATHER_PRESETS.clear, 12);
    }
    // The natural field itself is still fully alive here (real ground units at
    // CAM_X/CAM_Z are acquired every frame) — it is specifically the POOL that
    // never gains a unit, not the whole shell going idle.
    expect(acquired.size).toBeGreaterThan(0);
    expect(w.directorLog()).toHaveLength(0);
    expect(w.poolCount()).toBe(0);
    w.dispose();
    engine.dispose();
  });

  it("relaxes for a still player: the first sighting lands no earlier than the relaxed floor", () => {
    // The positive that replaces "the log stayed empty for 900 ticks" — which
    // cannot tell a quiet cadence from a director that never ran at all, and
    // whose 900 ticks (15 s) sit inside the very band ([9, 18] s relaxed) the
    // test is trying to say something about, so whether anything fires is a
    // coin flip on the jittered draw. This drives a genuinely still player
    // (the view never moves) at the quiet point, where nothing natural is
    // ever already on screen, so the first log entry can only be the
    // director's own cue landing — and asserts its tick is at or beyond the
    // floor the relaxation can least be: GAP[0] * STILL_RELAX - LEAD, the
    // smallest the staging threshold can ever be once the player is credited
    // as still (stillFor and sinceSighting climb in lockstep from a fresh
    // director, so the still relaxation is already in force by the time
    // sinceSighting could reach even this floor). Without STILL_RELAX the
    // same floor is GAP[0] - LEAD = 3 s, so a broken relaxation fails this
    // comfortably rather than by luck.
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const { pool } = fakePool(scene, GROUND_ASSETS);
    const w = createWildlifeMeshes(scene, SEED, { pool });
    const view: View = { x: QUIET_X, y: elevationAt(SEED, QUIET_X, QUIET_Z) + 1.7, z: QUIET_Z, yaw: 0, pitch: 0, fov: 1.4, aspect: 16 / 9 };
    let tick = 0;
    for (; tick < 6000 && w.directorLog().length === 0; tick++) {
      w.update(QUIET_X, QUIET_Z, tick, [], WEATHER_PRESETS.clear, 12, { view, match: DAY_MATCH });
    }
    const log = w.directorLog();
    expect(log.length).toBeGreaterThan(0);
    const floor = GAP[0] * STILL_RELAX - LEAD;
    expect(log[0]! / SIM_TICK_HZ).toBeGreaterThanOrEqual(floor);
    w.dispose();
    engine.dispose();
  });

  it("places a unit where none is in reach, keeps it through a rebuild, logs it once seen, and gives it back once far and done", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const { pool, acquired } = fakePool(scene, GROUND_ASSETS);
    const w = createWildlifeMeshes(scene, SEED, { pool });
    const view: View = { x: QUIET_X, y: elevationAt(SEED, QUIET_X, QUIET_Z) + 1.7, z: QUIET_Z, yaw: 0, pitch: 0, fov: 1.4, aspect: 16 / 9 };
    let tick = 0;
    // Nothing natural exists here to drive, so the first thing the director
    // ever does is place one — the only path exercised by this test, and the
    // only way `acquired` ever gains an entry at all at this empty point. A
    // placed unit is only added to `states` at the END of the frame that
    // places it (see `update`'s own doc), so its first render — and so its
    // first appearance in `acquired` — is one frame later; hence the extra
    // update below once `poolCount` first turns positive.
    for (; tick < 3600 && w.poolCount() === 0; tick++) {
      w.update(QUIET_X, QUIET_Z, tick, [], WEATHER_PRESETS.clear, 12, { view, match: DAY_MATCH });
    }
    expect(w.poolCount()).toBeGreaterThan(0);
    w.update(QUIET_X, QUIET_Z, tick++, [], WEATHER_PRESETS.clear, 12, { view, match: DAY_MATCH });
    expect(acquired.size).toBeGreaterThan(0);
    const placedKey = [...acquired.keys()][0]!;

    // A disc rebuild (past WILDLIFE_REBUILD_STEP of camera travel) must not
    // drop it — it is not part of the seeded field the rebuild's `keep` set
    // is built from, and dropping it here would vanish it mid-cue.
    w.update(QUIET_X + WILDLIFE_REBUILD_STEP + 0.5, QUIET_Z, tick++, [], WEATHER_PRESETS.clear, 12, { view, match: DAY_MATCH });
    expect(acquired.has(placedKey)).toBe(true);

    // Sweep the view onto exactly where it was rendered and hold it there
    // until the log records it — the shell's own candidate, not a guess at
    // the director's private event.
    const pos = acquired.get(placedKey)!.root.position;
    const before = w.directorLog().length;
    for (let t = 0; t < 600 && w.directorLog().length === before; t++, tick++) {
      view.yaw = Math.atan2(pos.x - view.x, pos.z - view.z);
      w.update(QUIET_X, QUIET_Z, tick, [], WEATHER_PRESETS.clear, 12, { view, match: DAY_MATCH });
    }
    expect(w.directorLog().length).toBeGreaterThan(before);

    // Walk the view far away and hold it there: past REMOVE_FACTOR times what
    // the species reads at, for REMOVE_SECONDS, and the pool slot comes back.
    view.x = QUIET_X + 2000;
    view.z = QUIET_Z + 2000;
    let removedAt = -1;
    for (let t = 0; t < 3600 && removedAt < 0; t++, tick++) {
      w.update(view.x, view.z, tick, [], WEATHER_PRESETS.clear, 12, { view, match: DAY_MATCH });
      if (!acquired.has(placedKey)) removedAt = tick;
    }
    expect(removedAt).toBeGreaterThan(0);
    w.dispose();
    engine.dispose();
  });

  it("never asks to remove a real, natural unit, driven at a camera with real wildlife nearby", () => {
    // The exact regression `Candidate.owned` exists to prevent, caught directly: set wrong
    // (e.g. always true) makes the director believe every natural unit
    // nearby is its own to recycle. Watching RELEASES rather than REQUESTS
    // would miss that — this shell's own `poolIds` guard in
    // `applyDirectorEvent` absorbs a bad request before anything is actually
    // released, so `acquired`/`poolCount` alone can look clean even when the
    // director is reasoning from a false premise. `directorRemovals()` is
    // recorded before that guard runs, specifically so a test can see the
    // request itself.
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const { pool } = fakePool(scene, GROUND_ASSETS);
    const w = createWildlifeMeshes(scene, SEED, { pool });
    const naturalIds = new Set(wildlifeUnitsInDisc(SEED, CAM_X, CAM_Z).map((u) => u.id));
    expect(naturalIds.size).toBeGreaterThan(0);
    const view: View = { x: CAM_X, y: elevationAt(SEED, CAM_X, CAM_Z) + 1.7, z: CAM_Z, yaw: 0, pitch: 0, fov: 1.4, aspect: 16 / 9 };
    for (let tick = 0; tick < 3600; tick++) {
      w.update(CAM_X, CAM_Z, tick, [], WEATHER_PRESETS.clear, 12, { view, match: DAY_MATCH });
    }
    // Sanity: this population is genuinely mixed and genuinely active — a
    // drive with nothing natural nearby, or nothing ever cued, would pass
    // this test for the wrong reason.
    expect(w.directorLog().length).toBeGreaterThan(0);
    const requestedNatural = w.directorRemovals().filter((id) => naturalIds.has(id));
    expect(requestedNatural).toEqual([]);
    w.dispose();
    engine.dispose();
  });

  it("holds every per-species table to SPECIES_COUNT entries, and gives every cueable species an asset and a pool slot or neither", () => {
    // A table indexed by species that stops short of SPECIES_COUNT does not throw when a
    // new species raises the count — it silently hands back `undefined`, and the bug shows
    // up downstream as a NaN or a null pose, not here. This sub-project hit that shape
    // three times over (`WILDLIFE_RADIUS`, `WILDLIFE_SPREAD`, and the asset/pool pair this
    // test already checked below), the last two caught only because someone went looking
    // after the first — so every per-species table the renderer or the director reads by
    // index is held to SPECIES_COUNT here, in one place, rather than trusted individually.
    // `WILDLIFE_MEMBERS` is the one exception, left out on purpose: nothing reads it
    // generically over every species (only `membersFor`'s explicit callers do), so a
    // shorter table there is not the same defect — see its own doc in wildlifeField.ts.
    const perSpeciesTables: readonly (readonly unknown[])[] = [
      WILDLIFE_CELL, WILDLIFE_D, WILDLIFE_RADIUS, WILDLIFE_SPREAD, DIRECTOR_POOL,
      SPECIES_ASSET, BIRD_ASSET, BIRD_OMEGA, NOTICE, CUE_WEIGHT,
    ];
    for (const table of perSpeciesTables) {
      expect(table).toHaveLength(SPECIES_COUNT);
      for (let s = 0; s < SPECIES_COUNT; s++) expect(table[s]).not.toBeUndefined();
    }

    // The shape of the bug this guards: a species the cue table can still draw
    // (`CUE_WEIGHT[s] > 0`) but that neither `SPECIES_ASSET` nor `BIRD_ASSET`
    // can render is a `place` that holds a pool slot for life, is logged as a
    // sighting, and is never actually seen — crediting the cadence promise
    // for an animal that was not there. The butterfly WAS exactly this case
    // until it shipped a model: `DIRECTOR_POOL[SPECIES_BUTTERFLY]` held at 0
    // while nothing could draw one, and this is what holds the two facts
    // (asset shipped, pool slot given) to changing together — giving a
    // species its asset without also giving `DIRECTOR_POOL` its slot back
    // fails this exactly as loudly as the reverse would.
    //
    // Bounded by SPECIES_COUNT, not by `CUE_WEIGHT.length`: a table's own
    // length is exactly the thing under test above, so a short one must not
    // also be what decides how far this loop reaches. It once did, and a
    // species past the end of a short `CUE_WEIGHT` would have gone unchecked
    // here on top of never being drawn for a cue at all.
    const hasAsset = (species: number): boolean =>
      (SPECIES_ASSET[species] ?? null) !== null || (BIRD_ASSET[species] ?? null) !== null;
    let checked = 0;
    for (let species = 0; species < SPECIES_COUNT; species++) {
      if (CUE_WEIGHT[species]! <= 0) continue; // not cueable at all — nothing to check
      checked++;
      expect(hasAsset(species), `species ${species}: asset vs. DIRECTOR_POOL slot`).toBe((DIRECTOR_POOL[species] ?? 0) > 0);
    }
    // Guards the loop above against a `CUE_WEIGHT` that quietly went empty.
    expect(checked).toBeGreaterThan(0);
  });
});

/**
 * A camera whose 400 m bird disc holds all four bird species at once — raven
 * roosts, raven pairs, a gull flock band along the coast and a pair of eagles.
 * The ground cameras above hold no gulls at all (gulls need a coastline within
 * their cell).
 */
const BIRD_CAM_X = 0;
const BIRD_CAM_Z = -1000;
const BIRD_IDS = [BIRD_PERCHED_ASSET, "wildlife.raven", "wildlife.gull", "wildlife.eagle"];

/**
 * One bucket mesh per bird model, the `options.birds` escape hatch. A box with
 * its own PBR material, so `attachWing` has a real material to hang the plugin
 * on and the shell has a real bounding box to take the half span from.
 */
function fakeBirds(scene: Scene, ids: readonly string[] = BIRD_IDS): Record<string, Mesh> {
  const out: Record<string, Mesh> = {};
  for (const id of ids) {
    const mesh = CreateBox(`bucket_${id}_${scene.meshes.length}`, { size: 1 }, scene);
    mesh.material = new PBRMaterial(`bucket_${id}_${scene.meshes.length}_mat`, scene);
    out[id] = mesh;
  }
  return out;
}


/** Just enough of a vitest spy for the buffer readers below — `vi.spyOn`'s own
 * return type infers its call tuple as `any[]`, which this project's
 * `noImplicitAny` rejects the moment a callback destructures one. */
type BufferSpy = { mock: { calls: unknown[][] } };

/** The last buffer of one kind the shell uploaded to a bucket. The buffers are
 * reused across frames, so the array a growth frame handed over IS the live
 * one — the `forestMeshes.test.ts` spy idiom. */
function uploaded(spy: BufferSpy, kind: string): Float32Array | undefined {
  const call = spy.mock.calls.filter((c) => c[0] === kind).pop();
  return call === undefined ? undefined : (call[1] as Float32Array);
}

/** Uniform scale baked into instance `i` of a matrix buffer: `ComposeToRef`
 * writes the scale into every rotation column, so a column's length is it. */
function instanceScale(buf: Float32Array, i: number): number {
  return Math.hypot(buf[i * 16]!, buf[i * 16 + 1]!, buf[i * 16 + 2]!);
}

/**
 * Bird poses only exist after a STEP. `createUnitState` seeds every member with
 * a ground-anchored placeholder pose (and `wing: 1`), and `stepUnit` returns
 * early on the tick a state was created — so the first update at the creation
 * tick renders those placeholders, and only the second update shows birds on
 * their loops. Every bird case below therefore runs two updates.
 */
function flying(
  scene: Scene, weather = WEATHER_PRESETS.clear, ids: readonly string[] = BIRD_IDS,
  camX = BIRD_CAM_X, camZ = BIRD_CAM_Z,
) {
  const birds = fakeBirds(scene, ids);
  const spies = new Map<string, BufferSpy>();
  for (const id of ids) spies.set(id, vi.spyOn(birds[id]!, "thinInstanceSetBuffer"));
  const w = createWildlifeMeshes(scene, SEED, { birds });
  w.update(camX, camZ, 1000, FAR_AWAY, weather, 12);
  w.update(camX, camZ, 1001, FAR_AWAY, weather, 12);
  return { w, birds, spies };
}

/** Every unit of one bird species in the bird camera's disc. */
function birdUnits(species: number) {
  return wildlifeUnitsInDisc(SEED, BIRD_CAM_X, BIRD_CAM_Z).filter((u) => u.species === species);
}

describe("bird thin instances", () => {
  it("maps every bird species to a model and gives each its own beat", () => {
    expect(BIRD_ASSET).toHaveLength(SPECIES_COUNT);
    expect(BIRD_OMEGA).toHaveLength(SPECIES_COUNT);
    expect(BIRD_ASSET.slice(0, FIRST_BIRD_SPECIES).every((id) => id === null)).toBe(true);
    expect(BIRD_ASSET.slice(FIRST_BIRD_SPECIES)).toEqual([
      "wildlife.raven", "wildlife.raven", "wildlife.gull", "wildlife.eagle", "wildlife.butterfly",
    ]);
    // Every ω is an exact multiple of 2π / WING_TIME_WRAP, which is what makes
    // the shader's time wrap phase-continuous — a raven at 3 Hz, a gull at 2.5,
    // an eagle that soars, a butterfly at 12.
    for (const omega of BIRD_OMEGA) {
      expect(((omega * WING_TIME_WRAP) / (2 * Math.PI)) % 1).toBeCloseTo(0, 9);
    }
    expect(BIRD_OMEGA[SPECIES_RAVEN_ROOST]).toBeCloseTo((2 * Math.PI * 900) / WING_TIME_WRAP, 9);
    expect(BIRD_OMEGA[SPECIES_RAVEN_PAIR]).toBe(BIRD_OMEGA[SPECIES_RAVEN_ROOST]);
    expect(BIRD_OMEGA[SPECIES_GULL]).toBeCloseTo((2 * Math.PI * 750) / WING_TIME_WRAP, 9);
    expect(BIRD_OMEGA[SPECIES_EAGLE]).toBe(0);
    expect(BIRD_OMEGA[SPECIES_BUTTERFLY]).toBe(BUTTERFLY_OMEGA);
    // The perched bucket is nobody's flight model, so it takes no beat.
    expect(birdBucketOmega(BIRD_PERCHED_ASSET)).toBe(0);
    expect(birdBucketOmega("wildlife.raven")).toBe(BIRD_OMEGA[SPECIES_RAVEN_PAIR]);
    expect(birdBucketOmega(BIRD_ASSET[SPECIES_BUTTERFLY]!)).toBe(BUTTERFLY_OMEGA);
  });

  it("resolves the butterfly's model to code-built geometry, not a catalog entry", async () => {
    // `wildlifeField.ts`'s `SPECIES_BUTTERFLY` is the one bird-numbered species with no
    // shipped GLB behind its `BIRD_ASSET` id at all — so there is nothing in the catalog for
    // `loadBirdAssets` to fetch, and it has to build one instead.
    const assets = (catalog as { assets: { id: string }[] }).assets;
    expect(assets.some((a) => a.id === BIRD_ASSET[SPECIES_BUTTERFLY])).toBe(false);

    // That is a fact about the DATA, and on its own it is worth very little: it stays true
    // whether or not the code that builds the butterfly exists. What follows runs the real
    // production path — no `options.birds`, so `createWildlifeMeshes` calls `loadBirdAssets`
    // for itself — and that is the only test in this file that does. Without it the whole
    // branch resolving this id to code-built geometry can be deleted with every wildlife
    // test still green, while `DIRECTOR_POOL` goes on handing out slots for an animal that
    // draws nothing and the director goes on logging each one as a sighting: exactly the
    // "credited for an animal never seen" defect the asset/pool check above exists to stop,
    // one layer underneath it.
    loaderStub.urls.length = 0;
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const { pool } = fakePool(scene, []);
    // A camera over a real flower drift, so the bucket is not merely built but filled.
    const bx = -372.65448356345297, bz = 691.559469884634;
    const w = createWildlifeMeshes(scene, SEED, { pool });
    // `loadBirdAssets` awaits each catalog bird in turn before it reaches the butterfly.
    await vi.waitFor(() => expect(scene.getMeshByName("wildlife_butterfly")).not.toBeNull());
    const mesh = scene.getMeshByName("wildlife_butterfly") as Mesh;

    // The geometry is the code-built card, and it is wearing the wing beat the bucket path
    // hands every bird — which is the whole claim this species makes: it rides that path.
    expect(mesh.getTotalVertices()).toBe(8);
    expect(mesh.getTotalIndices()).toBe(4 * 3);
    const plugin = mesh.material?.pluginManager?.getPlugin("Wing") as WingPlugin | undefined;
    expect(plugin?.omega).toBe(BUTTERFLY_OMEGA);
    expect(plugin?.halfSpan).toBeCloseTo(BUTTERFLY_BODY_HALF + BUTTERFLY_WING_SPAN, 6);

    // And it was ADOPTED, not merely constructed: the shell drives instances through it.
    w.update(bx, bz, 1000, FAR_AWAY, WEATHER_PRESETS.clear, 12);
    w.update(bx, bz, 1001, FAR_AWAY, WEATHER_PRESETS.clear, 12);
    expect(mesh.thinInstanceCount).toBeGreaterThan(0);

    // No GLB was fetched for it — the other four birds went down the fetch path (which is
    // what makes the absence meaningful rather than a loader that never ran at all).
    expect(loaderStub.urls.length).toBeGreaterThan(0);
    expect(loaderStub.urls.some((u) => u.includes("butterfly"))).toBe(false);

    // The material is created here rather than by a container, so nothing else would ever
    // free it: teardown has to, or every shell leaves one behind with its compiled effect.
    const material = mesh.material!;
    expect(scene.materials).toContain(material);
    w.dispose();
    expect(scene.materials).not.toContain(material);
    engine.dispose();
  });

  it("builds two 4 cm quads hinged on a 1 cm body, eight vertices, carrying a wing pattern", () => {
    const geo = butterflyGeometry();
    expect(geo.positions).toHaveLength(8 * 3);
    expect(geo.normals).toHaveLength(8 * 3);
    expect(geo.colors).toHaveLength(8 * 4);
    // Two quads, two triangles each.
    expect(geo.indices).toHaveLength(4 * 3);
    // The actual corners, not a range they happen to fall inside: four vertices on the hinge
    // at exactly half the body's width, four at the wingtip a full span beyond it, four on
    // each side of the body, and every one of them on the front or the back of the 3 cm
    // chord in the y = 0 plane. A bound of the form `|x| between hinge and tip` would be
    // just as happy with all eight vertices bunched in the middle of a wing.
    // A Float32Array epsilon, not a Float64 one: 0.045 itself is not exactly representable.
    const EPS = 1e-6;
    const near = (v: number, want: number): boolean => Math.abs(v - want) <= EPS;
    const tip = BUTTERFLY_BODY_HALF + BUTTERFLY_WING_SPAN;
    const halfChord = BUTTERFLY_WING_CHORD / 2;
    let hinges = 0, tips = 0, right = 0, front = 0;
    for (let i = 0; i < 8; i++) {
      const x = geo.positions[i * 3]!, y = geo.positions[i * 3 + 1]!, z = geo.positions[i * 3 + 2]!;
      if (near(Math.abs(x), BUTTERFLY_BODY_HALF)) hinges++;
      else if (near(Math.abs(x), tip)) tips++;
      else expect.fail(`vertex ${i} sits at x = ${x}, neither the hinge nor the tip`);
      if (x > 0) right++;
      expect(near(y, 0)).toBe(true);
      expect(near(Math.abs(z), halfChord)).toBe(true);
      if (z > 0) front++;
      // The wing plugin divides by the half span and the card faces up: both are the
      // geometry's job to supply.
      expect(geo.normals[i * 3 + 1]).toBe(1);
    }
    expect([hinges, tips, right, front]).toEqual([4, 4, 4, 4]);

    // The pattern: a real gradient across each wing, not one flat colour delivered through a
    // vertex buffer. Both wings wear it, mirrored, and it is colourless — the hue arrives
    // per instance, so a pattern with a cast of its own would tint the tips twice.
    const shade = (i: number): number => geo.colors[i * 4]!;
    for (let i = 0; i < 8; i++) {
      expect(geo.colors[i * 4 + 1]).toBe(shade(i)); // grey: r = g = b
      expect(geo.colors[i * 4 + 2]).toBe(shade(i));
      expect(geo.colors[i * 4 + 3]).toBe(1);
      expect(shade(i)).toBe(shade((i + 4) % 8)); // the left wing repeats the right one's
    }
    // Hinge darker than tip, trailing half darker than leading, by a margin a player could
    // actually see rather than a rounding error.
    expect(shade(1) - shade(0)).toBeGreaterThan(0.2); // tip-front over hinge-front
    expect(shade(2) - shade(3)).toBeGreaterThan(0.2); // tip-back over hinge-back
    expect(shade(1) - shade(2)).toBeGreaterThan(0.1); // front over back at the tip
  });

  it("offers three colourways that differ by more than a rounding error, and wraps on the index", () => {
    expect(BUTTERFLY_COLOURWAYS).toHaveLength(3);
    for (let i = 0; i < BUTTERFLY_COLOURWAYS.length; i++) {
      for (let j = i + 1; j < BUTTERFLY_COLOURWAYS.length; j++) {
        const a = BUTTERFLY_COLOURWAYS[i]!, b = BUTTERFLY_COLOURWAYS[j]!;
        // Distinct CREATURES, which is a visible distance apart, not `not.toEqual` — that
        // would pass on one ulp. The nearest pair here is about 0.79 apart in RGB.
        const distance = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
        expect(distance, `colourways ${i} and ${j}`).toBeGreaterThan(0.4);
        // And no pair may hide its whole difference in one channel.
        const perChannel = [Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2])].sort((p, q) => q - p);
        expect(perChannel[1]!, `colourways ${i} and ${j}, second channel`).toBeGreaterThan(0.05);
      }
    }
    // Wraps rather than throwing on an out-of-range index — a caller drawing one need not
    // know how many there are, in either direction.
    expect(butterflyColourway(3)).toEqual(BUTTERFLY_COLOURWAYS[0]);
    expect(butterflyColourway(-1)).toEqual(BUTTERFLY_COLOURWAYS[2]);
    expect(butterflyColourway(2.9)).toEqual(BUTTERFLY_COLOURWAYS[2]);
  });

  it("draws a natural butterfly through the same bird card path as a real bird", () => {
    // A real flower-cell butterfly at seed 388817 — found by a census, not guessed, so this
    // exercises the field's own habitat gate together with the render path rather than a
    // hand-placed stand-in for one.
    const bx = -372.65448356345297, bz = 691.559469884634;
    const natural = wildlifeUnitsInDisc(SEED, bx, bz).filter((u) => u.species === SPECIES_BUTTERFLY);
    expect(natural.length).toBeGreaterThan(0);

    const engine = new NullEngine();
    const scene = new Scene(engine);
    const butterflyId = BIRD_ASSET[SPECIES_BUTTERFLY]!;
    const { birds, spies } = flying(scene, WEATHER_PRESETS.clear, [...BIRD_IDS, butterflyId], bx, bz);
    // It rides the bucket its own asset id names — not the raven's, not the gull's.
    expect(birds[butterflyId]!.thinInstanceCount).toBeGreaterThan(0);
    const buf = uploaded(spies.get(butterflyId)!, "matrix")!;
    const wing = uploaded(spies.get(butterflyId)!, "wing")!;
    for (let i = 0; i < birds[butterflyId]!.thinInstanceCount; i++) {
      const x = buf[i * 16 + 12]!, y = buf[i * 16 + 13]!, z = buf[i * 16 + 14]!;
      const groundH = elevationAt(SEED, x, z);
      // The pose stays inside BUTTERFLY_ALT above the ground it is currently over.
      expect(y - groundH).toBeGreaterThanOrEqual(0.3 - 1e-6);
      expect(y - groundH).toBeLessThanOrEqual(1.5 + 1e-6);
      // Inside its own disc, like every other bird bucket.
      expect(Math.hypot(x - bx, z - bz)).toBeLessThanOrEqual(WILDLIFE_RADIUS[SPECIES_BUTTERFLY]!);
      // The wing plugin's per-instance amplitude — always fluttering, never a glide.
      expect(wing[i * 2 + 1]).toBe(1);
    }
  });

  it("gives each butterfly one of the three colourways, per instance over the shared bucket", () => {
    // Every butterfly in the world rides ONE bucket built from ONE geometry, so a colour in
    // the vertices would be the colour of all of them. The colourway travels as a
    // per-instance tint instead — Babylon's own `color` thin-instance kind, which reaches
    // the shader as `instanceColor` and multiplies the pattern in the vertex colours.
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const butterflyId = BIRD_ASSET[SPECIES_BUTTERFLY]!;
    // A real flower meadow that holds six natural butterflies inside one 40 m disc — found
    // by scanning the seed for them, not guessed. Butterflies are the sparsest species in
    // the world (`WILDLIFE_D`'s census: nine discs in ten hold none at all), so a camera
    // dropped somewhere plausible would most often see one insect or zero, and a population
    // is what this case needs.
    const { birds, spies } = flying(scene, WEATHER_PRESETS.clear, [...BIRD_IDS, butterflyId], 305, 215);
    const count = birds[butterflyId]!.thinInstanceCount;
    expect(count).toBeGreaterThan(3);
    // The two facts Babylon reads to switch on `INSTANCESCOLOR` — the define that declares
    // the `instanceColor` attribute and multiplies the vertex colour by it. A buffer
    // uploaded under a kind the shader never binds would satisfy every other assertion here
    // and still leave every butterfly the colour of its bare pattern.
    expect(birds[butterflyId]!.isVerticesDataPresent("instanceColor")).toBe(true);
    expect(birds[butterflyId]!.hasThinInstances).toBe(true);
    const tint = uploaded(spies.get(butterflyId)!, "color")!;
    expect(tint).toBeDefined();
    const seen = new Set<number>();
    for (let i = 0; i < count; i++) {
      const rgb = [tint[i * 4]!, tint[i * 4 + 1]!, tint[i * 4 + 2]!];
      expect(tint[i * 4 + 3]).toBe(1); // opaque: the tint is a hue, never a fade
      const which = BUTTERFLY_COLOURWAYS.findIndex((c) => c.every((v, k) => Math.abs(v - rgb[k]!) < 1e-6));
      expect(which, `instance ${i} tint ${rgb.join(",")} is not one of the colourways`).toBeGreaterThanOrEqual(0);
      seen.add(which);
    }
    // All three actually reach the world. Before the tint buffer existed the geometry carried
    // one baked colour and two unreachable alternatives, and every butterfly in the world was
    // the same orange — which no assertion on the colour table alone can tell apart from this.
    expect([...seen].sort()).toEqual([0, 1, 2]);
    expect(butterflyColourway(0)).toEqual(BUTTERFLY_COLOURWAYS[0]);
    engine.dispose();
  });

  it("gives the birds no tint buffer at all — only the butterfly needs one", () => {
    // A raven is the colour its model says it is, and a per-instance buffer nothing reads is
    // still a buffer uploaded and bound every frame the flock grows.
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const { spies } = flying(scene);
    for (const id of BIRD_IDS) expect(uploaded(spies.get(id)!, "color")).toBeUndefined();
    engine.dispose();
  });

  it("emits one instance per bird pose in the disc and culls the rest at its edge", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const { w, birds, spies } = flying(scene);

    // Raven pairs: both members of every pair, in the flying raven bucket. The
    // roosts share that bucket but are all perched here (no player near any of
    // them), so nothing else lands in it.
    const pairs = birdUnits(SPECIES_RAVEN_PAIR);
    expect(pairs.length).toBeGreaterThan(0);
    expect(birds["wildlife.raven"]!.thinInstanceCount).toBe(2 * pairs.length);

    // Gulls and eagles loop up to 50 m and 140 m from their anchors, so the
    // discs' rims cut some members off. That is the cull, not a fade: the
    // design fades ground animals and culls birds.
    const gullPoses = birdUnits(SPECIES_GULL).reduce((n, u) => n + u.members, 0);
    const eaglePoses = birdUnits(SPECIES_EAGLE).reduce((n, u) => n + u.members, 0);
    expect(birds["wildlife.gull"]!.thinInstanceCount).toBeGreaterThan(0);
    expect(birds["wildlife.gull"]!.thinInstanceCount).toBeLessThan(gullPoses);
    expect(birds["wildlife.eagle"]!.thinInstanceCount).toBeLessThan(eaglePoses);

    // And what survives is inside the disc, to the metre — the invariant the
    // two counts above are only evidence of.
    for (const [species, id] of [[SPECIES_GULL, "wildlife.gull"], [SPECIES_EAGLE, "wildlife.eagle"], [SPECIES_RAVEN_PAIR, "wildlife.raven"]] as const) {
      const buf = uploaded(spies.get(id)!, "matrix");
      expect(buf).toBeDefined();
      const r = WILDLIFE_RADIUS[species]!;
      for (let i = 0; i < birds[id]!.thinInstanceCount; i++) {
        const d = Math.hypot(buf![i * 16 + 12]! - BIRD_CAM_X, buf![i * 16 + 14]! - BIRD_CAM_Z);
        expect(d).toBeLessThanOrEqual(r);
      }
    }
    w.dispose();
    engine.dispose();
  });

  it("perches a resting roost on its snag and shows the second half of the roosts only under dread", () => {
    // The raven ×2 rule. wildlifeField.ts places roosts to TWICE their density
    // and tags each with `presenceDraw = draw / D`; the shell shows a roost only
    // while that draw is under the live raven presence, so `clear` gets the
    // first half and dread both — no second walk of the field, and no roost that
    // grew to twice its size.
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const roosts = birdUnits(SPECIES_RAVEN_ROOST);
    const firstHalf = roosts.filter((u) => u.presenceDraw < 1).reduce((n, u) => n + u.members, 0);
    const everyRoost = roosts.reduce((n, u) => n + u.members, 0);
    expect(firstHalf).toBeGreaterThan(0);
    expect(everyRoost).toBeGreaterThan(firstHalf);

    const clear = flying(scene);
    expect(clear.birds[BIRD_PERCHED_ASSET]!.thinInstanceCount).toBe(firstHalf);
    // Perched, not flying: nothing of a resting roost reaches the raven bucket.
    const pairs = birdUnits(SPECIES_RAVEN_PAIR);
    expect(clear.birds["wildlife.raven"]!.thinInstanceCount).toBe(2 * pairs.length);
    // On the snag, at perch height — not on the ground under it.
    const perchBuf = uploaded(clear.spies.get(BIRD_PERCHED_ASSET)!, "matrix")!;
    const snags = new Set(roosts.map((u) => `${u.homeX.toFixed(3)}:${u.homeZ.toFixed(3)}`));
    let onASnag = 0;
    for (let i = 0; i < clear.birds[BIRD_PERCHED_ASSET]!.thinInstanceCount; i++) {
      const x = perchBuf[i * 16 + 12]!;
      const z = perchBuf[i * 16 + 14]!;
      const near = roosts.find((u) => Math.hypot(u.homeX - x, u.homeZ - z) <= 1);
      expect(near).toBeDefined();
      expect(perchBuf[i * 16 + 13]!).toBeGreaterThan(near!.homeH + 1);
      onASnag++;
    }
    expect(onASnag).toBe(firstHalf);
    expect(snags.size).toBeGreaterThan(0);
    clear.w.dispose();

    const dread = flying(scene, WEATHER_PRESETS.eerie);
    expect(dread.birds[BIRD_PERCHED_ASSET]!.thinInstanceCount).toBe(everyRoost);
    // Doubling the ROOSTS, never their size: a raven under dread is still a
    // raven, so the presence that gated them in is capped at 1 for scale.
    const dreadBuf = uploaded(dread.spies.get(BIRD_PERCHED_ASSET)!, "matrix")!;
    for (let i = 0; i < dread.birds[BIRD_PERCHED_ASSET]!.thinInstanceCount; i++) {
      expect(instanceScale(dreadBuf, i)).toBeCloseTo(1, 5);
    }
    dread.w.dispose();
    engine.dispose();
  });

  it("neither steps nor croaks a roost the raven gate hides", () => {
    // The gate thins ravens by COUNT, and it has to run BEFORE the state
    // machine — not just before the draw. A hidden roost that still stepped
    // would still lift and still push the `call` events wildlifeAudio voices at
    // the ravens' full gain (`callGain[raven]` is 1 at `clear`): a croak out of
    // a snag with nothing on it, and twice the raven call rate, since
    // `clear` hides half of every roost the field places at 2×D.
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const roosts = birdUnits(SPECIES_RAVEN_ROOST);
    // A roost never leaves its snag — `x`/`z` are its `homeX`/`homeZ` in the
    // field and `poseBirds` pins them back there every tick — so a croak's
    // position names the bird that made it exactly.
    const key = (x: number, z: number) => `${x}:${z}`;
    const hidden = new Set(roosts.filter((u) => u.presenceDraw >= 1).map((u) => key(u.homeX, u.homeZ)));
    const shown = new Set(roosts.filter((u) => u.presenceDraw < 1).map((u) => key(u.homeX, u.homeZ)));
    expect(hidden.size).toBeGreaterThan(0);
    expect(shown.size).toBeGreaterThan(0);

    // Two full croak slots (RAVEN_CROAK_INTERVAL's max, 60 s, is the slot), so
    // every roost in the disc gets more than one chance to fire.
    const croakedFrom = (weather: WeatherParams): Set<string> => {
      const w = createWildlifeMeshes(scene, SEED, { birds: {} });
      const from = new Set<string>();
      for (let tick = 1000; tick <= 1000 + 2 * 60 * 60; tick++) {
        w.update(BIRD_CAM_X, BIRD_CAM_Z, tick, FAR_AWAY, weather, 12);
        for (const e of w.events) {
          if (e.kind === "call" && e.species === SPECIES_RAVEN_ROOST) from.add(key(e.x, e.z));
        }
        w.events.length = 0;
      }
      w.dispose();
      return from;
    };

    const atClear = croakedFrom(WEATHER_PRESETS.clear);
    // Guards the emptiness below: the run really is long enough to hear roosts.
    expect(atClear.size).toBeGreaterThan(0);
    expect([...atClear].filter((k) => hidden.has(k))).toEqual([]);
    expect([...atClear].every((k) => shown.has(k))).toBe(true);
    // Under dread the gate opens on the second half, and those roosts call.
    const atDread = croakedFrom(WEATHER_PRESETS.eerie);
    expect([...atDread].some((k) => hidden.has(k))).toBe(true);
    engine.dispose();
  });

  it("carries the behaviour's wing amplitude and a per-bird phase into the `wing` buffer", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const { w, birds, spies } = flying(scene);
    const amps = (id: string) => {
      const buf = uploaded(spies.get(id)!, "wing");
      expect(buf).toBeDefined();
      const out: number[] = [];
      for (let i = 0; i < birds[id]!.thinInstanceCount; i++) out.push(buf![i * 2 + 1]!);
      expect(out.length).toBeGreaterThan(0);
      return out;
    };
    // A raven beats, an eagle soars, a perched raven holds its wings folded.
    expect(new Set(amps("wildlife.raven"))).toEqual(new Set([1]));
    expect(new Set(amps("wildlife.eagle"))).toEqual(new Set([0]));
    expect(new Set(amps(BIRD_PERCHED_ASSET))).toEqual(new Set([0]));
    // A gull alternates beats and glides on its own 2–5 s cadence, so a flock
    // shows both at once.
    expect(new Set(amps("wildlife.gull"))).toEqual(new Set([0, 1]));

    // Stride 2 — (phase, amp) — and a distinct phase per bird, so a flock does
    // not beat in lockstep. Uploaded once per kind, alongside the matrices.
    const wingCall = spies.get("wildlife.gull")!.mock.calls.filter((c) => c[0] === "wing").pop()!;
    expect(wingCall[2]).toBe(2);
    const buf = wingCall[1] as Float32Array;
    const n = birds["wildlife.gull"]!.thinInstanceCount;
    const phases = new Set<number>();
    for (let i = 0; i < n; i++) {
      expect(buf[i * 2]!).toBeGreaterThanOrEqual(0);
      expect(buf[i * 2]!).toBeLessThan(2 * Math.PI);
      phases.add(buf[i * 2]!);
    }
    expect(phases.size).toBe(n);
    // Two floats per instance, in lockstep with the 16 the matrix buffer holds.
    expect(buf.length).toBe((uploaded(spies.get("wildlife.gull")!, "matrix")!.length / 16) * 2);
    w.dispose();
    engine.dispose();
  });

  it("thins the sky under rain: gulls shrink to the aloft presence and half the ravens go", () => {
    // `aloft` = (1 − k)(1 − 0.7·rain) = 0.3 at rain 1, dread 0, and the
    // first update adopts the weather outright rather than ramping in from a
    // clear sky the player never saw.
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const { w, birds, spies } = flying(scene, WEATHER_PRESETS.rain);
    const gullBuf = uploaded(spies.get("wildlife.gull")!, "matrix")!;
    const gulls = birds["wildlife.gull"]!.thinInstanceCount;
    expect(gulls).toBeGreaterThan(0);
    for (let i = 0; i < gulls; i++) expect(instanceScale(gullBuf, i)).toBeCloseTo(0.3, 5);

    // Ravens thin by NUMBER instead — `raven` = 0.5 here, so the roosts and
    // pairs whose presence draw sits above it are simply absent.
    const roostsUnderRain = birdUnits(SPECIES_RAVEN_ROOST).filter((u) => u.presenceDraw < 0.5).reduce((n, u) => n + u.members, 0);
    const perched = birds[BIRD_PERCHED_ASSET]!.thinInstanceCount;
    expect(perched).toBe(roostsUnderRain);
    expect(perched).toBeGreaterThan(0);
    const clearRoosts = birdUnits(SPECIES_RAVEN_ROOST).filter((u) => u.presenceDraw < 1).reduce((n, u) => n + u.members, 0);
    expect(perched).toBeLessThan(clearRoosts);
    // Whatever survives is FULL SIZE: for ravens the thinning is entirely the
    // count. A half-scale raven is a
    // wrong-looking bird; half as many ravens is what rain actually means.
    const perchBuf = uploaded(spies.get(BIRD_PERCHED_ASSET)!, "matrix")!;
    for (let i = 0; i < perched; i++) expect(instanceScale(perchBuf, i)).toBeCloseTo(1, 5);
    // The flying ravens too, and by the same rule.
    const ravens = birds["wildlife.raven"]!.thinInstanceCount;
    const ravenBuf = uploaded(spies.get("wildlife.raven")!, "matrix")!;
    expect(ravens).toBeGreaterThan(0);
    expect(ravens).toBeLessThan(2 * birdUnits(SPECIES_RAVEN_PAIR).length);
    for (let i = 0; i < ravens; i++) expect(instanceScale(ravenBuf, i)).toBeCloseTo(1, 5);
    w.dispose();
    engine.dispose();
  });

  it("reuses its buffers frame to frame and never asks the shadow map for a bird", () => {
    // The clutter contract: buffers grow by doubling and are then written in
    // place, so a steady camera allocates nothing per frame — a fresh
    // `thinInstanceSetBuffer` per frame is exactly the per-frame allocation
    // this design rules out. And birds neither cast nor receive: it spends the
    // shadow budget on ground animals.
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const birds = fakeBirds(scene);
    const spy = vi.spyOn(birds["wildlife.gull"]!, "thinInstanceSetBuffer");
    const added: AbstractMesh[] = [];
    const w = createWildlifeMeshes(scene, SEED, {
      birds,
      shadows: { add: (m) => added.push(m), remove: () => {} },
    });
    for (let tick = 1000; tick < 1010; tick++) {
      w.update(BIRD_CAM_X, BIRD_CAM_Z, tick, FAR_AWAY, WEATHER_PRESETS.clear, 12);
    }
    // Two calls in all: the matrix and wing buffers, both from the one frame
    // that grew them.
    expect(spy.mock.calls.map((c) => c[0]).sort()).toEqual(["matrix", "wing"]);
    expect(birds["wildlife.gull"]!.thinInstanceCount).toBeGreaterThan(0);
    for (const id of BIRD_IDS) {
      expect(added).not.toContain(birds[id]!);
      expect(birds[id]!.receiveShadows).toBe(false);
      expect(birds[id]!.isPickable).toBe(false);
      // The beat itself, on the bucket's own material.
      expect(birds[id]!.material!.pluginManager?.getPlugin("Wing")).toBeInstanceOf(WingPlugin);
    }
    w.dispose();
    engine.dispose();
  });

  it("emits nothing for a species whose model is missing, and disposes no mesh it was handed", () => {
    // Production today: the catalog has no bird entries at all, so every bucket
    // is absent and the sky is simply empty — never a crash, and never a
    // `modelUrl` throw on an output that was never built.
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const birds = fakeBirds(scene, ["wildlife.gull"]);
    const w = createWildlifeMeshes(scene, SEED, { birds });
    w.update(BIRD_CAM_X, BIRD_CAM_Z, 1000, FAR_AWAY, WEATHER_PRESETS.clear, 12);
    w.update(BIRD_CAM_X, BIRD_CAM_Z, 1001, FAR_AWAY, WEATHER_PRESETS.clear, 12);
    expect(birds["wildlife.gull"]!.thinInstanceCount).toBeGreaterThan(0);
    w.dispose();
    // Meshes handed in belong to the caller — the `ownsPool` rule for the sky.
    expect(birds["wildlife.gull"]!.isDisposed()).toBe(false);
    engine.dispose();
  });

  it("leaves the sky empty when there are no buckets at all", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const w = createWildlifeMeshes(scene, SEED, { birds: {} });
    expect(() => {
      w.update(BIRD_CAM_X, BIRD_CAM_Z, 1000, FAR_AWAY, WEATHER_PRESETS.clear, 12);
      w.update(BIRD_CAM_X, BIRD_CAM_Z, 1001, FAR_AWAY, WEATHER_PRESETS.clear, 12);
    }).not.toThrow();
    w.dispose();
    engine.dispose();
  });
});

describe("bird bucket adoption", () => {
  it("adopts every mesh of a model's LOD0, not just the first", () => {
    // A model's primitives are merged by material, so
    // a bird authored with a second material — a beak, an eye, a feather sheet
    // — arrives as two primitives under one LOD0 root. Taking only the first
    // would drop half the bird with no error anywhere.
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const wings = CreateBox("wings", { width: 4, height: 0.2, depth: 1 }, scene);
    wings.material = new PBRMaterial("wings_mat", scene);
    const beak = CreateBox("beak", { size: 0.4 }, scene);
    beak.material = new PBRMaterial("beak_mat", scene);
    const w = createWildlifeMeshes(scene, SEED, { birds: { "wildlife.gull": [wings, beak] } });
    w.update(BIRD_CAM_X, BIRD_CAM_Z, 1000, FAR_AWAY, WEATHER_PRESETS.clear, 12);
    w.update(BIRD_CAM_X, BIRD_CAM_Z, 1001, FAR_AWAY, WEATHER_PRESETS.clear, 12);
    // Both halves of the bird carry the same flock.
    expect(wings.thinInstanceCount).toBeGreaterThan(0);
    expect(beak.thinInstanceCount).toBe(wings.thinInstanceCount);
    expect(wings.isEnabled()).toBe(true);
    expect(beak.isEnabled()).toBe(true);
    // And ONE wingspan across the whole bird: a per-mesh half span would give
    // the 0.4 m beak its own, and it would flap through the full amplitude
    // while the 4 m wings barely moved.
    const wingsPlugin = wings.material!.pluginManager!.getPlugin("Wing") as WingPlugin;
    const beakPlugin = beak.material!.pluginManager!.getPlugin("Wing") as WingPlugin;
    expect(wingsPlugin.halfSpan).toBeCloseTo(2, 6);
    expect(beakPlugin.halfSpan).toBe(wingsPlugin.halfSpan);
    w.dispose();
    engine.dispose();
  });

  it("takes every geometry mesh under LOD0 and nothing at all without one", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const container = new AssetContainer(scene);
    const root = new BabylonTransformNode("LOD0", scene);
    const a = CreateBox("body", { size: 1 }, scene);
    const b = CreateBox("beak", { size: 0.2 }, scene);
    const empty = new BabylonTransformNode("wrapper", scene);
    a.parent = root;
    b.parent = root;
    empty.parent = root;
    const lod1 = CreateBox("far_body", { size: 1 }, scene);
    const lod1Root = new BabylonTransformNode("LOD1", scene);
    lod1.parent = lod1Root;
    container.transformNodes.push(root, empty, lod1Root);
    container.meshes.push(a, b, lod1);
    const adopted = birdLodMeshes(container);
    expect(adopted).toContain(a);
    expect(adopted).toContain(b);
    // LOD1 is a different level and must never end up in the LOD0 bucket.
    expect(adopted).not.toContain(lod1);
    expect(adopted).toHaveLength(2);
    // Baked and detached: a thin instance composes as `world * instanceMatrix`,
    // so a leftover parent would move the whole flock.
    for (const mesh of adopted) expect(mesh.parent).toBeNull();

    // No LOD0 at all: no bucket, never an arbitrary mesh from elsewhere in the
    // container. The old fallback would have adopted the LOD1
    // mesh here and drawn the lowest level at full size.
    const noLod = new AssetContainer(scene);
    noLod.transformNodes.push(lod1Root);
    noLod.meshes.push(lod1);
    expect(birdLodMeshes(noLod)).toEqual([]);
    engine.dispose();
  });

  it("drops a bird outright at zero presence rather than drawing it at scale 0", () => {
    // Under dread `aloft` is 0; the ground path draws its
    // animals at scale 0 to keep a pooled slot warm, but a thin instance has no
    // slot to keep, so a zero-scale gull is a degenerate triangle and a buffer
    // stride for nothing.
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const { w, birds } = flying(scene, WEATHER_PRESETS.eerie);
    expect(birds["wildlife.gull"]!.thinInstanceCount).toBe(0);
    expect(birds["wildlife.eagle"]!.thinInstanceCount).toBe(0);
    expect(birds["wildlife.gull"]!.isEnabled()).toBe(false);
    // Ravens are the other half of the same weather: dread doubles the roosts.
    expect(birds[BIRD_PERCHED_ASSET]!.thinInstanceCount).toBeGreaterThan(0);
    w.dispose();
    engine.dispose();
  });
});
