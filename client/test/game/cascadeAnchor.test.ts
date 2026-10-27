import { describe, expect, it } from "vitest";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import type { CascadedShadowGenerator } from "@babylonjs/core/Lights/Shadows/cascadedShadowGenerator.js";

import { acrossLight, installAnchoredSnap, moveAlongLattice, snapToAnchor, texelLattice } from "../../src/game/cascadeFrustum.js";

/** Medium's first cascade in the forest: a 26.65 m sphere on a 2048 map, 2.6 cm texels. */
const RADIUS = 26.65;
const MAP = 2048;
/** The explore day turns the sun 2π in 960 s; at two frames a redraw and 42 fps, this much a redraw. */
const SUN_STEP = (2 * Math.PI) / 960 / 21;
/** Where the forest view stands: hundreds of metres from the world origin. */
const WHERE = new Vector3(250, 31, -500);

/** A stand-in generator: one stabilised cascade whose matrices are built as Babylon builds them, with its origin snap. */
function standIn(): {
  fake: CascadedShadowGenerator;
  sun: Vector3;
  centre: Vector3;
  compute(): void;
  texel(p: Vector3): { x: number; y: number };
} {
  const sun = new Vector3(0.2, -0.95, 0.24).normalize();
  const centre = WHERE.clone();
  const view = Matrix.Identity();
  const projection = Matrix.Identity();
  const transform = Matrix.Identity();
  const state = {
    stabilizeCascades: true,
    mapSize: MAP,
    numCascades: 1,
    getCascadeViewMatrix: () => view,
    getCascadeProjectionMatrix: () => projection,
    getCascadeTransformMatrix: () => transform,
    getCascadeMinExtents: () => new Vector3(-RADIUS, -RADIUS, 0),
    getCascadeMaxExtents: () => new Vector3(RADIUS, RADIUS, 2 * RADIUS),
    _frustumCenter: [centre],
    _transformMatricesAsArray: new Float32Array(16),
    _computeMatrices(): void {
      Matrix.LookAtLHToRef(centre.subtract(sun.scale(RADIUS)), centre, Vector3.Up(), view);
      Matrix.OrthoOffCenterLHToRef(-RADIUS, RADIUS, -RADIUS, RADIUS, 0, 2 * RADIUS, projection, false);
      view.multiplyToRef(projection, transform);
      // Babylon's snap: the world origin on a texel corner.
      const p = Vector3.TransformCoordinates(Vector3.Zero(), transform).scaleInPlace(MAP / 2);
      projection.multiplyToRef(Matrix.Translation(((Math.round(p.x) - p.x) * 2) / MAP, ((Math.round(p.y) - p.y) * 2) / MAP, 0), projection);
      view.multiplyToRef(projection, transform);
      transform.copyToArray(this._transformMatricesAsArray, 0);
    },
  };
  return {
    fake: state as unknown as CascadedShadowGenerator,
    sun,
    centre,
    compute: () => state._computeMatrices(),
    texel: (p) => {
      const q = Vector3.TransformCoordinates(p, transform);
      return { x: (q.x * 0.5 + 0.5) * MAP, y: (q.y * 0.5 + 0.5) * MAP };
    },
  };
}

const frac = (v: number): number => v - Math.floor(v);
/** The change of a texel coordinate's fractional part, the wrap allowed for. */
const phaseJump = (a: number, b: number): number => {
  const d = Math.abs(frac(a) - frac(b));
  return Math.min(d, 1 - d);
};

/** Turns the sun about the vertical by `step` a redraw for `n` redraws and returns a fixed point's texel coordinates after each. */
function sunSweep(s: ReturnType<typeof standIn>, p: Vector3, n: number, step: number): { x: number; y: number }[] {
  const rows: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    const c = Math.cos(step);
    const sn = Math.sin(step);
    s.sun.set(s.sun.x * c - s.sun.z * sn, s.sun.y, s.sun.x * sn + s.sun.z * c);
    s.compute();
    rows.push(s.texel(p));
  }
  return rows;
}

