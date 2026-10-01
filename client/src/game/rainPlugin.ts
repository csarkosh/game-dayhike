/**
 * The streak plugin: a vertex-stage material plugin on the rain's unlit
 * Standard material that places every thin instance of a unit quad as one
 * drop of a camera-locked wrapped volume (`rainParams.ts` has the arithmetic
 * and its mirror), stretches it along its fall vector to the frame's streak
 * length, faces it to the camera and writes its alpha to one varying. The
 * fragment stage multiplies the material's alpha by it.
 *
 * The mesh's world matrix is identity and every thin-instance matrix is
 * identity, so the position this plugin computes at
 * CUSTOM_VERTEX_UPDATE_POSITION (before `instancesVertex` builds `finalWorld`
 * and the shader multiplies by it) IS the world position: Babylon's own
 * `worldPos`, and with it the fog distance and the clip position, follow from
 * it unchanged. The fragment stage runs at CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR,
 * where `color` is the fogged, visibility-scaled colour about to be written.
 *
 * The per-instance `rainSeed` attribute is the drop's seed (xyz in the unit
 * cube) and its class (w in {0, 1/3, 2/3, 1}); the class picks one lane of
 * the `rainSpeeds`, `rainWidths` and `rainAlphas` uniforms. The alpha is the
 * near and far fades, a fade against the sky by the view's upward component
 * at the drop, the class's own alpha, and the headlamp's inverse-square term
 * inside its cone; the lamp term also lifts the streak's colour toward the
 * lamp's, since the material's own colour is the fog's and at night that is
 * near black. `RAIN_DRIP` and `RAIN_OCCLUSION` are declared for the drip
 * volume and the cover map and read by nothing yet.
 *
 * Renderer-only by design — no constant here may migrate into sim/ or a
 * tunables registry, the foliagePlugin.ts rule.
 */
import { MaterialPluginBase } from "@babylonjs/core/Materials/materialPluginBase.js";
import type { Material } from "@babylonjs/core/Materials/material.js";
import type { MaterialDefines } from "@babylonjs/core/Materials/materialDefines.js";
import type { UniformBuffer } from "@babylonjs/core/Materials/uniformBuffer.js";
import type { Scene } from "@babylonjs/core/scene.js";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine.js";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh.js";
import type { SubMesh } from "@babylonjs/core/Meshes/subMesh.js";
import {
  RAIN_BOX, RAIN_CLASSES, RAIN_FADE_FAR, RAIN_FADE_NEAR, RAIN_LENGTH, RAIN_SKY_FADE, RAIN_STRETCH,
} from "./rainParams.js";

/** A GLSL float literal: always with a decimal point, so `1` is `1.0`. */
function lit(v: number): string {
  const s = String(v);
  return s.includes(".") || s.includes("e") ? s : `${s}.0`;
}

const RAIN_VERTEX_DEFS = `
#ifdef RAIN
attribute vec4 rainSeed;
varying float vRainAlpha;
varying float vRainLamp;
#endif
`;

