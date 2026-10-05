/**
 * What the ground-cover shells (blades, duff, clutter) upload, read back off
 * `thinInstanceSetBuffer`, and what the fill as it stands would upload for a
 * set of lists, computed directly from the shells' own writers — the pair of
 * sides the byte-for-byte comparisons in `keptInstances.test.ts` and
 * `rebuildJobs.test.ts` hold against each other.
 */
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import { CLUTTER_BUSH, CLUTTER_FERN, CLUTTER_SHRUB, CLUTTER_WETPLANT, CLUTTER_CLASS_COUNT, CLUTTER_FLOWER, CLUTTER_GRASS, CLUTTER_MEADOW, type ClutterInstance } from "../../src/sim/clutter.js";
import { CLUTTER_SINK, cutOf, cutsFor, instanceMatrixFor, trampleFrame, writeFoliage } from "../../src/game/clutterMeshes.js";
import type { BladeTiers } from "../../src/game/bladeField.js";
import { bladeHeightScale, bladeMeshName } from "../../src/game/bladeMeshes.js";
import type { DuffTiers } from "../../src/game/duffField.js";
import { duffMeshName } from "../../src/game/duffMeshes.js";
import { clutterFadeEdges, clutterSeamEdges, type ClutterBands } from "../../src/game/clutterField.js";
import { fadeBands, writeFadeBands } from "../../src/game/distanceFadePlugin.js";

/** The one seed every comparison runs on. */
export const SEED = 1;

export type Spy = { mock: { calls: unknown[][]; instances: unknown[] } };
/** What a mesh uploads, one entry per `${mesh name}|${buffer kind}`, as the
 * bits of the live prefix (the instance count times the stride). */
export type Uploads = Map<string, Uint32Array>;

function latestBuffer(spy: Spy, mesh: Mesh, kind: string): Float32Array | null {
  for (let k = spy.mock.calls.length - 1; k >= 0; k--) {
    const call = spy.mock.calls[k]!;
    if (spy.mock.instances[k] === mesh && call[0] === kind) return call[1] as Float32Array;
  }
  return null;
}

/** The prefix of each buffer each mesh draws, copied: the buffers are reused
 * in place across rebuilds, so a later rebuild would rewrite a view. */
export function uploads(spy: Spy, meshes: readonly Mesh[], kinds: (mesh: Mesh) => [string, number][]): Uploads {
  const out: Uploads = new Map();
  for (const mesh of meshes) {
    for (const [kind, stride] of kinds(mesh)) {
      const buf = latestBuffer(spy, mesh, kind);
      const n = buf === null ? 0 : mesh.thinInstanceCount * stride;
      out.set(`${mesh.name}|${kind}`, new Uint32Array((buf ?? new Float32Array(0)).slice(0, n).buffer));
    }
  }
  return out;
}

/** Collects floats per upload key, in the order the present fill writes them. */
class Expected {
  private readonly acc = new Map<string, number[]>();
  constructor(keys: Iterable<string>) {
    for (const key of keys) this.acc.set(key, []);
  }
  push(key: string, values: ArrayLike<number>): void {
    const list = this.acc.get(key);
    if (list === undefined) throw new Error(`no upload ${key}`);
    for (let i = 0; i < values.length; i++) list.push(values[i]!);
  }
  done(): Uploads {
    const out: Uploads = new Map();
    for (const [key, list] of this.acc) out.set(key, new Uint32Array(new Float32Array(list).buffer));
    return out;
  }
}

/** Every key whose bits differ, with its first differing index. */
export function differences(actual: Uploads, expected: Uploads): string[] {
  const out: string[] = [];
  for (const [key, want] of expected) {
    const got = actual.get(key);
    if (got === undefined) {
      out.push(`${key}: missing`);
      continue;
    }
    if (got.length !== want.length) {
      out.push(`${key}: ${got.length} floats, want ${want.length}`);
      continue;
    }
    for (let i = 0; i < want.length; i++) {
      if (got[i] !== want[i]) {
        out.push(`${key}: float ${i} differs`);
        break;
      }
    }
  }
  for (const key of actual.keys()) if (!expected.has(key)) out.push(`${key}: unexpected`);
  return out;
}

export function totalFloats(u: Uploads): number {
  let n = 0;
  for (const v of u.values()) n += v.length;
  return n;
}

// ---------------------------------------------------------------- blades

export const BLADE_KINDS: [string, number][] = [["matrix", 16], ["foliage", 4], ["bladeStrength", 1]];

/** The buffers the present blade fill writes for `tiers`, computed directly. */
export function expectedBlades(meshes: readonly Mesh[], tiers: BladeTiers): Uploads {
  const keys: string[] = [];
  for (const mesh of meshes) for (const [kind] of BLADE_KINDS) keys.push(`${mesh.name}|${kind}`);
  const e = new Expected(keys);
  const m = new Float32Array(16);
  const f = new Float32Array(4);
  const lists = [tiers.fine, tiers.mid, tiers.coarse];
  for (let t = 0; t < 3; t++) {
    for (const c of lists[t]!) {
      const name = bladeMeshName(c.character, t, c.size);
      const frame = trampleFrame(SEED, c);
      const heightScale = bladeHeightScale(c.strength, c.canopy);
      instanceMatrixFor(c, { height: frame.height * heightScale, lean: frame.lean, ax: frame.ax, az: frame.az, tint: frame.tint }, m);
      writeFoliage(SEED, c, f, 0, frame);
      e.push(`${name}|matrix`, m);
      e.push(`${name}|foliage`, f);
      e.push(`${name}|bladeStrength`, [c.strength]);
    }
  }
  return e.done();
}

