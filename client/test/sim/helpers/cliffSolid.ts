/**
 * A cliff module's solid as a lattice of points, seated the way
 * the field seats it. Shared by the placement's tests (`cliffField.test.ts`)
 * and the collider's (`passes/cliffs.test.ts`), which sweep the same lattice.
 */
import type { ClutterInstance } from "../../../src/sim/clutter.js";
import {
  CLIFF_MODEL_BASE, CLIFF_MODEL_DEPTH, CLIFF_MODEL_FRONT, CLIFF_MODEL_HEIGHT, CLIFF_MODEL_RIGHT, CLIFF_MODEL_WIDTH, CLIFF_SINK,
  cliffFacing, leanPoint, type CliffPoint,
} from "../../../src/sim/cliffField.js";

/** A point in the module's own frame, seated as the field seats it: turned
 * to the module's facing, then leant by the capped lean, relative to the
 * origin. */
export function seat(m: ClutterInstance, lx: number, ly: number, lz: number, out: CliffPoint): CliffPoint {
  const f = cliffFacing(m.groundDx, m.groundDz, m.hash);
  return leanPoint(lx * f.rx + lz * f.fx, ly, lx * f.rz + lz * f.fz, m.groundDx, m.groundDz, out);
}

/** Points on the faces of the module's box, in the model's own frame at
 * `scale`, no further apart than `step`: x from the left of the width to the
 * model's own reach along +X (`CLIFF_MODEL_RIGHT`), y from `yLo` to `yHi`
 * (in metres at scale 1, then scaled), z from the back of the depth to the
 * face's own reach (`CLIFF_MODEL_FRONT`) — the origin sits off-centre in
 * both, so neither runs `±half`. */
function shell(variant: number, scale: number, step: number, yLo: number, yHi: number): [number, number, number][] {
  const w = (CLIFF_MODEL_WIDTH[variant] as number) * scale;
  const d = (CLIFF_MODEL_DEPTH[variant] as number) * scale;
  const f = (CLIFF_MODEL_FRONT[variant] as number) * scale;
  const rt = (CLIFF_MODEL_RIGHT[variant] as number) * scale;
  const span = (a: number, b: number): number[] => {
    const n = Math.max(1, Math.ceil((b - a) / step));
    const out: number[] = [];
    for (let i = 0; i <= n; i++) out.push(a + ((b - a) * i) / n);
    return out;
  };
  const xs = span(-(w - rt), rt), ys = span(yLo * scale, yHi * scale), zs = span(-(d - f), f);
  const pts: [number, number, number][] = [];
  for (const [i, x] of xs.entries()) {
    for (const [j, y] of ys.entries()) {
      for (const [k, z] of zs.entries()) {
        const onFace = i === 0 || i === xs.length - 1 || j === 0 || j === ys.length - 1
          || k === 0 || k === zs.length - 1;
        if (onFace) pts.push([x, y, z]);
      }
    }
  }
  return pts;
}

/** The box the placement probes: from the sink line (the ground at the
 * origin) to `CLIFF_MODEL_HEIGHT` above the origin. */
export function boxShell(variant: number, scale: number, step: number): [number, number, number][] {
  const h = CLIFF_MODEL_HEIGHT[variant] as number;
  return shell(variant, scale, step, CLIFF_SINK * h, h);
}

/** The whole drawn model's box: from its base (`CLIFF_MODEL_BASE`, a little
 * below the origin) to its top, `BASE + CLIFF_MODEL_HEIGHT`. */
export function drawnShell(variant: number, scale: number, step: number): [number, number, number][] {
  const base = CLIFF_MODEL_BASE[variant] as number;
  return shell(variant, scale, step, base, base + (CLIFF_MODEL_HEIGHT[variant] as number));
}
