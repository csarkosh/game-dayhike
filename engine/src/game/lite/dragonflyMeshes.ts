/**
 * The lake's dragonflies on Babylon Lite: one instanced card a kind (darner,
 * skimmer, damselfly), from the shapes and the lists made with no engine
 * (`dragonflyShapes.ts`). `dragonflyBehaviour.ts` decides where every unit
 * is; this module hands their instances to Lite.
 *
 * **The material**, as the game dresses it: white under the card's pattern
 * and the individual's colourway, seen from both sides and lit on one,
 * blended by the vertex's alpha so the wings are a translucent blur, with
 * the birds' wing beat (`wingPlugin.ts`) and the air.
 *
 * **What a unit carries rides where Lite can carry it.** The card's pattern
 * and its alpha are a vertex's two texture coordinates (the game's vertex
 * colour: a shade and an alpha). The wing's phase and amplitude and the
 * colourway ride in the last row of the instance's matrix, as a bird's do,
 * so a kind costs its matrices a frame it has a unit the view holds, and
 * nothing while it has none there: its mesh is hidden, and what moved
 * meanwhile is sent when one comes into view.
 */
import {
  addToScene, createMeshFromData, createPbrMaterial, disposeMeshGpu, removeFromScene, setMeshVisible, setThinInstanceCount, setThinInstances,
  type EngineContext, type MaterialPlugin, type Mesh, type PluginUniformBlock, type SceneContext,
} from "@babylonjs/lite";
import type { Dragonflies } from "../dragonflyBehaviour.js";
import { sphereInPlanes, type ViewPlane } from "../lakeSeen.js";
import {
  DRAGONFLY_COLOURS, DRAGONFLY_KINDS, DRAGONFLY_OMEGA, DRAGONFLY_ROUGHNESS, dragonflyGeometry, dragonflyHalfSpan, emptyDragonflyList, fillDragonflyList,
  type DragonflyList,
} from "../dragonflyShapes.js";
import { SEE_THROUGH_ORDER } from "./drawOrder.js";
import { oneSidedLightPlugin } from "./forestPlugins.js";
import type { FrameUploads } from "./frameUploads.js";
import { MATRIX_BYTES } from "./listMeshes.js";
import { WING_AMP_AT, WING_COLOURWAY_AT, WING_PHASE_AT, wingPlugin } from "./wingPlugin.js";
import vertexAlphaSource from "../shaders/dragonfly/vertexAlpha.wgsl?raw";
import { wgsl } from "../shaders/shaderText.js";

/** The card's alpha, a vertex's second texture coordinate, onto the surface's: the wings' membrane, the body whole. */
export function vertexAlphaPlugin(): MaterialPlugin {
  return { name: "VertexAlpha", priority: 225, getCustomCode: (stage) => (stage === "fragment" ? { CUSTOM_FRAGMENT_BEFORE_LIGHTS: wgsl(vertexAlphaSource) } : null) };
}

/**
 * A kind's instances as Lite takes them, from the game's list: each matrix
 * with the unit's wing phase, its amplitude and its colourway in the last
 * row. Written into `own` (at least `list.count` matrices long); true where
 * a float changed.
 */
export function dragonflyMatrices(list: DragonflyList, own: Float32Array): boolean {
  let moved = false;
  for (let i = 0; i < list.count; i++) {
    const at = i * 16;
    for (let k = 0; k < 16; k++) {
      let value = list.matrices[at + k] as number;
      if (k === WING_PHASE_AT) value = Math.fround(list.wing[i * 2] as number);
      else if (k === WING_AMP_AT) value = Math.fround(list.wing[i * 2 + 1] as number);
      else if (k === WING_COLOURWAY_AT) value = list.way[i] as number;
      if (own[at + k] !== value) {
        own[at + k] = value;
        moved = true;
      }
    }
  }
  return moved;
}

/** The sphere a unit's card is taken to fill, metres: its wings at three times life size. */
export const DRAGONFLY_SPHERE_M = 0.5;

/** Whether one of the first `count` matrices of `matrices` stands where `planes` hold its sphere. */
export function unitInPlanes(matrices: Float32Array, count: number, planes: readonly ViewPlane[]): boolean {
  for (let i = 0; i < count; i++) {
    if (sphereInPlanes(matrices[i * 16 + 12] as number, matrices[i * 16 + 13] as number, matrices[i * 16 + 14] as number, DRAGONFLY_SPHERE_M, planes)) return true;
  }
  return false;
}