// ---------------------------------------------------------------- duff

export const DUFF_KINDS: [string, number][] = [["matrix", 16], ["foliage", 4], ["bladeStrength", 1]];

export function expectedDuff(meshes: readonly Mesh[], tiers: DuffTiers): Uploads {
  const keys: string[] = [];
  for (const mesh of meshes) for (const [kind] of DUFF_KINDS) keys.push(`${mesh.name}|${kind}`);
  const e = new Expected(keys);
  const m = new Float32Array(16);
  const f = new Float32Array(4);
  const lists = [tiers.near, tiers.far];
  for (let t = 0; t < 2; t++) {
    for (const c of lists[t]!) {
      const name = duffMeshName(c.character, t);
      const frame = trampleFrame(SEED, c);
      instanceMatrixFor(c, frame, m);
      m[13] = m[13]! + CLUTTER_SINK;
      writeFoliage(SEED, c, f, 0, frame);
      e.push(`${name}|matrix`, m);
      e.push(`${name}|foliage`, f);
      e.push(`${name}|bladeStrength`, [c.strength]);
    }
  }
  return e.done();
}

// ---------------------------------------------------------------- clutter

export const TINTED = new Set([CLUTTER_GRASS, CLUTTER_MEADOW, CLUTTER_FLOWER, CLUTTER_BUSH, CLUTTER_FERN, CLUTTER_SHRUB, CLUTTER_WETPLANT]);
const VARIANTS = 2;

function baseName(cls: number, variant: number, lod: number): string {
  return `keep-c${cls}v${variant}l${lod}`;
}
/** The mesh name of the bucket an instance lands in: `bucketFor`'s rule on
 * these assets (two variants a class, the fallback to variant 0 past them),
 * with the cut classes' meshes named by their cut. */
function bucketName(inst: ClutterInstance, lod: number): string {
  const cuts = cutsFor(inst.cls);
  let index = inst.variant * cuts + cutOf(inst);
  if (index >= VARIANTS * cuts) index = 0;
  const variant = Math.floor(index / cuts), cut = index % cuts;
  return cuts > 1 ? `${baseName(inst.cls, variant, lod)}_cut${cut}` : baseName(inst.cls, variant, lod);
}
export function clutterKinds(mesh: Mesh): [string, number][] {
  const cls = Number(/^keep-c(\d+)/.exec(mesh.name)![1]);
  return TINTED.has(cls) ? [["matrix", 16], ["fadeBands", 4], ["foliage", 4]] : [["matrix", 16], ["fadeBands", 4]];
}

export function expectedClutter(meshes: readonly Mesh[], bands: ClutterBands): Uploads {
  const keys: string[] = [];
  for (const mesh of meshes) for (const [kind] of clutterKinds(mesh)) keys.push(`${mesh.name}|${kind}`);
  const e = new Expected(keys);
  const m = new Float32Array(16);
  const f = new Float32Array(4);
  const b = new Float32Array(4);
  for (let cls = 0; cls < CLUTTER_CLASS_COUNT; cls++) {
    const edge = clutterFadeEdges(cls, 1);
    const seam = clutterSeamEdges(cls, 1);
    const fades = [fadeBands(null, [seam.start, seam.end]), fadeBands([seam.start, seam.end], [edge.start, edge.end])];
    const lists = [bands[cls]!.near, bands[cls]!.far];
    for (let lod = 0; lod < 2; lod++) {
      for (const inst of lists[lod]!) {
        const name = bucketName(inst, lod);
        const frame = trampleFrame(SEED, inst);
        instanceMatrixFor(inst, frame, m);
        e.push(`${name}|matrix`, m);
        writeFadeBands(b, 0, fades[lod]!);
        e.push(`${name}|fadeBands`, b);
        if (TINTED.has(cls)) {
          writeFoliage(SEED, inst, f, 0, frame);
          e.push(`${name}|foliage`, f);
        }
      }
    }
  }
  return e.done();
}

/**
 * A NullEngine scene with a box per class, variant and LOD in place of the
 * clutter's models (two variants a class, alpha-tested like the cards), for
 * `createClutterMeshes`'s `assets`, and a filter that picks out the meshes it
 * fills: every class's own, except the cut classes', whose buckets are the
 * cut copies.
 */
export function clutterScene(): { engine: NullEngine; scene: Scene; assets: Mesh[][][][]; bucketMeshes: () => Mesh[] } {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const assets: Mesh[][][][] = [];
  for (let cls = 0; cls < CLUTTER_CLASS_COUNT; cls++) {
    assets.push([0, 1].map((variant) => {
      const material = new PBRMaterial(`keep-c${cls}v${variant}`, scene);
      material.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHATEST;
      return [0, 1].map((lod) => {
        const mesh = CreateBox(baseName(cls, variant, lod), { size: 0.5 }, scene);
        mesh.material = material;
        return [mesh];
      });
    }));
  }
  const bucketMeshes = (): Mesh[] =>
    scene.meshes.filter((mesh): mesh is Mesh => {
      const match = /^keep-c(\d+)v\d+l\d+(_cut\d)?$/.exec(mesh.name);
      return mesh instanceof Mesh && match !== null && (cutsFor(Number(match[1])) > 1) === (match[2] !== undefined);
    });
  return { engine, scene, assets, bucketMeshes };
}
