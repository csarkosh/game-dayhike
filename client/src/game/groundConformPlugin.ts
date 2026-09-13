/**
 * Base conform for props that stand plumb: a
 * vertex-stage material plugin that pushes geometry near a model's base down
 * onto the local ground plane, so a flat root plate follows the hillside while
 * the trunk above it stays vertical.
 *
 * Renderer-only by design — no constant here may migrate into sim/ or a
 * tunables registry, exactly as `windPlugin.ts` states for its amplitudes.
 * Conforming is cosmetic, peers need not agree on it, and it must not move the
 * level id.
 *
 * The displacement is the first-order Taylor step of the elevation field:
 * `dot(offset, gradient)` is how far the ground sits above or below the
 * instance's own placement point at that horizontal offset. Two details are
 * measured rather than chosen. It is clamped DOWNWARD — a signed conform also
 * lifts the uphill half, which over concave ground rises above terrain that
 * curves away beneath it and opens new daylight (measured: worst case 2.44 m
 * to 3.06 m). And it overshoots the plane by GROUND_CONFORM_OVERSHOOT, tucking
 * the downhill edge into the hillside rather than leaving it level with a
 * tangent plane the real ground has already fallen away from. Over the 386
 * giants within 120 m of the origin, that takes the median gap from 0.615 m to
 * 0.001 m and the p90 from 1.088 m to 0.316 m. On flat ground the plane term
 * is zero and so is the displacement.
 *
 * Injection point is CUSTOM_VERTEX_UPDATE_WORLDPOS for the same reason
 * `windPlugin.ts` records: it sits after `worldPos = finalWorld * position`,
 * so the thin-instance matrix has been applied and both `worldPos` and
 * `positionUpdated` are in scope, along with `finalWorld` itself — whose
 * fourth column is the instance's own world origin.
 *
 * The ramp reads `positionUpdated.y`, MODEL space, so a single constant covers
 * the whole 2.8-5.13x giant scale range without a per-instance term. That also
 * means this plugin only suits models whose local Y is up and whose origin is
 * at the footprint base. The deadwood bucket is not one of them — its snag
 * role rolls local X onto world Y — which is why snags are tilted instead.
 */
import { MaterialPluginBase } from "@babylonjs/core/Materials/materialPluginBase.js";
import type { Material } from "@babylonjs/core/Materials/material.js";
import type { MaterialDefines } from "@babylonjs/core/Materials/materialDefines.js";
import type { UniformBuffer } from "@babylonjs/core/Materials/uniformBuffer.js";
import type { Scene } from "@babylonjs/core/scene.js";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine.js";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh.js";
import type { SubMesh } from "@babylonjs/core/Meshes/subMesh.js";

/** Model-space height over which the conform fades to nothing (m). Sized so the
 * weight is still ~0.99 across a giant's root plate, which ends by model
 * y = 0.25, and gone before the trunk is clear of it. */
export const GROUND_CONFORM_RAMP = 0.8;

/** How far past the local ground plane the downhill edge is pushed. 1.0 leaves
 * a p90 gap of 0.339 m, 1.5 gives 0.316 m, 2.0 gives 0.296 m for more burial —
 * so 1.5. Browser-tunable, like the WIND_AMP constants. */
export const GROUND_CONFORM_OVERSHOOT = 1.5;

const CONFORM_DEFS = `
#ifdef GROUNDCONFORM
attribute vec2 groundGrad;
#endif
`;

// THIN_INSTANCES gates the body (not just GROUNDCONFORM) because the
// `groundGrad` buffer is a thin-instance vertex buffer: `defaultBakeImpostor`
// clones LOD1 with `mesh.clone(name, null, false)`, and Babylon's `Mesh`
// constructor shares the source geometry, buffer and all. The clone draws
// non-instanced, so without this guard a non-instanced draw would read
// `groundGrad` element 0 with `vertexAttribDivisor(1)` — i.e. whichever
// instance happened to be first when the GLBs landed, nondeterministically.
// Babylon sets THIN_INSTANCES per-submesh from `mesh.hasThinInstances` and
// recompiles, so the clone (thin-instance-free) simply skips this block.
const CONFORM_GLSL = `
#ifdef GROUNDCONFORM
#ifdef THIN_INSTANCES
vec2 gcOff = worldPos.xz - finalWorld[3].xz;
float gcW = 1.0 - smoothstep(0.0, gcRamp, positionUpdated.y);
worldPos.y += gcW * min(0.0, gcOvershoot * dot(gcOff, groundGrad));
#endif
#endif
`;

