import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import type { Matrix } from "@babylonjs/core/Maths/math.vector.js";
import { loadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader.js";
import { registerBuiltInLoaders } from "@babylonjs/loaders/dynamic.js";
import {
  ROCK_CAP_SHARE, ROCK_CUTS, ROCK_DEPTH, ROCK_PLANES,
  rockPlaneCandidates, rockPlanes, rockRelief, type RockArrays, type RockPlane,
} from "../../src/game/rockRelief.js";
import { CLUTTER_SINK } from "../../src/game/clutterMeshes.js";
import { CLUTTER_BOULDER_SCALE_MAX, CLUTTER_ROCK_SCALE_MAX } from "../../src/sim/clutter.js";
import { BOULDER_A_BASE_H, BOULDER_B_BASE_H, BOULDER_SINK } from "../../src/sim/passes/clutter.js";

/**
 * The cut, run on the four models the game actually ships, rather than on the
 * synthetic sphere `rockRelief.test.ts` uses.
 *
 * This file exists because a sphere cannot see the failure that matters most
 * here. Every vertex of a sphere sits at the same distance from its centroid,
 * so a plane offset by that one global distance slices the same cap in every
 * direction and all ten candidates survive. A real rock is strongly
 * anisotropic, and against an earlier version that offset its planes by that
 * single global number, only 22 of 320 candidate planes across these four
 * models survived the cap-share rule — seven of the sixteen shipped cut
 * buckets kept none at all, and `boulder_a`'s four "cuts" came out as one
 * solid with four different noise seeds. The suite was green throughout.
 * Nothing short of the shipped geometry can hold the cut to what the design
 * promises, so this file asserts those promises on the shipped geometry.
 *
 * The arrays come through the same path production uses — the glTF loader into
 * a `NullEngine` scene, then the LOD root's world matrix baked into the
 * vertices, exactly as `clutterMeshes.ts`'s `lodMeshes` does before handing
 * them to `reliefMesh`. That matters: the loader mirrors a glTF model on z for
 * a left-handed scene, so the arrays a hand-rolled GLB reader would produce
 * are not the arrays the cut sees. `catalogModels.test.ts` reads the same
 * bytes the same way.
 */

registerBuiltInLoaders();

/**
 * The four cut models, with the class index the shell keys their planes on
 * (`cls * 16 + variant`, see `expandCutVariants`) so these are the very plane
 * lists the game builds, and with the burial each class gives them — a flat
 * `CLUTTER_SINK` for a rock, a deep per-variant seat for a boulder, both
 * taken from the modules that own them rather than restated here. `height` is
 * the collider's own `BASE_H` for the boulders, which is what the box that
 * must keep matching the mesh is sized from.
 */
const MODELS = [
  { name: "rock_a", file: "clutter.rock_a.glb", model: 1 * 16 + 0, height: 0, scaleMax: CLUTTER_ROCK_SCALE_MAX, sink: () => CLUTTER_SINK },
  { name: "rock_b", file: "clutter.rock_b.glb", model: 1 * 16 + 1, height: 0, scaleMax: CLUTTER_ROCK_SCALE_MAX, sink: () => CLUTTER_SINK },
  { name: "boulder_a", file: "clutter.boulder_a.glb", model: 2 * 16 + 0, height: BOULDER_A_BASE_H, scaleMax: CLUTTER_BOULDER_SCALE_MAX, sink: (s: number) => BOULDER_SINK * BOULDER_A_BASE_H * s },
  { name: "boulder_b", file: "clutter.boulder_b.glb", model: 2 * 16 + 1, height: BOULDER_B_BASE_H, scaleMax: CLUTTER_BOULDER_SCALE_MAX, sink: (s: number) => BOULDER_SINK * BOULDER_B_BASE_H * s },
] as const;

const LODS = ["LOD0", "LOD1"] as const;

type Loaded = { name: string; model: number; lod: string; arrays: RockArrays };

const loaded: Loaded[] = [];

/** `lodMeshes`' own idiom: the geometry mesh under the named LOD root, with
 * its world matrix (the loader's handedness mirror included) baked in. */
async function loadLod(file: string, lodName: string): Promise<RockArrays> {
  const bytes = readFileSync(new URL(`../../assets/models/${file}`, import.meta.url));
  const engine = new NullEngine();
  try {
    const scene = new Scene(engine);
    const container = await loadAssetContainerAsync(new Uint8Array(bytes), scene, { pluginExtension: ".glb" });
    container.addAllToScene();
    const root = [...container.transformNodes, ...container.meshes].find((node) => node.name === lodName);
    expect(root, `${file} has no ${lodName} root`).toBeDefined();
    const mesh = container.meshes.find((m): m is Mesh => m instanceof Mesh && m.getTotalVertices() > 0 && m.isDescendantOf(root!));
    expect(mesh, `${file} ${lodName} has no geometry mesh`).toBeDefined();
    mesh!.bakeTransformIntoVertices(mesh!.computeWorldMatrix(true) as Matrix);
    return {
      positions: mesh!.getVerticesData(VertexBuffer.PositionKind) as Float32Array,
      normals: mesh!.getVerticesData(VertexBuffer.NormalKind) as Float32Array,
      uvs: mesh!.getVerticesData(VertexBuffer.UVKind) as Float32Array | null,
      indices: Uint32Array.from(mesh!.getIndices() as ArrayLike<number>),
    };
  } finally {
    engine.dispose();
  }
}

beforeAll(async () => {
  for (const m of MODELS) {
    for (const lod of LODS) loaded.push({ name: m.name, model: m.model, lod, arrays: await loadLod(m.file, lod) });
  }
}, 120000);

function arraysFor(name: string, lod: string): RockArrays {
  const hit = loaded.find((l) => l.name === name && l.lod === lod);
  if (hit === undefined) throw new Error(`no arrays for ${name} ${lod}`);
  return hit.arrays;
}

function centroidOf(positions: Float32Array): [number, number, number] {
  const n = positions.length / 3;
  let cx = 0, cy = 0, cz = 0;
  for (let v = 0; v < n; v++) { cx += positions[v * 3]!; cy += positions[v * 3 + 1]!; cz += positions[v * 3 + 2]!; }
  return [cx / n, cy / n, cz / n];
}

/** Recomputed here rather than imported, so the assertions below measure the
 * cut's caps independently of the arithmetic the cut used to judge them. */
function capShareOf(positions: Float32Array, plane: RockPlane): number {
  const n = positions.length / 3;
  let took = 0;
  for (let v = 0; v < n; v++) {
    if (positions[v * 3]! * plane.nx + positions[v * 3 + 1]! * plane.ny + positions[v * 3 + 2]! * plane.nz > plane.d) took++;
  }
  return took / n;
}

function extentOf(positions: Float32Array): [number, number, number] {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let v = 0; v < positions.length / 3; v++) {
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k]!, positions[v * 3 + k]!);
      hi[k] = Math.max(hi[k]!, positions[v * 3 + k]!);
    }
  }
  return [hi[0]! - lo[0]!, hi[1]! - lo[1]!, hi[2]! - lo[2]!];
}

