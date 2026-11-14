import { describe, expect, it } from "vitest";
import "../../src/sim/passes/index.js";
import { CLUTTER_CLASS_COUNT, CLUTTER_GRASS, CLUTTER_GRASS_CELL, CLUTTER_MEADOW, CLUTTER_ROCK, type ClutterInstance } from "../../src/sim/clutter.js";
import { elevationSampleAt } from "../../src/sim/terrain.js";
import {
  CLUTTER_MEADOW_NEAR_IN, COVER_RAMP_CLASSES, clutterFadeEdges, clutterSeamEdges, coverBands, coverFarBand, createClutterCollector,
} from "../../src/game/clutterField.js";
import { CLUTTER_MODEL_IDS, FAR_LOD, FOLIAGE_BY_CLASS, NEAR_LOD, cutOf, cutsFor, instanceMatrixFor, trampleFrame, writeFoliage } from "../../src/game/clutterInstances.js";
import { clutterBucketFade, createClutterLists, type ClutterBucket } from "../../src/game/clutterLists.js";
import { FADE_NONE_IN } from "../../src/game/distanceFade.js";
import type { CullPose } from "../../src/game/grassCull.js";
import { finish } from "../../src/game/syncJobs.js";

const SEED = 1;
// Near the origin, where grass grows reliably.
const CAM = { x: 100, z: 100 };
/** Two models a class, the stones' each cut four ways. */
const ROWS = Array.from({ length: CLUTTER_CLASS_COUNT }, (_, cls) => 2 * cutsFor(cls));
const options = (over: { nearBlades?: boolean; cull?: boolean } = {}) => ({ radiusScale: 1, nearBlades: false, cull: false, rows: ROWS, ...over });

describe("the bands a clutter bucket fades across", () => {
  it("hand the near level to the far at the class's seam, and the far level out at its disc's edge", () => {
    for (let cls = 0; cls < CLUTTER_CLASS_COUNT; cls++) {
      const edge = clutterFadeEdges(cls, 0.6);
      const seam = clutterSeamEdges(cls, 0.6);
      expect(clutterBucketFade(cls, NEAR_LOD, 0.6, false), `class ${cls}`).toEqual([...FADE_NONE_IN, seam.start, seam.end]);
      expect(clutterBucketFade(cls, FAR_LOD, 0.6, false), `class ${cls}`).toEqual([seam.start, seam.end, edge.start, edge.end]);
    }
  });

  it("dither the meadow's near cards in from the eye under the blade field, and no other class's", () => {
    expect(clutterBucketFade(CLUTTER_MEADOW, NEAR_LOD, 1, true).slice(0, 2)).toEqual([...CLUTTER_MEADOW_NEAR_IN]);
    expect(clutterBucketFade(CLUTTER_MEADOW, FAR_LOD, 1, true)).toEqual(clutterBucketFade(CLUTTER_MEADOW, FAR_LOD, 1, false));
    expect(clutterBucketFade(CLUTTER_GRASS, NEAR_LOD, 1, true)).toEqual(clutterBucketFade(CLUTTER_GRASS, NEAR_LOD, 1, false));
  });
});