// The plane is MeshBuilder's unit plane: `position.xy` in [-0.5, 0.5], so a
// corner's offset along the streak's width and length is the position times
// each. `rkSel` is the one-hot class lane; the cross product's length guards
// the drop seen straight along its own fall vector, whose quad has no width.
const RAIN_VERTEX_POSITION = `
#ifdef RAIN
{
  float rkI = floor(rainSeed.w * 3.0 + 0.5);
  vec4 rkSel = vec4(equal(vec4(rkI), vec4(0.0, 1.0, 2.0, 3.0)));
  float rSpeed = dot(rainSpeeds, rkSel);
  float rWidth = dot(rainWidths, rkSel);
  float rClassAlpha = dot(rainAlphas, rkSel);
  vec3 rDrift = vec3(rainDrift.x, -rSpeed * rainFold / rainBoxSize.y, rainDrift.y);
  vec3 rq = fract(rainSeed.xyz + rDrift - rainBoxMin / rainBoxSize);
  vec3 rp = rainBoxMin + rq * rainBoxSize;
  vec3 rAlong = normalize(vec3(rainWind.x, -rSpeed, rainWind.y));
  vec3 rToCam = rainCam - rp;
  float rDist = max(length(rToCam), 0.001);
  vec3 rView = rToCam / rDist;
  vec3 rSide = cross(rAlong, rView);
  vec3 rRight = rSide / max(length(rSide), 0.001);
  float rLen = clamp(rSpeed * rainDt * ${lit(RAIN_STRETCH)}, ${lit(RAIN_LENGTH[0])}, ${lit(RAIN_LENGTH[1])});
  positionUpdated = rp + rRight * (position.x * rWidth) + rAlong * (position.y * rLen);
  float rFade = smoothstep(${lit(RAIN_FADE_NEAR[0])}, ${lit(RAIN_FADE_NEAR[1])}, rDist) * (1.0 - smoothstep(${lit(RAIN_FADE_FAR[0])}, ${lit(RAIN_FADE_FAR[1])}, rDist));
  float rSky = 1.0 - ${lit(RAIN_SKY_FADE)} * smoothstep(0.0, 0.25, -rView.y);
  vec3 rToLamp = rp - rainLampPos;
  float rLampD2 = dot(rToLamp, rToLamp);
  float rCos = dot(rToLamp, rainLampDir) / sqrt(max(rLampD2, 0.0001));
  float rCone = smoothstep(rainLamp.y, 0.5 + 0.5 * rainLamp.y, rCos);
  float rLampT = rainLamp.x * rCone / (1.0 + rLampD2);
  vRainAlpha = rFade * (rSky * rClassAlpha + rLampT);
  vRainLamp = min(rLampT, 1.0);
}
#endif
`;

const RAIN_FRAGMENT_DEFS = `
#ifdef RAIN
varying float vRainAlpha;
varying float vRainLamp;
#endif
`;

// After the fog: a streak in the lamp's cone is lit by the lamp, not the haze.
const RAIN_FRAGMENT_BEFORE_FRAGCOLOR = `
#ifdef RAIN
color.rgb = mix(color.rgb, rainLampColour, vRainLamp);
color.a *= vRainAlpha;
#endif
`;

export class RainPlugin extends MaterialPluginBase {
  /** The box's low corner this frame, world metres. */
  boxMinX = 0;
  boxMinY = 0;
  boxMinZ = 0;
  /** The wind's folded horizontal drift, in units of the box, and the folded time. */
  driftX = 0;
  driftZ = 0;
  fold = 0;
  /** The smoothed frame duration the streak length reads, seconds. */
  dt = 1 / 60;
  /** The wind's horizontal velocity, m/s. */
  windX = 0;
  windZ = 0;
  /** The eye. */
  camX = 0;
  camY = 0;
  camZ = 0;
  /** The headlamp: position, direction, intensity (already scaled to alpha),
   * the cosine of its half-angle and its colour. */
  lampX = 0;
  lampY = 0;
  lampZ = 0;
  lampDirX = 0;
  lampDirY = 0;
  lampDirZ = 1;
  lampIntensity = 0;
  lampCosHalf = 1;
  lampR = 1;
  lampG = 1;
  lampB = 1;

  constructor(material: Material) {
    super(material, "Rain", 220, { RAIN: false, RAIN_DRIP: false, RAIN_OCCLUSION: false });
    this._enable(true);
  }

  override getClassName(): string {
    return "RainPlugin";
  }

  // One line, for the eslint-disable reason foliagePlugin.ts records.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  override prepareDefines(defines: MaterialDefines, _scene: Scene, _mesh: AbstractMesh): void {
    defines.RAIN = true;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  override getAttributes(attributes: string[], _scene: Scene, _mesh: AbstractMesh): void {
    attributes.push("rainSeed");
  }

