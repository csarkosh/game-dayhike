import { describe, expect, it, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import type { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import { WING_TIME_WRAP, WingPlugin } from "../../src/game/wingPlugin.js";
import {
  createDragonflyBehaviour, KIND_DAMSELFLY, KIND_DARNER, KIND_SKIMMER, type Dragonflies, type DragonflyPose,
} from "../../src/game/dragonflyBehaviour.js";
import {
  createDragonflyMeshes, DRAGONFLY_COLOURS, DRAGONFLY_DRAWN_SCALE, DRAGONFLY_LENGTH, DRAGONFLY_OMEGA, DRAGONFLY_WING_HZ,
  dragonflyGeometry,
} from "../../src/game/dragonflies.js";

const SEED = 388817;
const KINDS = [KIND_DARNER, KIND_SKIMMER, KIND_DAMSELFLY];

/** Just enough of a vitest spy for the buffer reader below (`wildlifeMeshes.test.ts`'s idiom). */
type BufferSpy = { mock: { calls: unknown[][] } };

/** The last buffer of one kind uploaded to a mesh: reused across frames, so the array a growth frame
 * handed over is the live one. */
function uploaded(spy: BufferSpy, kind: string): Float32Array | undefined {
  const call = spy.mock.calls.filter((c) => c[0] === kind).pop();
  return call === undefined ? undefined : (call[1] as Float32Array);
}

function pose(x: number, y: number, z: number, yaw: number, pitch: number, perched: boolean, id: number): DragonflyPose {
  return { x, y, z, yaw, pitch, perched, id };
}

/** A behaviour's output with these poses and nothing else: what `update` reads. */
function fake(darners: DragonflyPose[], skimmers: DragonflyPose[], damselflies: DragonflyPose[]): Dragonflies {
  return {
    count: [darners.length, skimmers.length, damselflies.length],
    poses: [darners, skimmers, damselflies],
    rustles: [],
    step() {},
  };
}

/** `n` flying poses in a row along x, ids from `id0`. */
function row(n: number, id0 = 0): DragonflyPose[] {
  return Array.from({ length: n }, (_, i) => pose(i, 11, 0, 0, 0, false, id0 + i));
}

describe("the dragonflies' cards", () => {
  it("builds each kind from a body of two crossed quads and four flat wings, as long as the kind", () => {
    const spans: number[] = [];
    for (const k of KINDS) {
      const geo = dragonflyGeometry(k);
      expect(geo.positions).toHaveLength(24 * 3);
      expect(geo.normals).toHaveLength(24 * 3);
      expect(geo.colors).toHaveLength(24 * 4);
      expect(geo.indices).toHaveLength(12 * 3);
      let minZ = Infinity, maxZ = -Infinity, span = 0;
      for (let i = 0; i < 24; i++) {
        const x = geo.positions[i * 3]!, y = geo.positions[i * 3 + 1]!, z = geo.positions[i * 3 + 2]!;
        minZ = Math.min(minZ, z);
        maxZ = Math.max(maxZ, z);
        span = Math.max(span, Math.abs(x));
        if (i < 4) expect(x, `kind ${k}, upright body ${i}`).toBe(0);
        else if (i < 8) expect(y, `kind ${k}, flat body ${i}`).toBe(0);
        else {
          // Flat, and on its own side of the body: the wing beat hinges on the sign of x.
          expect(y, `kind ${k}, wing ${i}`).toBe(0);
          expect(Math.sign(x), `kind ${k}, wing ${i}`).toBe(i < 16 ? 1 : -1);
        }
      }
      // Head to tail, the body is the kind's length and nothing reaches past it.
      expect(maxZ - minZ, `kind ${k}`).toBeCloseTo(DRAGONFLY_LENGTH[k]!, 6);
      spans.push(span);
    }
    // Wing tip to body: the darner's and the skimmer's spread square, the damselfly's folded along
    // its abdomen, a quarter of its length out.
    expect(spans[0]).toBeCloseTo(0.0532, 4);
    expect(spans[1]).toBeCloseTo(0.03825, 5);
    expect(spans[2]).toBeCloseTo(0.00775, 5);
  });

  it("paints an opaque body, darker at the thorax, and translucent pale wings, the skimmer's spotted", () => {
    for (const k of KINDS) {
      const geo = dragonflyGeometry(k);
      const shades: number[] = [];
      for (let i = 0; i < 24; i++) {
        const r = geo.colors[i * 4]!;
        expect([geo.colors[i * 4 + 1], geo.colors[i * 4 + 2]]).toEqual([r, r]);
        expect(geo.colors[i * 4 + 3]).toBeCloseTo(i < 8 ? 1 : 0.4, 6);
        shades.push(Math.round(r * 100) / 100);
      }
      expect(shades.slice(0, 8)).toEqual([0.55, 1, 1, 0.55, 0.55, 1, 1, 0.55]);
      const tip = k === KIND_SKIMMER ? 0.15 : 0.9;
      expect(shades.slice(8)).toEqual([0, 1, 2, 3].flatMap(() => [0.9, tip, 0.9, 0.9]));
    }
    // A few colourways a kind, each a visible distance from the others.
    expect(DRAGONFLY_COLOURS.map((c) => c.length)).toEqual([3, 2, 2]);
    expect(DRAGONFLY_COLOURS).toEqual([
      [[0.078, 0.338, 0.676], [0.182, 0.52, 0.208], [0.39, 0.26, 0.13]],
      [[0.52, 0.299, 0.104], [0.676, 0.182, 0.065]],
      [[0.104, 0.364, 0.936], [0.065, 0.442, 0.546]],
    ]);
    // Each a colourway of the real insects' brightened by 1.3, every channel
    // alike, so its hue and its saturation hold; the brightest channel stays
    // under 1, so none was clamped.
    const real = [
      [[0.06, 0.26, 0.52], [0.14, 0.4, 0.16], [0.3, 0.2, 0.1]],
      [[0.4, 0.23, 0.08], [0.52, 0.14, 0.05]],
      [[0.08, 0.28, 0.72], [0.05, 0.34, 0.42]],
    ];
    real.forEach((ways, k) => ways.forEach((way, i) => way.forEach((v, ch) => {
      expect(DRAGONFLY_COLOURS[k]![i]![ch], `kind ${k}, colourway ${i}, channel ${ch}`).toBeCloseTo(v * 1.3, 12);
    })));
    expect(Math.max(...DRAGONFLY_COLOURS.flat(2))).toBe(0.936);
    for (const ways of DRAGONFLY_COLOURS) {
      for (let i = 0; i < ways.length; i++) {
        for (let j = i + 1; j < ways.length; j++) {
          const a = ways[i]!, b = ways[j]!;
          expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])).toBeGreaterThan(0.15);
        }
      }
    }
  });

  it("beats each kind's wings at a whole multiple of the wing beat's wrap", () => {
    expect(DRAGONFLY_WING_HZ).toEqual([36, 30, 18]);
    // Beats a wrap: 36, 30 and 18 Hz over 300 s.
    const beats = [10800, 9000, 5400];
    for (const k of KINDS) {
      expect((DRAGONFLY_OMEGA[k]! * WING_TIME_WRAP) / (2 * Math.PI), `kind ${k}`).toBeCloseTo(beats[k]!, 9);
      expect(DRAGONFLY_OMEGA[k], `kind ${k}`).toBeCloseTo(2 * Math.PI * DRAGONFLY_WING_HZ[k]!, 9);
    }
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const m = createDragonflyMeshes(scene);
    const spans = [0.0532, 0.03825, 0.00775];
    for (const k of KINDS) {
      const plugin = m.meshes[k]!.material!.pluginManager?.getPlugin("Wing") as WingPlugin | undefined;
      expect(plugin, `kind ${k}`).toBeInstanceOf(WingPlugin);
      expect(plugin!.omega).toBe(DRAGONFLY_OMEGA[k]);
      expect(plugin!.halfSpan).toBeCloseTo(spans[k]!, 5);
    }
    m.dispose();
    engine.dispose();
  });

  it("makes one two-sided, vertex-coloured card mesh a kind that casts and takes no shadow", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const m = createDragonflyMeshes(scene);
    expect(m.meshes.map((mesh) => mesh.name)).toEqual(["dragonfly_darner", "dragonfly_skimmer", "dragonfly_damselfly"]);
    expect(m.meshes.map((mesh) => mesh.material!.name)).toEqual([
      "dragonfly_darner_mat", "dragonfly_skimmer_mat", "dragonfly_damselfly_mat",
    ]);
    for (const mesh of m.meshes) {
      const material = mesh.material as PBRMaterial;
      expect(material).toBeInstanceOf(PBRMaterial);
      expect(material.backFaceCulling).toBe(false);
      expect([mesh.useVertexColors, mesh.hasVertexAlpha]).toEqual([true, true]);
      expect([mesh.isPickable, mesh.receiveShadows]).toEqual([false, false]);
      expect([mesh.alwaysSelectAsActiveMesh, mesh.doNotSyncBoundingInfo]).toEqual([true, true]);
      expect(mesh.getTotalVertices()).toBe(24);
      // Nothing to draw before the first frame with a unit in it.
      expect(mesh.isEnabled()).toBe(false);
    }
    m.dispose();
    engine.dispose();
  });
});

