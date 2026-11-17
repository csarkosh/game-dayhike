/**
 * The handset's coiled cord as drawn: a thin dark rubber tube along the path the stage lays each
 * frame, made on the first lay and reshaped in place after (the path's length never changes). It
 * takes the cab's share of the sky's light, as the radio and the handset do. Its thickness and
 * its sides are the tube's own with no engine (`cordTubeGeometry.ts`), which a renderer that
 * writes its own mesh lays the same tube from.
 */
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { CreateTube } from "@babylonjs/core/Meshes/Builders/tubeBuilder.js";
import type { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import type { Scene } from "@babylonjs/core/scene.js";
import { CORD_TUBE_RADIUS, CORD_TUBE_SIDES } from "./cordTubeGeometry.js";
import { CAB_SKY } from "./sceneStage.js";

export function createCordTube(scene: Scene): { lay(path: { x: number; y: number; z: number }[]): void; dispose(): void } {
  const material = new PBRMaterial("mat_film_cord", scene);
  // #1c1d1f in linear light.
  material.albedoColor = new Color3(0.0116, 0.0122, 0.0137);
  material.metallic = 0;
  material.roughness = 0.7;
  material.environmentIntensity = CAB_SKY;
  let tube: Mesh | null = null;
  return {
    lay(path) {
      const points = path.map((p) => new Vector3(p.x, p.y, p.z));
      if (tube === null) {
        tube = CreateTube("film_cord", { path: points, radius: CORD_TUBE_RADIUS, tessellation: CORD_TUBE_SIDES, updatable: true }, scene);
        tube.material = material;
        tube.isPickable = false;
      } else {
        CreateTube("film_cord", { path: points, radius: CORD_TUBE_RADIUS, instance: tube });
      }
    },
    dispose() {
      tube?.dispose();
      material.dispose();
    },
  };
}