  override getUniforms(): { ubo: { name: string; size: number; type: string }[]; vertex: string; fragment: string } {
    return {
      ubo: [
        { name: "rainBoxMin", size: 3, type: "vec3" },
        { name: "rainBoxSize", size: 3, type: "vec3" },
        { name: "rainDrift", size: 2, type: "vec2" },
        { name: "rainFold", size: 1, type: "float" },
        { name: "rainDt", size: 1, type: "float" },
        { name: "rainWind", size: 2, type: "vec2" },
        { name: "rainCam", size: 3, type: "vec3" },
        { name: "rainLampPos", size: 3, type: "vec3" },
        { name: "rainLampDir", size: 3, type: "vec3" },
        { name: "rainLamp", size: 2, type: "vec2" },
        { name: "rainSpeeds", size: 4, type: "vec4" },
        { name: "rainWidths", size: 4, type: "vec4" },
        { name: "rainAlphas", size: 4, type: "vec4" },
        { name: "rainLampColour", size: 3, type: "vec3" },
      ],
      vertex: `
#ifdef RAIN
uniform vec3 rainBoxMin;
uniform vec3 rainBoxSize;
uniform vec2 rainDrift;
uniform float rainFold;
uniform float rainDt;
uniform vec2 rainWind;
uniform vec3 rainCam;
uniform vec3 rainLampPos;
uniform vec3 rainLampDir;
uniform vec2 rainLamp;
uniform vec4 rainSpeeds;
uniform vec4 rainWidths;
uniform vec4 rainAlphas;
#endif
`,
      fragment: `
#ifdef RAIN
uniform vec3 rainLampColour;
#endif
`,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  override bindForSubMesh(uniformBuffer: UniformBuffer, _scene: Scene, _engine: AbstractEngine, _subMesh: SubMesh): void {
    const c = RAIN_CLASSES;
    uniformBuffer.updateFloat3("rainBoxMin", this.boxMinX, this.boxMinY, this.boxMinZ);
    uniformBuffer.updateFloat3("rainBoxSize", RAIN_BOX.x, RAIN_BOX.y, RAIN_BOX.z);
    uniformBuffer.updateFloat2("rainDrift", this.driftX, this.driftZ);
    uniformBuffer.updateFloat("rainFold", this.fold);
    uniformBuffer.updateFloat("rainDt", this.dt);
    uniformBuffer.updateFloat2("rainWind", this.windX, this.windZ);
    uniformBuffer.updateFloat3("rainCam", this.camX, this.camY, this.camZ);
    uniformBuffer.updateFloat3("rainLampPos", this.lampX, this.lampY, this.lampZ);
    uniformBuffer.updateFloat3("rainLampDir", this.lampDirX, this.lampDirY, this.lampDirZ);
    uniformBuffer.updateFloat2("rainLamp", this.lampIntensity, this.lampCosHalf);
    uniformBuffer.updateFloat4("rainSpeeds", c[0]!.speed, c[1]!.speed, c[2]!.speed, c[3]!.speed);
    uniformBuffer.updateFloat4("rainWidths", c[0]!.width, c[1]!.width, c[2]!.width, c[3]!.width);
    uniformBuffer.updateFloat4("rainAlphas", c[0]!.alpha, c[1]!.alpha, c[2]!.alpha, c[3]!.alpha);
    uniformBuffer.updateFloat3("rainLampColour", this.lampR, this.lampG, this.lampB);
  }

  override getCustomCode(shaderType: string): { [pointName: string]: string } | null {
    if (shaderType === "vertex") {
      return { CUSTOM_VERTEX_DEFINITIONS: RAIN_VERTEX_DEFS, CUSTOM_VERTEX_UPDATE_POSITION: RAIN_VERTEX_POSITION };
    }
    if (shaderType === "fragment") {
      return { CUSTOM_FRAGMENT_DEFINITIONS: RAIN_FRAGMENT_DEFS, CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR: RAIN_FRAGMENT_BEFORE_FRAGCOLOR };
    }
    return null;
  }
}

/** Attach the streak plugin to a material once; a second call returns the first's. */
export function attachRain(material: Material): RainPlugin {
  const existing = material.pluginManager?.getPlugin("Rain") as RainPlugin | null | undefined;
  if (existing) return existing;
  return new RainPlugin(material);
}