/** The model's reach in `dir` — the support function, which IS its outline
 * seen from that direction. Two solids with the same support function in every
 * direction have the same silhouette from every angle. */
function supportIn(positions: Float32Array, dir: [number, number, number]): number {
  let best = -Infinity;
  for (let v = 0; v < positions.length / 3; v++) {
    best = Math.max(best, positions[v * 3]! * dir[0] + positions[v * 3 + 1]! * dir[1] + positions[v * 3 + 2]! * dir[2]);
  }
  return best;
}

/** A fixed spiral of directions on the sphere — deterministic, no seeding. */
const PROBE_DIRS: [number, number, number][] = Array.from({ length: 128 }, (_, i) => {
  const z = 1 - (2 * i + 1) / 128;
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  const phi = i * Math.PI * (3 - Math.sqrt(5));
  return [r * Math.cos(phi), r * Math.sin(phi), z];
});

describe("the cut on the shipped rock and boulder models", () => {
  it("keeps planes on every cut of every model, so a cut is a cut and not a no-op", () => {
    for (const { name, model } of MODELS) {
      const positions = arraysFor(name, "LOD0").positions;
      for (let cut = 0; cut < ROCK_CUTS; cut++) {
        const planes = rockPlanes(model, cut, positions);
        // This floor is the whole reason the file exists. The models measure
        // 6 to 10 of the ten candidates; four leaves room to move without
        // letting the count fall back toward the nothing-at-all that an
        // offset keyed to one global radius produced.
        expect(planes.length, `${name} cut${cut}`).toBeGreaterThanOrEqual(4);
        expect(planes.length, `${name} cut${cut}`).toBeLessThanOrEqual(ROCK_PLANES);
      }
    }
  });

  it("offsets each plane by the model's own reach along that plane's normal", () => {
    for (const { name, model } of MODELS) {
      const positions = arraysFor(name, "LOD0").positions;
      const [cx, cy, cz] = centroidOf(positions);
      for (let cut = 0; cut < ROCK_CUTS; cut++) {
        for (const plane of rockPlaneCandidates(model, cut, positions)) {
          let support = 0;
          for (let v = 0; v < positions.length / 3; v++) {
            support = Math.max(support, (positions[v * 3]! - cx) * plane.nx + (positions[v * 3 + 1]! - cy) * plane.ny + (positions[v * 3 + 2]! - cz) * plane.nz);
          }
          expect(support, `${name} cut${cut}`).toBeGreaterThan(0);
          // The depth the offset implies, read back out of the plane: it has
          // to sit inside the band against THIS direction's reach, which is
          // what an anisotropic model makes a different number in every
          // direction.
          const depth = 1 - (plane.d - (cx * plane.nx + cy * plane.ny + cz * plane.nz)) / support;
          expect(depth, `${name} cut${cut}`).toBeGreaterThanOrEqual(ROCK_DEPTH[0] - 1e-6);
          expect(depth, `${name} cut${cut}`).toBeLessThanOrEqual(ROCK_DEPTH[1] + 1e-6);
        }
      }
    }
  });

  it("keeps exactly the candidates whose cap lands inside the share band", () => {
    let dropped = 0;
    for (const { name, model } of MODELS) {
      const positions = arraysFor(name, "LOD0").positions;
      for (let cut = 0; cut < ROCK_CUTS; cut++) {
        const kept = rockPlanes(model, cut, positions);
        for (const candidate of rockPlaneCandidates(model, cut, positions)) {
          const share = capShareOf(positions, candidate);
          const inBand = share >= ROCK_CAP_SHARE[0] && share <= ROCK_CAP_SHARE[1];
          const isKept = kept.some((k) => k.d === candidate.d && k.nx === candidate.nx);
          expect(isKept, `${name} cut${cut} share ${share}`).toBe(inBand);
          if (!inBand) dropped++;
        }
      }
    }
    // Non-vacuous: these models really do produce candidates the rule has to
    // throw away, so the line above is exercising both of its branches. Only
    // the FLOOR fires here — no candidate on any shipped model reaches the
    // 35 % ceiling — so the ceiling is pinned on a deliberately flat fixture
    // in `rockRelief.test.ts` instead.
    expect(dropped).toBeGreaterThan(0);
  });

  it("gives a model's four cuts four different silhouettes", () => {
    for (const { name, model } of MODELS) {
      const arrays = arraysFor(name, "LOD0");
      const size = Math.max(...extentOf(arrays.positions));
      const supports = [0, 1, 2, 3].map((cut) => {
        const out = rockRelief(arrays, rockPlanes(model, cut, arrays.positions), model, cut);
        return PROBE_DIRS.map((dir) => supportIn(out.positions, dir));
      });
      for (let a = 0; a < ROCK_CUTS; a++) {
        for (let b = a + 1; b < ROCK_CUTS; b++) {
          let worst = 0;
          for (let d = 0; d < PROBE_DIRS.length; d++) worst = Math.max(worst, Math.abs(supports[a]![d]! - supports[b]![d]!));
          // Two cuts of one model have to differ in outline by more than the
          // roughening alone could account for. The roughening reaches
          // ROCK_ROUGH (2 %) of a vertex's reach, so a pair under that is two
          // copies of one solid wearing different noise — which is exactly
          // what a boulder's four cuts used to be. Measured here: 6.3 % at the
          // closest pair, 15.9 % at the widest.
          expect(worst / size, `${name} cut${a} vs cut${b}`).toBeGreaterThan(0.03);
        }
      }
    }
  });

  it("cuts both LODs of a model to one shape, so a swap changes detail and not shape", () => {
    for (const { name, model } of MODELS) {
      const lod0 = arraysFor(name, "LOD0");
      const lod1 = arraysFor(name, "LOD1");
      expect(lod1.positions.length).toBeLessThan(lod0.positions.length);
      // How far apart the two levels already are before anything is cut.
      // LOD1 carries 40 % to 52 % of LOD0's vertices across these four
      // models, so this is never zero, and the cut cannot be asked to do
      // better than the geometry it was handed.
      let uncut = 0;
      for (const dir of PROBE_DIRS) uncut = Math.max(uncut, Math.abs(supportIn(lod0.positions, dir) - supportIn(lod1.positions, dir)));
      const size = Math.max(...extentOf(lod0.positions));
      for (let cut = 0; cut < ROCK_CUTS; cut++) {
        // One list, derived once from LOD0, handed to both — and it is the
        // SURVIVING list, so the two levels cannot disagree about which
        // planes cut them the way they did when each judged the rule itself.
        const planes = rockPlanes(model, cut, lod0.positions);
        const near = rockRelief(lod0, planes, model, cut);
        const far = rockRelief(lod1, planes, model, cut);
        let delta = 0;
        for (const dir of PROBE_DIRS) delta = Math.max(delta, Math.abs(supportIn(near.positions, dir) - supportIn(far.positions, dir)));
        // Cutting may widen the gap the two levels already had — they carry
        // different vertices, so a plane lands on a different sample of the
        // surface — but only by a little. Measured: the cut adds at most
        // 1.9 % of the model's size to a 0.6-1.1 % starting gap. A pair of
        // levels cut by DIFFERENT plane lists, the failure this guards, ran
        // several times that.
        expect((delta - uncut) / size, `${name} cut${cut}`).toBeLessThan(0.025);
        expect(delta / size, `${name} cut${cut}`).toBeLessThan(0.035);
      }
    }
  });

  it("only removes material, on real geometry and at both LODs", () => {
    for (const { name, model } of MODELS) {
      const lod0 = arraysFor(name, "LOD0");
      for (const lod of LODS) {
        const arrays = arraysFor(name, lod);
        const [cx, cy, cz] = centroidOf(arrays.positions);
        for (let cut = 0; cut < ROCK_CUTS; cut++) {
          const out = rockRelief(arrays, rockPlanes(model, cut, lod0.positions), model, cut);
          for (let t = 0; t < out.indices.length / 3; t++) {
            for (let k = 0; k < 3; k++) {
              const v = t * 3 + k, src = arrays.indices[t * 3 + k]!;
              const was = Math.hypot(arrays.positions[src * 3]! - cx, arrays.positions[src * 3 + 1]! - cy, arrays.positions[src * 3 + 2]! - cz);
              const now = Math.hypot(out.positions[v * 3]! - cx, out.positions[v * 3 + 1]! - cy, out.positions[v * 3 + 2]! - cz);
              // The slack is float32 store rounding and nothing else — the
              // worst excess measured over all thirty-two combinations is
              // 35.7 nm, on a boulder 2.5 m across.
              expect(now, `${name} ${lod} cut${cut}`).toBeLessThanOrEqual(was + 1e-6);
            }
          }
        }
      }
    }
  }, 120000);

  it("leaves a prop enough of its sink to stay out of the terrain it stands on", () => {
    // Every clutter model puts its footprint base at y = 0, and the shell
    // sinks it below the sampled ground so it does not z-fight the terrain
    // triangle underneath: CLUTTER_SINK (a flat 2 cm) for a rock, a far
    // deeper seat of its own for a boulder. A cut that raised the underside
    // would spend that margin, and the rocks scale up to 3.13x in world
    // space, which multiplies whatever the cut spends.
    for (const { name, model, sink, scaleMax } of MODELS) {
      const arrays = arraysFor(name, "LOD0");
      let lowest = Infinity;
      for (let v = 0; v < arrays.positions.length / 3; v++) lowest = Math.min(lowest, arrays.positions[v * 3 + 1]!);
      for (let cut = 0; cut < ROCK_CUTS; cut++) {
        const out = rockRelief(arrays, rockPlanes(model, cut, arrays.positions), model, cut);
        let cutLowest = Infinity;
        for (let v = 0; v < out.positions.length / 3; v++) cutLowest = Math.min(cutLowest, out.positions[v * 3 + 1]!);
        // World metres of burial left at the largest instance the sim draws.
        const left = sink(scaleMax) - Math.max(0, cutLowest - lowest) * scaleMax;
        expect(left, `${name} cut${cut}`).toBeGreaterThan(0.4 * sink(scaleMax));
      }
    }
  });

  it("does not cleave so much off a boulder that its collider stands clear of the stone", () => {
    // A boulder's collider box runs from the ground to BASE_H · scale ·
    // (1 − BOULDER_SINK) — the height of the UNCUT mesh's visible top, a
    // constant in `sim/passes/clutter.ts` that this renderer-only pass must
    // not move. Whatever a cut takes off the top is therefore box standing
    // above stone. Measured worst: 11.3 % of boulder_b's height, on cut 0,
    // where a plane genuinely cleaves the dome; boulder_a's top is untouched
    // in all four of its cuts.
    for (const { name, model, height } of MODELS.filter((m) => m.name.startsWith("boulder"))) {
      const arrays = arraysFor(name, "LOD0");
      let top = -Infinity;
      for (let v = 0; v < arrays.positions.length / 3; v++) top = Math.max(top, arrays.positions[v * 3 + 1]!);
      for (let cut = 0; cut < ROCK_CUTS; cut++) {
        const out = rockRelief(arrays, rockPlanes(model, cut, arrays.positions), model, cut);
        let cutTop = -Infinity;
        for (let v = 0; v < out.positions.length / 3; v++) cutTop = Math.max(cutTop, out.positions[v * 3 + 1]!);
        expect((top - cutTop) / height, `${name} cut${cut}`).toBeLessThan(0.15);
      }
    }
  });

  it("gives every cut the six distinct facet planes the design asks for", () => {
    // The design's own number, asserted on the shipped models rather than on
    // the sphere fixture, where ten of ten candidates survive whatever the
    // offsets do. Measured: 6 on boulder_a's first cut, 8 to 10 elsewhere.
    const cosTol = Math.cos((5 * Math.PI) / 180);
    for (const { name, model } of MODELS) {
      const arrays = arraysFor(name, "LOD0");
      for (let cut = 0; cut < ROCK_CUTS; cut++) {
        const planes = rockPlanes(model, cut, arrays.positions);
        const out = rockRelief(arrays, planes, model, cut);
        const shown = planes.map(() => false);
        for (let t = 0; t < out.indices.length / 3; t++) {
          const nx = out.normals[t * 9]!, ny = out.normals[t * 9 + 1]!, nz = out.normals[t * 9 + 2]!;
          for (let pi = 0; pi < planes.length; pi++) {
            const p = planes[pi]!;
            if (nx * p.nx + ny * p.ny + nz * p.nz > cosTol) { shown[pi] = true; break; }
          }
        }
        expect(shown.filter(Boolean).length, `${name} cut${cut}`).toBeGreaterThanOrEqual(6);
      }
    }
  });
});
