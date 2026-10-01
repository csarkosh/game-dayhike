/**
 * The cover map: what the rain has to fall through, seen from above.
 *
 * A render target of RAIN_MAP.texels a side looks straight down on
 * RAIN_MAP.extent metres around the player from RAIN_MAP.height metres above
 * them, through its own orthographic camera (never the scene's active one,
 * and never in `scene.activeCameras`). Each texel holds, in RGBA half float,
 * the top surface's world height (R), its transmission (G: open ground 1,
 * terrain under canopy `1 - canopyBlock × density` from the terrain's own
 * per-vertex canopy density, props and cliffs 0, water 1) and a ceiling lift
 * (B: `canopyLift` metres over terrain with canopy, else 0). A streak whose
 * height is below R + B at its xz is under cover and fades by G
 * (`rainPlugin.ts`); a texel nothing drew holds the clear colour, a height
 * far below the world and a transmission of 1, so it never covers.
 *
 * Only registered meshes draw into it (the target's `renderList`), each
 * through one of three cheap shader materials by kind
 * (`setMaterialForRendering`), so a mesh keeps its own material for the main
 * pass. The depth test leaves the topmost surface in each texel: the camera
 * looks down, so nearer is higher, and a car roof over the road writes its
 * own height and hard cover. Particles and sprites are left out: the scene's
 * motes would otherwise be drawn into the map.
 *
 * It is drawn once, when `update` finds the player more than RAIN_MAP.step
 * from the centre it was last drawn at (`mapCentre`): the target is on
 * `scene.customRenderTargets`, which the scene renders before its main pass,
 * at REFRESHRATE_RENDER_ONCE, and a move re-arms that rate, which Babylon
 * reads as one more render. A registered mesh whose map material is not yet
 * compiled is skipped by that render and resets the counter itself, so the
 * map is drawn again next frame until every mesh is in it. A thin-instanced
 * mesh (a cliff bucket) draws every instance: the materials carry the
 * instancing includes, and Babylon adds the defines for a mesh that has them.
 *
 * Nothing on the low tier: its streaks fall through everything.
 */