describe("cascade texel snap anchored near the cascade", () => {
  const nearPoint = (centre: Vector3): Vector3 => centre.add(new Vector3(3, 0, 2));

  it("Babylon's origin snap re-phases the map by a fraction of a texel on every redraw as the sun moves (the defect)", () => {
    const s = standIn();
    const rows = sunSweep(s, nearPoint(s.centre), 40, SUN_STEP);
    let worst = 0;
    for (let i = 1; i < rows.length; i++) worst = Math.max(worst, phaseJump(rows[i]!.x, rows[i - 1]!.x), phaseJump(rows[i]!.y, rows[i - 1]!.y));
    // A point 3.6 m from the centre moves 0.04 texel a redraw of its own; the origin, 560 m away, drags the grid much further.
    expect(worst).toBeGreaterThan(0.15);
  });

  it("anchored near the cascade, the map's grid moves no faster than the sun turns it about the slice", () => {
    const s = standIn();
    installAnchoredSnap(s.fake);
    const p = nearPoint(s.centre);
    const rows = sunSweep(s, p, 40, SUN_STEP);
    let worst = 0;
    for (let i = 1; i < rows.length; i++) worst = Math.max(worst, phaseJump(rows[i]!.x, rows[i - 1]!.x), phaseJump(rows[i]!.y, rows[i - 1]!.y));
    // The anchor is the slice's centre; the point is 3.6 m from it, so it moves 3.6·δ a redraw: 0.04 texel.
    const texel = (2 * RADIUS) / MAP;
    expect(worst).toBeLessThan((3.7 * SUN_STEP) / texel);
    // And the anchor itself stays on a corner.
    const a = s.texel(s.centre);
    expect(Math.min(frac(a.x), 1 - frac(a.x))).toBeLessThan(1e-3);
    expect(Math.min(frac(a.y), 1 - frac(a.y))).toBeLessThan(1e-3);
  });

  it("as the camera walks, the grid holds in the world, through the anchor's steps along the lattice", () => {
    const s = standIn();
    installAnchoredSnap(s.fake, 8);
    s.compute();
    const p = nearPoint(s.centre);
    const first = s.texel(p);
    // 60 steps of 0.37 m: 22 m, so the anchor steps after the centre more than once.
    for (let i = 0; i < 60; i++) {
      s.centre.addInPlace(new Vector3(0.3, 0.02, 0.2));
      s.compute();
      const now = s.texel(p);
      expect(phaseJump(now.x, first.x), `step ${i} x`).toBeLessThan(0.01);
      expect(phaseJump(now.y, first.y), `step ${i} y`).toBeLessThan(0.01);
    }
  });

  it("does nothing while the cascades are not stabilised", () => {
    const s = standIn();
    s.compute();
    const stock = s.fake.getCascadeTransformMatrix(0)!.clone();
    (s.fake as unknown as { stabilizeCascades: boolean }).stabilizeCascades = false;
    installAnchoredSnap(s.fake);
    s.compute();
    expect(s.fake.getCascadeTransformMatrix(0)!.equals(stock)).toBe(true);
  });

  it("moveAlongLattice steps by whole texels along the map's axes to the lattice point nearest the target", () => {
    const view = Matrix.LookAtLH(new Vector3(0, 10, -3), Vector3.Zero(), Vector3.Up());
    const lattice = texelLattice(view, -RADIUS, RADIUS, MAP);
    expect(lattice.texel).toBeCloseTo((2 * RADIUS) / MAP, 12);
    expect(lattice.ex.length()).toBeCloseTo(1, 6);
    expect(lattice.ey.length()).toBeCloseTo(1, 6);
    expect(Math.abs(Vector3.Dot(lattice.ex, lattice.ey))).toBeLessThan(1e-6);
    const anchor = new Vector3(1, 2, 3);
    const target = new Vector3(9.123, 2.5, -4.567);
    const before = anchor.clone();
    moveAlongLattice(anchor, target, lattice);
    const d = anchor.subtract(before);
    const nx = Vector3.Dot(d, lattice.ex) / lattice.texel;
    const ny = Vector3.Dot(d, lattice.ey) / lattice.texel;
    // The view matrix is single precision: its axes are unit to 1e-7, a few 1e-5 texel over 300 texels.
    expect(Math.abs(nx - Math.round(nx))).toBeLessThan(1e-4);
    expect(Math.abs(ny - Math.round(ny))).toBeLessThan(1e-4);
    // Nothing along the light itself.
    const along = d.subtract(lattice.ex.scale(Vector3.Dot(d, lattice.ex))).subtract(lattice.ey.scale(Vector3.Dot(d, lattice.ey)));
    expect(along.length()).toBeLessThan(1e-5);
    // Within half a texel of the target across the light.
    expect(acrossLight(anchor, target, lattice)).toBeLessThan(lattice.texel / Math.SQRT2 + 1e-9);
  });

  it("snapToAnchor puts the anchor on a texel corner and reports the shift", () => {
    const s = standIn();
    s.compute();
    const anchor = s.centre.add(new Vector3(1.2345, 0, -0.6789));
    const before = s.texel(anchor);
    const shift = snapToAnchor(anchor, s.fake.getCascadeViewMatrix(0)!, s.fake.getCascadeProjectionMatrix(0)!, s.fake.getCascadeTransformMatrix(0)!, MAP);
    const after = s.texel(anchor);
    expect(Math.abs(after.x - Math.round(after.x))).toBeLessThan(1e-3);
    expect(Math.abs(after.y - Math.round(after.y))).toBeLessThan(1e-3);
    expect(after.x - before.x).toBeCloseTo(shift.x, 3);
    expect(after.y - before.y).toBeCloseTo(shift.y, 3);
    expect(Math.abs(shift.x)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(shift.y)).toBeLessThanOrEqual(0.5);
  });
});