describe("the dragonflies' instances", () => {
  it("grows each kind's buffers by doubling from 16", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const m = createDragonflyMeshes(scene);
    const spy = vi.spyOn(m.meshes[KIND_DAMSELFLY]!, "thinInstanceSetBuffer");
    const lengths = (): number[] => ["matrix", "wing", "color"].map((kind) => uploaded(spy, kind)?.length ?? 0);
    m.update(fake([], [], row(1)), SEED);
    expect(lengths()).toEqual([256, 32, 64]);
    m.update(fake([], [], row(16)), SEED);
    expect(spy.mock.calls.length).toBe(3);
    m.update(fake([], [], row(17)), SEED);
    expect(lengths()).toEqual([512, 64, 128]);
    m.update(fake([], [], row(40)), SEED);
    expect(lengths()).toEqual([1024, 128, 256]);
    m.update(fake([], [], row(3)), SEED);
    expect(spy.mock.calls.length).toBe(9);
    expect(m.meshes[KIND_DAMSELFLY]!.thinInstanceCount).toBe(3);
    m.dispose();
    engine.dispose();
  });

  it("writes each pose's place and heading into its instance, and draws as many as were posed", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const m = createDragonflyMeshes(scene);
    const spy = vi.spyOn(m.meshes[KIND_DARNER]!, "thinInstanceSetBuffer");
    m.update(fake([
      pose(1, 2, 3, Math.PI / 2, 0, false, 7),
      pose(-4, 5, 6, 0, 0.5, false, 8),
    ], row(3, 4096), []), SEED);
    expect(m.meshes.map((mesh) => mesh.thinInstanceCount)).toEqual([2, 3, 0]);
    expect(m.meshes.map((mesh) => mesh.isEnabled())).toEqual([true, true, false]);
    const mat = uploaded(spy, "matrix")!;
    // Translation, then the body's forward axis (+z) after the turn, drawn
    // three times as long: east for a yaw of π/2…
    expect([mat[12], mat[13], mat[14]]).toEqual([1, 2, 3]);
    expect([mat[8], mat[9], mat[10]].map((v) => Math.round(v! * 1e6) / 1e6)).toEqual([3, 0, 0]);
    // …and nose up for a positive pitch.
    expect([mat[28], mat[29], mat[30]]).toEqual([-4, 5, 6]);
    expect([mat[24], mat[25], mat[26]].map((v) => Math.round(v! * 1e6) / 1e6)).toEqual([0, 1.438277, 2.632748]);

    // The behaviour's own output draws the same way: a count a kind.
    const d = createDragonflyBehaviour({
      lake: { kind: "lake", level: 10, x: 0, z: 0, radius: 30, murk: 0.2, lobe: null },
      markers: [], beats: [], voices: [],
      perches: [{ x: 0, y: 10.8, z: 31, seed: 1 }, { x: 8, y: 10.8, z: 30, seed: 2 }],
      stems: [{ x: 3, y: 10.4, z: 30.5, seed: 3 }],
    }, SEED);
    const seen = { seen: 1, flying: 1 };
    d.step(0, 1 / 60, 0, 11, 0, [], { midge: 0, midgeFullness: 1, darner: seen, skimmer: seen, damselfly: seen, frog: 0 });
    m.update(d, SEED);
    expect(m.meshes.map((mesh) => mesh.thinInstanceCount)).toEqual([0, 2, 1]);
    expect(m.meshes.map((mesh) => mesh.isEnabled())).toEqual([false, true, true]);
    m.dispose();
    engine.dispose();
  });

  it("draws every card three times its real size, the geometry kept at the real lengths", () => {
    expect(DRAGONFLY_DRAWN_SCALE).toBe(3);
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const m = createDragonflyMeshes(scene);
    const spies = m.meshes.map((mesh) => vi.spyOn(mesh, "thinInstanceSetBuffer"));
    m.update(fake(
      [pose(0, 11, 0, 0.7, 0.3, false, 1), pose(2, 11, 1, -2.1, -0.4, true, 2)],
      [pose(3, 11, 2, 1.9, 0, true, 4096)],
      [pose(4, 11, 3, -0.2, 0.6, false, 8192)],
    ), SEED);
    for (const [k, n] of [[KIND_DARNER, 2], [KIND_SKIMMER, 1], [KIND_DAMSELFLY, 1]] as const) {
      const mat = uploaded(spies[k]!, "matrix")!;
      for (let i = 0; i < n; i++) {
        // Each of the three axes, whatever the heading, 3 long.
        for (const at of [0, 4, 8]) {
          const o = i * 16 + at;
          expect(Math.hypot(mat[o]!, mat[o + 1]!, mat[o + 2]!), `kind ${k}, instance ${i}, axis ${at / 4}`).toBeCloseTo(3, 6);
        }
      }
    }
    // Drawn, the darner is 210 mm long, the skimmer 135 and the damselfly 90.
    expect(DRAGONFLY_LENGTH).toEqual([0.07, 0.045, 0.03]);
    DRAGONFLY_LENGTH.forEach((length, k) => expect(length * DRAGONFLY_DRAWN_SCALE).toBeCloseTo([0.21, 0.135, 0.09][k]!, 12));
    m.dispose();
    engine.dispose();
  });

  it("stills a perched unit's wings and keeps each individual's colour and beat whatever its slot", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const m = createDragonflyMeshes(scene);
    const spy = vi.spyOn(m.meshes[KIND_SKIMMER]!, "thinInstanceSetBuffer");
    const a = pose(0, 11, 0, 0, 0, true, 4096);
    const b = pose(1, 11, 0, 0, 0, false, 4097);
    m.update(fake([], [a, b], []), SEED);
    const wing = uploaded(spy, "wing")!;
    const tint = uploaded(spy, "color")!;
    expect([wing[1], wing[3]]).toEqual([0, 0.5]);
    for (const phase of [wing[0]!, wing[2]!]) {
      expect(phase).toBeGreaterThanOrEqual(0);
      expect(phase).toBeLessThan(2 * Math.PI);
    }
    const colourOf = (i: number): number[] => [tint[i * 4]!, tint[i * 4 + 1]!, tint[i * 4 + 2]!, tint[i * 4 + 3]!];
    const firstA = colourOf(0), firstB = colourOf(1), phaseA = wing[0], phaseB = wing[2];
    for (const c of [firstA, firstB]) {
      expect(c[3]).toBe(1);
      expect(DRAGONFLY_COLOURS[KIND_SKIMMER]!.some((w) => Math.fround(w[0]) === c[0] && Math.fround(w[1]) === c[1] && Math.fround(w[2]) === c[2])).toBe(true);
    }
    // Swapped slots, and `a` takes to the air: each keeps its own colour and phase.
    a.perched = false;
    m.update(fake([], [b, a], []), SEED);
    expect([colourOf(0), colourOf(1)]).toEqual([firstB, firstA]);
    expect([wing[0], wing[1], wing[2], wing[3]]).toEqual([phaseB, 0.5, phaseA, 0.5]);
    m.dispose();
    engine.dispose();
  });

  it("allocates nothing on a steady frame, writing the same buffers in place", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const m = createDragonflyMeshes(scene);
    const spies = m.meshes.map((mesh) => vi.spyOn(mesh, "thinInstanceSetBuffer"));
    const darners = row(5), skimmers = row(9, 4096), damselflies = row(12, 8192);
    const d = fake(darners, skimmers, damselflies);
    m.update(d, SEED);
    const first = spies.map((spy) => uploaded(spy, "matrix"));
    for (let frame = 1; frame <= 10; frame++) {
      for (const p of [...darners, ...skimmers, ...damselflies]) p.x += 0.03;
      m.update(d, SEED);
    }
    // The growth frame's three buffers a kind, and never a fresh one after.
    expect(spies.map((spy) => spy.mock.calls.length)).toEqual([3, 3, 3]);
    expect(spies.map((spy) => uploaded(spy, "matrix"))).toEqual(first);
    for (let k = 0; k < 3; k++) expect(uploaded(spies[k]!, "matrix")).toBe(first[k]);
    // Written in place: the buffer the GPU holds carries this frame's poses.
    expect(first[KIND_DARNER]![12]).toBeCloseTo(0.3, 5);
    expect(m.meshes.map((mesh) => mesh.thinInstanceCount)).toEqual([5, 9, 12]);
    m.dispose();
    engine.dispose();
  });

  it("disposes its meshes and materials, once", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const meshesBefore = scene.meshes.length, materialsBefore = scene.materials.length;
    const m = createDragonflyMeshes(scene);
    m.update(fake(row(2), row(2, 4096), row(2, 8192)), SEED);
    expect([scene.meshes.length - meshesBefore, scene.materials.length - materialsBefore]).toEqual([3, 3]);
    m.dispose();
    expect([scene.meshes.length - meshesBefore, scene.materials.length - materialsBefore]).toEqual([0, 0]);
    expect(m.meshes.every((mesh: Mesh) => mesh.isDisposed())).toBe(true);
    // A second dispose, and a frame after it, do nothing.
    m.dispose();
    m.update(fake(row(2), [], []), SEED);
    engine.dispose();
  });
});