export type LiteDragonflies = {
  /** The three kinds' meshes. */
  readonly meshes: readonly Mesh[];
  /** The kinds' units as they now stand; `seed` is the world's. A kind is drawn while the view's planes hold one of its units. */
  update(units: Dragonflies, seed: number): void;
  /** Units by kind, and the kinds drawn. */
  readonly counts: readonly [number, number, number];
  readonly shown: number;
  dispose(): void;
};

type Kind = { mesh: Mesh; list: DragonflyList; own: Float32Array; visible: boolean; stale: boolean };

/** The dragonflies' three meshes in `scene`, each hidden until it has a unit. `air` is the air's plugin, one a material. */
export function createLiteDragonflies(
  engine: EngineContext, scene: SceneContext,
  options: { air: () => MaterialPlugin; shared: PluginUniformBlock; planes: () => readonly ViewPlane[]; uploads?: FrameUploads },
): LiteDragonflies {
  const { uploads } = options;
  const kinds: Kind[] = DRAGONFLY_KINDS.map((name, k) => {
    const shape = dragonflyGeometry(k);
    // The pattern's shade and the membrane's alpha, a vertex: the game's vertex colour.
    const uvs = new Float32Array((shape.positions.length / 3) * 2);
    for (let i = 0; i < uvs.length / 2; i++) {
      uvs[i * 2] = shape.colors[i * 4] as number;
      uvs[i * 2 + 1] = shape.colors[i * 4 + 3] as number;
    }
    const mesh = createMeshFromData(engine, `dragonfly_${name}`, shape.positions, shape.normals, Uint32Array.from(shape.indices), uvs);
    const material = createPbrMaterial({
      baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: DRAGONFLY_ROUGHNESS, doubleSided: true, alphaBlend: true, usePhysicalLightFalloff: true,
    });
    material.plugins = [
      oneSidedLightPlugin(), wingPlugin(dragonflyHalfSpan(shape.positions), DRAGONFLY_OMEGA[k] as number, options.shared, DRAGONFLY_COLOURS[k] ?? []),
      vertexAlphaPlugin(), options.air(),
    ];
    mesh.material = material;
    // At the world's origin, as every see-through mesh stands: Lite orders them by their places (`drawOrder.ts`).
    mesh.renderOrder = SEE_THROUGH_ORDER.dragonflies + k / 16;
    setThinInstances(mesh, new Float32Array(16), 1);
    setThinInstanceCount(mesh, 0);
    setMeshVisible(mesh, false);
    addToScene(scene, mesh);
    uploads?.made();
    return { mesh, list: emptyDragonflyList(), own: new Float32Array(0), visible: false, stale: false };
  });
  const counts: [number, number, number] = [0, 0, 0];
  let shown = 0;
  let disposed = false;
  return {
    meshes: kinds.map((kind) => kind.mesh),
    counts,
    get shown() {
      return shown;
    },
    update(units, seed) {
      if (disposed) return;
      const planes = options.planes();
      kinds.forEach((kind, k) => {
        const list = fillDragonflyList(kind.list, units, k, seed);
        if (kind.own.length < list.matrices.length) {
          kind.own = new Float32Array(list.matrices.length);
          setThinInstances(kind.mesh, kind.own, kind.own.length / 16);
          kind.stale = true;
        }
        if (dragonflyMatrices(list, kind.own) || list.count !== counts[k as 0 | 1 | 2]) kind.stale = true;
        counts[k as 0 | 1 | 2] = list.count;
        const visible = list.count > 0 && unitInPlanes(list.matrices, list.count, planes);
        if (visible !== kind.visible) {
          kind.visible = visible;
          shown += visible ? 1 : -1;
          setMeshVisible(kind.mesh, visible);
        }
        // What moved is sent while the kind is drawn: out of view it waits.
        if (!visible || !kind.stale) return;
        kind.stale = false;
        setThinInstanceCount(kind.mesh, list.count);
        uploads?.count("instances", list.count * MATRIX_BYTES);
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const kind of kinds) {
        removeFromScene(scene, kind.mesh);
        disposeMeshGpu(kind.mesh);
        uploads?.dropped();
      }
    },
  };
}
