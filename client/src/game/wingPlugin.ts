/**
 * Bird wing beat: a vertex-stage plugin on the bird
 * thin-instance materials that rotates each wing about the body's forward
 * axis by amp·sin(ωt + phase), weighted by |x| / halfSpan so the body holds
 * still and the tip moves most. `wing` is a per-instance vec2 attribute
 * (phase, amp): amp 0 is a glide.
 *
 * Position only: NORMALS are left unrotated, so a raised wing shades as if it
 * were still flat. `foliagePlugin.ts` has the same shape for the same reason — the
 * normal rotation costs a second matrix per vertex and the birds it would serve
 * are a few pixels across at 300 m. Recorded here so this reads
 * as a decision rather than rediscovering it as a bug.
 *
 * Injected at CUSTOM_VERTEX_UPDATE_POSITION — BEFORE the instance matrix —
 * because the rotation is in the bird's own frame; foliagePlugin.ts hooks
 * WORLDPOS for the opposite reason. Time wraps at WING_TIME_WRAP and every ω
 * is an exact multiple of 2π / WING_TIME_WRAP so the wrap is phase-continuous
 * (the wind rule). The per-instance attribute plumbing mirrors
 * groundConformPlugin.ts's `groundGrad` exactly — see there for why
 * `getAttributes` and CUSTOM_VERTEX_DEFINITIONS are both needed. Birds never
 * cast shadows, so there is no shadow-depth mismatch.
 *
 * Renderer-only by design — no constant here may migrate into sim/ or a
 * tunables registry, exactly as `foliagePlugin.ts` states for its amplitudes.
 *
 * The body carries `groundConformPlugin.ts`'s `THIN_INSTANCES` guard, and the
 * reason is worth stating because it is NOT the same one. There, an unguarded
 * read is a real bug: `defaultBakeImpostor` clones a forest LOD mesh
 * non-instanced while it still shares the source geometry's `groundGrad`
 * buffer, and the clone would read element 0 with `vertexAttribDivisor(1)` —
 * a nondeterministic displacement. Here the unguarded form would in fact have
 * been safe: nothing clones or impostors a bird bucket, every non-LOD0 mesh a
 * container brings is disabled, and even a stray non-instanced draw would bind
 * no `wing` buffer, so WebGL's generic attribute `(0, 0)` gives amp 0 → an
 * exact identity. The guard is kept anyway: that safety rests
 * entirely on invariants held in ANOTHER file, and two lines is a cheap price
 * for not depending on them.
 */
import { MaterialPluginBase } from "@babylonjs/core/Materials/materialPluginBase.js";
import type { Material } from "@babylonjs/core/Materials/material.js";
import type { MaterialDefines } from "@babylonjs/core/Materials/materialDefines.js";
import type { UniformBuffer } from "@babylonjs/core/Materials/uniformBuffer.js";
import type { Scene } from "@babylonjs/core/scene.js";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine.js";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh.js";
import type { SubMesh } from "@babylonjs/core/Meshes/subMesh.js";

/** Wrap period (s). Every ω handed to `attachWing` is 2π·n / WING_TIME_WRAP. */
export const WING_TIME_WRAP = 300;

const WING_DEFS = `
#ifdef WING
attribute vec2 wing;
#endif
`;

export const WING_GLSL = `
#ifdef WING
#ifdef THIN_INSTANCES
float wingSide = positionUpdated.x < 0.0 ? -1.0 : 1.0;
float wingAbsX = abs(positionUpdated.x);
float wingSpan = clamp(wingAbsX / wingHalfSpan, 0.0, 1.0);
float wingA = wing.y * sin(wingTime * wingOmega + wing.x) * wingSpan;
float wingC = cos(wingA);
float wingS = sin(wingA);
float wingY0 = positionUpdated.y;
positionUpdated.y = wingY0 * wingC + wingAbsX * wingS;
positionUpdated.x = wingSide * (wingAbsX * wingC - wingY0 * wingS);
#endif
#endif
`;

/** TS mirror of the shader's angle, for tests: amp·sin(ω·t + phase). */
export function wingAngle(t: number, phase: number, amp: number, omega: number): number {
  return amp * Math.sin((t % WING_TIME_WRAP) * omega + phase);
}