import type { Scene } from "@babylonjs/core/scene.js";
import type { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { RenderTargetTexture } from "@babylonjs/core/Materials/Textures/renderTargetTexture.js";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial.js";
import { Effect } from "@babylonjs/core/Materials/effect.js";
import { Texture } from "@babylonjs/core/Materials/Textures/texture.js";
import { Constants } from "@babylonjs/core/Engines/constants.js";
import { TargetCamera } from "@babylonjs/core/Cameras/targetCamera.js";
import { Camera } from "@babylonjs/core/Cameras/camera.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { Color4 } from "@babylonjs/core/Maths/math.color.js";
// Side-effect imports, load-bearing: the includes the height shader's vertex
// stage pulls in are registered by these modules.
import "@babylonjs/core/Shaders/ShadersInclude/instancesDeclaration.js";
import "@babylonjs/core/Shaders/ShadersInclude/instancesVertex.js";

import type { QualityTier } from "./quality.js";
import { RAIN_MAP, mapCentre, type Vec3 } from "./rainParams.js";

/** What a registered mesh is to the rain: ground that may carry canopy, a
 * roof that stops it, or a surface it lands on and falls through. */
export type RainMapKind = "terrain" | "hard" | "water";

export type RainMap = {
  readonly texture: RenderTargetTexture;
  /** The centre the map was last drawn at (NaN before the first `update`). */
  readonly centre: Readonly<Vec3>;
  register(mesh: Mesh, kind: RainMapKind): void;
  unregister(mesh: Mesh): void;
  /** Moves the map to `player` by the step rule; true when it did, which is
   * the frame it is drawn again. */
  update(player: Vec3): boolean;
  dispose(): void;
};

/** The height shader's name in Babylon's shader store. */
export const RAIN_HEIGHT_SHADER = "rainHeight";

/** The defines that pick a kind's fragment. */
const KIND_DEFINES: Record<RainMapKind, string[]> = {
  terrain: ["RAIN_HEIGHT_TERRAIN"],
  hard: [],
  water: ["RAIN_HEIGHT_WATER"],
};

/** A GLSL float literal: always with a decimal point, so `10` is `10.0`. */
function lit(v: number): string {
  const s = String(v);
  return s.includes(".") || s.includes("e") ? s : `${s}.0`;
}

/** The world height and, on the terrain, the canopy density, to the fragment. */
export const RAIN_HEIGHT_VERTEX = `
attribute vec3 position;
#ifdef RAIN_HEIGHT_TERRAIN
attribute vec4 terrainWeights2;
varying float vCanopy;
#endif
#include<instancesDeclaration>
uniform mat4 viewProjection;
varying float vHeight;
void main(void) {
#include<instancesVertex>
  vec4 worldPos = finalWorld * vec4(position, 1.0);
  vHeight = worldPos.y;
#ifdef RAIN_HEIGHT_TERRAIN
  vCanopy = terrainWeights2.w;
#endif
  gl_Position = viewProjection * worldPos;
}
`;

/** The texel: height, transmission, lift. */
export const RAIN_HEIGHT_FRAGMENT = `
varying float vHeight;
#ifdef RAIN_HEIGHT_TERRAIN
varying float vCanopy;
#endif
void main(void) {
#ifdef RAIN_HEIGHT_TERRAIN
  float transmission = 1.0 - ${lit(RAIN_MAP.canopyBlock)} * vCanopy;
  float lift = ${lit(RAIN_MAP.canopyLift)} * step(0.01, vCanopy);
#elif defined(RAIN_HEIGHT_WATER)
  float transmission = 1.0;
  float lift = 0.0;
#else
  float transmission = 0.0;
  float lift = 0.0;
#endif
  gl_FragColor = vec4(vHeight, transmission, lift, 1.0);
}
`;

/** The clear colour: a height far below any world, open to the rain. */
export const RAIN_MAP_CLEAR = { height: -1000, transmission: 1, lift: 0 } as const;

/** Puts the height shader's stages in the store once. */
function storeHeightShader(): void {
  const vertex = `${RAIN_HEIGHT_SHADER}VertexShader`;
  if (Effect.ShadersStore[vertex] === undefined) {
    Effect.ShadersStore[vertex] = RAIN_HEIGHT_VERTEX;
    Effect.ShadersStore[`${RAIN_HEIGHT_SHADER}FragmentShader`] = RAIN_HEIGHT_FRAGMENT;
  }
}

/** The cover map on medium and high; null on low. */
export function createRainMap(scene: Scene, tier: QualityTier): RainMap | null {
  if (tier === "low") return null;
  storeHeightShader();

  const texture = new RenderTargetTexture(
    "rain_map",
    RAIN_MAP.texels,
    scene,
    {
      generateMipMaps: false,
      type: Constants.TEXTURETYPE_HALF_FLOAT,
      format: Constants.TEXTUREFORMAT_RGBA,
      // Nearest: a texel between a roof and the ground must hold one of
      // them, not a height and a transmission halfway between.
      samplingMode: Texture.NEAREST_SAMPLINGMODE,
      generateDepthBuffer: true,
    },
  );
  texture.renderList = [];
  texture.renderParticles = false;
  texture.renderSprites = false;
  texture.clearColor = new Color4(RAIN_MAP_CLEAR.height, RAIN_MAP_CLEAR.transmission, RAIN_MAP_CLEAR.lift, 1);
  texture.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE;

  // Straight down: pitched a quarter turn, with the up vector following the
  // rotation (without that it stays world up, along the view, and the view
  // matrix degenerates). Then the view's x is world x and its y is world z,
  // so the texture's u runs along x and its v along z.
  const half = RAIN_MAP.extent / 2;
  const camera = new TargetCamera("rain_map_cam", new Vector3(0, RAIN_MAP.height, 0), scene, false);
  camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
  camera.orthoLeft = -half;
  camera.orthoRight = half;
  camera.orthoBottom = -half;
  camera.orthoTop = half;
  camera.minZ = 1;
  camera.maxZ = 2 * RAIN_MAP.height;
  camera.updateUpVectorFromRotation = true;
  camera.rotation.set(Math.PI / 2, 0, 0);
  texture.activeCamera = camera;
  scene.customRenderTargets.push(texture);

  const materials = {} as Record<RainMapKind, ShaderMaterial>;
  for (const kind of ["terrain", "hard", "water"] as const) {
    const material = new ShaderMaterial(`rain_height_${kind}`, scene, RAIN_HEIGHT_SHADER, {
      attributes: kind === "terrain" ? ["position", "terrainWeights2"] : ["position"],
      uniforms: ["world", "viewProjection"],
      defines: KIND_DEFINES[kind],
    });
    material.backFaceCulling = false;
    materials[kind] = material;
  }

  const centre: Vec3 = { x: Number.NaN, y: Number.NaN, z: Number.NaN };
  const next: Vec3 = { x: 0, y: 0, z: 0 };

  return {
    texture,
    centre,
    // Both guard the list: `dispose` leaves it null, and a registry call can
    // land after it (a prop chunk dropped as the renderer goes).
    register(mesh, kind) {
      const list = texture.renderList;
      if (list === null) return;
      if (!list.includes(mesh)) list.push(mesh);
      texture.setMaterialForRendering(mesh, materials[kind]);
    },
    unregister(mesh) {
      const list = texture.renderList;
      if (list === null) return;
      const at = list.indexOf(mesh);
      if (at !== -1) list.splice(at, 1);
      if (!mesh.isDisposed()) texture.setMaterialForRendering(mesh, undefined);
    },
    update(player) {
      if (Number.isNaN(centre.x)) {
        next.x = player.x;
        next.y = player.y;
        next.z = player.z;
      } else {
        mapCentre(centre, player, next);
        if (next.x === centre.x && next.z === centre.z) return false;
      }
      centre.x = next.x;
      centre.y = next.y;
      centre.z = next.z;
      camera.position.set(centre.x, centre.y + RAIN_MAP.height, centre.z);
      texture.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
      return true;
    },
    dispose() {
      const at = scene.customRenderTargets.indexOf(texture);
      if (at !== -1) scene.customRenderTargets.splice(at, 1);
      texture.dispose();
      camera.dispose();
      for (const material of Object.values(materials)) material.dispose();
    },
  };
}