describe("the clutter's lists", () => {
  it("are one a class, a row of its models and cuts, and a level: the fade's bands on all, a tint on the classes that sway, the far level's ramp and far band", () => {
    const lists = createClutterLists(SEED, options());
    expect(lists.all.length).toBe(ROWS.reduce((sum, rows) => sum + rows * 2, 0));
    for (let cls = 0; cls < CLUTTER_CLASS_COUNT; cls++) {
      expect(lists.buckets[cls]!.length).toBe(ROWS[cls]);
      for (const perLod of lists.buckets[cls]!) {
        expect(perLod.map((bucket) => bucket.lod)).toEqual([NEAR_LOD, FAR_LOD]);
        for (const bucket of perLod) {
          expect(bucket.cls).toBe(cls);
          expect(bucket.list.streams).toEqual({ bands: true, foliage: FOLIAGE_BY_CLASS.has(cls), strength: false });
          expect(bucket.list.culled).toBe(false);
          expect(bucket.ramp).toBe(bucket.lod === FAR_LOD && COVER_RAMP_CLASSES.has(cls));
          expect(bucket.far).toEqual(bucket.lod === FAR_LOD ? coverFarBand(cls, 1) : null);
          expect(bucket.fade).toEqual(clutterBucketFade(cls, bucket.lod, 1, false));
        }
      }
    }
    // A class with no model takes no row unless it is given one.
    expect(createClutterLists(SEED, { ...options(), rows: CLUTTER_MODEL_IDS.map((ids) => ids.length) }).buckets.filter((rows) => rows.length === 0).length).toBe(3);
  });

  it("fill each list with its band's instances of its model and cut, in the collector's order, with the instance's matrix, bands and tint", () => {
    const lists = createClutterLists(SEED, options());
    finish(lists.rebuild(CAM.x, CAM.z));
    expect(lists.view).toEqual(CAM);
    const bands = createClutterCollector(SEED).collect(CAM.x, CAM.z, 1);
    const scratch = new Float32Array(16);
    const tint = new Float32Array(4);
    let listed = 0;
    const cursor = new Map<ClutterBucket, number>();
    for (let cls = 0; cls < CLUTTER_CLASS_COUNT; cls++) {
      const band = bands[cls]!;
      for (const [lod, instances] of [band.near, band.far].entries()) {
        for (const inst of instances as ClutterInstance[]) {
          const bucket = lists.buckets[cls]![inst.variant * cutsFor(cls) + cutOf(inst)]![lod]!;
          const i = cursor.get(bucket) ?? 0;
          cursor.set(bucket, i + 1);
          listed++;
          // Spot-checked one instance in thirty-two.
          if (listed % 32 !== 0) continue;
          const frame = trampleFrame(SEED, inst);
          instanceMatrixFor(inst, frame, scratch);
          const { list } = bucket;
          expect([...list.buf.subarray(i * 16, i * 16 + 16)]).toEqual([...scratch]);
          expect([...list.bands.subarray(i * 4, i * 4 + 4)]).toEqual([...coverBands(bucket.fade, bucket.ramp, bucket.far, inst.hash)].map(Math.fround));
          if (FOLIAGE_BY_CLASS.has(cls)) {
            writeFoliage(SEED, inst, tint, 0, frame);
            expect([...list.foliage.subarray(i * 4, i * 4 + 4)]).toEqual([...tint]);
          }
        }
      }
    }
    expect(listed).toBeGreaterThan(1000);
    for (const bucket of lists.all) expect(bucket.list.count).toBe(cursor.get(bucket) ?? 0);
    expect(lists.buckets[CLUTTER_ROCK]!.filter((perLod) => perLod.some((bucket) => bucket.list.count > 0)).length).toBeGreaterThan(2);
    expect(lists.buckets[CLUTTER_GRASS]![0]![NEAR_LOD]!.list.count).toBeGreaterThan(0);
  });

  it("cut the grass class's lists to the view where the tier asks, and no list otherwise", () => {
    const pose: CullPose = { x: CAM.x, y: elevationSampleAt(SEED, CAM.x, CAM.z).h + 1.7, z: CAM.z, yaw: 0, pitch: 0, roll: 0, fov: 1, aspect: 1.5 };
    const whole = createClutterLists(SEED, options());
    finish(whole.rebuild(CAM.x, CAM.z));
    const none: ClutterBucket[] = [];
    whole.cut(pose, (bucket) => void none.push(bucket));
    expect(none).toEqual([]);

    const lists = createClutterLists(SEED, options({ cull: true }));
    expect(lists.all.filter((bucket) => bucket.list.culled).map((bucket) => bucket.cls)).toEqual([CLUTTER_GRASS, CLUTTER_GRASS, CLUTTER_GRASS, CLUTTER_GRASS]);
    finish(lists.rebuild(CAM.x, CAM.z));
    const changed: ClutterBucket[] = [];
    lists.cut(pose, (bucket) => void changed.push(bucket));
    expect(changed.length).toBe(4);
    const grass = lists.buckets[CLUTTER_GRASS]!.flat();
    const kept = grass.reduce((sum, bucket) => sum + bucket.list.cull!.kept, 0);
    expect(kept).toBeGreaterThan(0);
    expect(kept).toBeLessThan(grass.reduce((sum, bucket) => sum + bucket.list.count, 0));
    // The same view cuts nothing again; a rebuild a cell away does.
    changed.length = 0;
    lists.cut(pose, (bucket) => void changed.push(bucket));
    expect(changed).toEqual([]);
    const before = lists.kept;
    finish(lists.rebuild(CAM.x + CLUTTER_GRASS_CELL, CAM.z));
    // A step of one cell computes the rim that came into range, not the discs again.
    expect(lists.kept - before).toBeLessThan(before / 4);
    lists.cut(pose, (bucket) => void changed.push(bucket));
    expect(changed.length).toBe(4);
  });
});