export class WingPlugin extends MaterialPluginBase {
  private readonly _halfSpan: number;
  private readonly _omega: number;

  /** The half span and ω this material beats at — read by `attachWing` so a
   * second attach with different numbers is caught rather than ignored. */
  get halfSpan(): number {
    return this._halfSpan;
  }

  get omega(): number {
    return this._omega;
  }

  constructor(material: Material, halfSpan: number, omega: number) {
    super(material, "Wing", 220, { WING: false });
    // A zero or negative half span would divide by zero in the shader and take
    // every vertex of the bird to NaN; a degenerate bucket mesh simply holds
    // its wings still instead.
    this._halfSpan = halfSpan > 0 ? halfSpan : 1;
    this._omega = omega;
    this._enable(true);
  }

  override getClassName(): string {
    return "WingPlugin";
  }

  // `scene` and `mesh` are part of MaterialPluginBase's required override
  // signature even though a constant define needs neither; TS's own
  // noUnusedParameters exempts the leading underscore, only this project's
  // eslint config does not — the `cel.ts` precedent, as in foliagePlugin.ts.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  override prepareDefines(defines: MaterialDefines, _scene: Scene, _mesh: AbstractMesh): void {
    defines.WING = true;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  override getAttributes(attributes: string[], _scene: Scene, _mesh: AbstractMesh): void {
    attributes.push("wing");
  }

  override getUniforms(): { ubo: { name: string; size: number; type: string }[]; vertex: string } {
    return {
      ubo: [
        { name: "wingTime", size: 1, type: "float" },
        { name: "wingOmega", size: 1, type: "float" },
        { name: "wingHalfSpan", size: 1, type: "float" },
      ],
      vertex: `
#ifdef WING
uniform float wingTime;
uniform float wingOmega;
uniform float wingHalfSpan;
#endif
`,
    };
  }

  // One line, deliberately: `eslint-disable-next-line` covers only the line
  // that follows it, so a wrapped parameter list would leave the unused three
  // unsuppressed.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  override bindForSubMesh(uniformBuffer: UniformBuffer, _scene: Scene, _engine: AbstractEngine, _subMesh: SubMesh): void {
    uniformBuffer.updateFloat("wingTime", (performance.now() / 1000) % WING_TIME_WRAP);
    uniformBuffer.updateFloat("wingOmega", this._omega);
    uniformBuffer.updateFloat("wingHalfSpan", this._halfSpan);
  }

  override getCustomCode(shaderType: string): { [pointName: string]: string } | null {
    return shaderType === "vertex"
      ? { CUSTOM_VERTEX_DEFINITIONS: WING_DEFS, CUSTOM_VERTEX_UPDATE_POSITION: WING_GLSL }
      : null;
  }
}

/**
 * Attach the wing beat to a material once; a repeat with the SAME numbers is a
 * no-op (a GLB's LOD levels share materials after the pipeline's dedup, and one
 * bucket attaches to every mesh it holds, so attach is reached more than once
 * per material).
 *
 * A repeat with DIFFERENT numbers throws instead of silently keeping the first.
 * The once-guard's whole premise is that every caller for a
 * given material wants the same beat; if two buckets ever shared one — a shared
 * material across two bird GLBs — the second bird would quietly inherit the
 * first's wingspan and rate, and the only symptom would be a bird flapping at
 * the wrong speed. Naming it here beats hunting it in the browser.
 */
export function attachWing(material: Material, halfSpan: number, omega: number): void {
  const existing = material.pluginManager?.getPlugin("Wing") as WingPlugin | undefined;
  if (existing) {
    if (existing.halfSpan !== (halfSpan > 0 ? halfSpan : 1) || existing.omega !== omega) {
      throw new Error(
        `attachWing: material "${material.name}" already beats at halfSpan ` +
          `${existing.halfSpan}/ω ${existing.omega}; a second bucket asked for ` +
          `${halfSpan}/${omega}. One material cannot carry two wing beats — give ` +
          `each bird model its own material.`,
      );
    }
    return;
  }
  new WingPlugin(material, halfSpan, omega);
}
