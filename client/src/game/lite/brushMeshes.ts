/**
 * A hand-authored level's brushes on Babylon Lite: the boxes the level is
 * built of (`propBoxes.ts` `brushBoxes`), drawn where a world has no forest
 * and so no terrain of its own. A hike's world always has a forest, so no
 * hike draws them; the levels the tests and the sandbox stand in do.
 *
 * - **A material's brushes are one mesh.** A brush never moves, and every
 *   brush of a material's name is the same matt surface in that name's
 *   colour (`propColour`), so they are one geometry and one draw: six draws
 *   for the sandbox's thirteen brushes, where the game on Babylon.js draws
 *   a box a brush.
 * - **The weather wets them as it wets the game's**: a brush's material has
 *   no porosity of its own, so its colour and its roughness are scaled as a
 *   whole by how wet the weather is (`wetSurfaceUnder`), written when that
 *   moves and at no other frame.
 * - They stand under the air, lit by the sun, the fill and the lamps, on the
 *   tier's own colour path, as every other surface is.
 */
import {
  addToScene, createMeshFromData, createPbrMaterial, disposeMeshGpu, markMaterialUboDirty, removeFromScene,
  type EngineContext, type MaterialPlugin, type Mesh, type PbrMaterialProps, type SceneContext,
} from "@babylonjs/lite";
import { PROP_ROUGHNESS, propBoxesGeometry, propColour, type PropBox } from "../propBoxes.js";
import { DRAW_ORDER, createDrawOrders } from "./drawOrder.js";
import type { FrameUploads } from "./frameUploads.js";

export type LiteBrushes = {
  /** The brushes' colour and roughness under the weather's wet: written where either has moved. True where it wrote. */
  wet(albedoScale: number, roughnessScale: number): boolean;
  /** The meshes that draw them: one a material's name. */
  readonly meshes: readonly Mesh[];
  dispose(): void;
};

/** The brushes `boxes` in `scene`, a mesh a material's name, in the order the names first come. */
export function createLiteBrushes(engine: EngineContext, scene: SceneContext, boxes: readonly PropBox[], options: { air: () => MaterialPlugin; uploads?: FrameUploads }): LiteBrushes {
  const orders = createDrawOrders(DRAW_ORDER.props);
  const groups = new Map<string, PropBox[]>();
  for (const box of boxes) {
    const group = groups.get(box.material);
    if (group === undefined) groups.set(box.material, [box]);
    else group.push(box);
  }
  const made: { mesh: Mesh; material: PbrMaterialProps; colour: readonly [number, number, number] }[] = [];
  for (const [name, group] of groups) {
    const colour = propColour(name);
    const material = createPbrMaterial({ baseColorFactor: [colour[0], colour[1], colour[2], 1], metallicFactor: 0, roughnessFactor: PROP_ROUGHNESS, usePhysicalLightFalloff: true });
    material.plugins = [options.air()];
    orders.take(material);
    const geometry = propBoxesGeometry(group);
    const mesh = createMeshFromData(engine, `brushes_${name}`, geometry.positions, geometry.normals, geometry.indices);
    mesh.material = material;
    mesh.renderOrder = orders.of(material) ?? DRAW_ORDER.props;
    addToScene(scene, mesh);
    options.uploads?.count("geometry", geometry.positions.byteLength + geometry.normals.byteLength + geometry.indices.byteLength, 3);
    options.uploads?.made();
    made.push({ mesh, material, colour });
  }
  const written = { albedo: 1, roughness: 1 };
  let disposed = false;
  return {
    meshes: made.map((one) => one.mesh),
    wet(albedoScale, roughnessScale) {
      if (disposed || (albedoScale === written.albedo && roughnessScale === written.roughness)) return false;
      written.albedo = albedoScale;
      written.roughness = roughnessScale;
      for (const { material, colour } of made) {
        const base = material.baseColorFactor;
        if (base !== undefined) {
          base[0] = colour[0] * albedoScale;
          base[1] = colour[1] * albedoScale;
          base[2] = colour[2] * albedoScale;
        }
        material.roughnessFactor = PROP_ROUGHNESS * roughnessScale;
        markMaterialUboDirty(material);
      }
      options.uploads?.marked(made.length);
      return made.length > 0;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const { mesh } of made) {
        removeFromScene(scene, mesh);
        disposeMeshGpu(mesh);
        options.uploads?.dropped();
      }
    },
  };
}
