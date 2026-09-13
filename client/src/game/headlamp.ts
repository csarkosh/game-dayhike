import { SpotLight } from "@babylonjs/core/Lights/spotLight.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import type { Scene } from "@babylonjs/core/scene.js";
import type { Material } from "@babylonjs/core/Materials/material.js";
import { MAX_PLAYERS } from "../sim/constants.js";

/**
 * The headlamp's light: one SpotLight at the eye per player,
 * steered by the view. No shadow generator — a second cascaded set would
 * double the shadow cost for a cone that is mostly ground.
 *
 * Two levers, tuned by eye in the running game. Under PBR's physical falloff a spot is an
 * inverse-square lobe that reaches 1% at its nominal edge, so LAMP_ANGLE is
 * roughly twice the cone a player sees: 1.5 rad reads as a ~40° pool on the
 * bed 3–12 m ahead, and the plan's 0.70 was a 10° hotspot that landed past
 * the range when looking level. LAMP_INTENSITY is in Babylon's light units
 * against a sun of ~4 at noon: 400 lifts the dusk bed from 28 to 110 (8-bit
 * luminance) with the forest and far trail untouched; 150 barely read and
 * 1000 was a searchlight. LAMP_EXPONENT only matters under the standard
 * falloff, which no material here uses.
 */
export const LAMP_RANGE = 25;
export const LAMP_ANGLE = 1.5;
export const LAMP_EXPONENT = 8;
export const LAMP_INTENSITY = 400;
export const LAMP_COLOUR: readonly [number, number, number] = [1.0, 0.92, 0.78];

export function createHeadlamp(scene: Scene, name: string): SpotLight {
  const light = new SpotLight(name, Vector3.Zero(), new Vector3(0, 0, 1), LAMP_ANGLE, LAMP_EXPONENT, scene);
  light.range = LAMP_RANGE;
  light.diffuse = new Color3(...LAMP_COLOUR);
  light.specular = new Color3(...LAMP_COLOUR);
  light.intensity = 0;
  light.shadowEnabled = false;
  return light;
}

export function setLamp(light: SpotLight, on: boolean): void {
  light.intensity = on ? LAMP_INTENSITY : 0;
}

/** Sun + fill + one lamp per player. Babylon binds lights per mesh in scene
 * order up to a material's maxSimultaneousLights (default 4), so without this
 * a third player's lamp lights nothing. Applied to every material, present and
 * future — GLB loads add their own. Babylon's canAffectMesh has no distance or
 * range test (Lights/light.js), so this budget is not "only meshes near a
 * cone pay" — every lit mesh in the scene evaluates min(2 + players,
 * LIGHT_BUDGET) lights per fragment regardless of where the cones point, and
 * an off lamp still occupies a slot (setLamp only zeroes intensity, the light
 * stays enabled). The cost is per light per lit mesh; a full 5-player party
 * (7 lights) is unmeasured — frame-time measurements toggled one lamp's
 * intensity under the same compiled 3-light shader in both states, so they
 * measured the falloff arithmetic, not the added light. */
export const LIGHT_BUDGET = 2 + MAX_PLAYERS;

export function budgetLights(scene: Scene): void {
  const apply = (m: Material): void => {
    if ("maxSimultaneousLights" in m) (m as { maxSimultaneousLights: number }).maxSimultaneousLights = LIGHT_BUDGET;
  };
  for (const m of scene.materials) apply(m);
  scene.onNewMaterialAddedObservable.add(apply);
}