/** The arithmetic of CONFORM_GLSL, in TypeScript, so the analytic gate and the
 * shader cannot drift apart. `modelY` is the vertex's model-space height;
 * `offX`/`offZ` are its world-space horizontal offset from the instance
 * origin; `dx`/`dz` are the local ground gradient at the instance (the
 * `groundGrad` attribute), i.e. how far the ground rises per metre moved in
 * world X/Z. */
export function conformDisplacement(
  offX: number,
  offZ: number,
  modelY: number,
  dx: number,
  dz: number,
): number {
  const t = Math.min(1, Math.max(0, modelY / GROUND_CONFORM_RAMP));
  const w = 1 - t * t * (3 - 2 * t);
  // `+ 0` scrubs the signed zero IEEE 754 produces at w === 0 (+0 * a negative
  // plane term is -0): GLSL draws -0.0 and 0.0 identically, but JS's `toBe`
  // does not, so leaving it in would fail the ramp-top test over a distinction
  // that has no shader-visible meaning.
  return w * Math.min(0, GROUND_CONFORM_OVERSHOOT * (offX * dx + offZ * dz)) + 0;
}

export class GroundConformPlugin extends MaterialPluginBase {
  constructor(material: Material) {
    super(material, "GroundConform", 210, { GROUNDCONFORM: false });
    this._enable(true);
  }

  override getClassName(): string {
    return "GroundConformPlugin";
  }

  // `scene` and `mesh` are part of MaterialPluginBase's required override
  // signature even though a constant define needs neither; TS's own
  // noUnusedParameters exempts the leading underscore, only this project's
  // eslint config does not — the `cel.ts` precedent.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  override prepareDefines(defines: MaterialDefines, _scene: Scene, _mesh: AbstractMesh): void {
    defines.GROUNDCONFORM = true;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  override getAttributes(attributes: string[], _scene: Scene, _mesh: AbstractMesh): void {
    attributes.push("groundGrad");
  }

  override getUniforms(): { ubo: { name: string; size: number; type: string }[]; vertex: string } {
    return {
      ubo: [
        { name: "gcRamp", size: 1, type: "float" },
        { name: "gcOvershoot", size: 1, type: "float" },
      ],
      vertex: `
#ifdef GROUNDCONFORM
uniform float gcRamp;
uniform float gcOvershoot;
#endif
`,
    };
  }

  // One line, deliberately: `eslint-disable-next-line` covers only the line
  // that follows it, so a wrapped parameter list would leave the unused three
  // unsuppressed.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  override bindForSubMesh(uniformBuffer: UniformBuffer, _scene: Scene, _engine: AbstractEngine, _subMesh: SubMesh): void {
    uniformBuffer.updateFloat("gcRamp", GROUND_CONFORM_RAMP);
    uniformBuffer.updateFloat("gcOvershoot", GROUND_CONFORM_OVERSHOOT);
  }

  override getCustomCode(shaderType: string): { [pointName: string]: string } | null {
    return shaderType === "vertex"
      ? { CUSTOM_VERTEX_DEFINITIONS: CONFORM_DEFS, CUSTOM_VERTEX_UPDATE_WORLDPOS: CONFORM_GLSL }
      : null;
  }
}

/** Attach the conform to a material once; further calls are no-ops (LOD levels
 * share materials once built, so attach is reached more than
 * once per material). */
export function attachGroundConform(material: Material): void {
  if (material.pluginManager?.getPlugin("GroundConform")) return;
  new GroundConformPlugin(material);
}
