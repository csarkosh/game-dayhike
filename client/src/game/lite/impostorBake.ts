/**
 * A far tree's bake on Babylon Lite: a tree's meshes drawn side-on into a
 * target of their own, twice, and the two pictures read back as pixels. What
 * is drawn, how it is posed and how it is framed are the game's own
 * (`impostorBake.ts`); what the pictures are is the bake plugin's
 * (`impostorBakePlugin`, `forestPlugins.ts`).
 *
 * **A bake is drawn outside the hike's frames.** It has a scene of its own
 * on a surface of its own, a canvas of one pixel nothing ever shows: Lite
 * draws a frame of the surfaces it is told, so a bake draws when it is ready
 * to and waits for no frame of the hike's, which the page may not be drawing
 * while it loads. The hike's own frames name the hike's surface alone.
 *
 * **One bake at a time**, in the order asked. A bake's scene holds its
 * meshes, an orthographic camera at the bake's frame and one render task
 * into a square target with a depth buffer and no multisampling, cleared to
 * nothing: where no tree is drawn the alpha stays 0. Every mesh is drawn as
 * one thin instance at the bake's pose, so a model whose rest is not how it
 * stands (the snag, modelled lying down) is turned by its draw and keeps its
 * own coordinates for its material. The scene is registered, which asks for
 * its pipelines, drawn at the first picture's mode and read, drawn again at
 * the second's and read, and let go with its meshes and its target. While a
 * hike loads the pipelines are asked for off the page's thread and the pass
 * draws whole or not at all (`drawWhole`): each picture is drawn once they
 * are in, and drawn again where a frame drew nothing. Once the hike's own
 * scene makes its pipelines at once (`atOnce`), so does a bake's.
 *
 * **The pixels are the picture's rows from its foot up**, four bytes a texel
 * as the draw wrote them, the colour in gamma space. The distance field
 * made of them (`impostorField.ts`) breaks its ties by the order it walks
 * the rows in, so the order is part of what a far tree looks like.
 */
import {
  addTask, addToScene, createFreeCamera, createRenderTargetTexture, createRenderTask, createSceneContext, createSurface, disposeMeshGpu,
  disposeScene, disposeSurface, enableMaterialPlugins, enableOrthographicCamera, isRenderTaskHeld, markMaterialUboDirty, readTexturePixelsRGBA8, registerScene,
  renderFrame, setThinInstances, vec3, whenRenderTaskPipelinesIdle,
  type EngineContext, type Mesh, type PbrMaterialProps, type SceneContext, type SurfaceContext,
} from "@babylonjs/lite";
import { IMPOSTOR_BAKE_SIZE, type ImpostorBakeFrame, type ImpostorBakeMode } from "../impostorBake.js";

/** One mesh of a bake: made for it alone, its material carrying the bake's plugin, and what its material reads an instance, if anything. */
export type BakeMesh = { mesh: Mesh; instance: Float32Array | null };

/** A bake's two pictures, `IMPOSTOR_BAKE_SIZE` a side, four bytes a texel, the first row the picture's foot. */
export type BakedPictures = { albedo: Uint8Array; normal: Uint8Array };

export type ImpostorBaker = {
  /** Which picture the next draw writes: the one object every bake material's plugin reads. */
  readonly picture: { mode: ImpostorBakeMode };
  /**
   * The two pictures of `meshes` under `pose`, framed by `frame`. The meshes
   * are made when the bake's turn comes and are the bake's from then: they
   * go with its scene, whatever comes of it. Null once the baker is
   * disposed, and no mesh is made; it rejects where the scene cannot be
   * built or its pixels cannot be read.
   */
  bake(meshes: () => readonly BakeMesh[], pose: Float32Array, frame: ImpostorBakeFrame): Promise<BakedPictures | null>;
  /** Ends the bakes: one in flight resolves null, none starts after, and the surface goes. */
  dispose(): void;
};

/**
 * The bakes of `engine`, each drawn on a surface of the baker's own, made at
 * the first. `atOnce`: whether the hike's own scene makes its pipelines at
 * once now, as a bake's scene then does too.
 */
export function createImpostorBaker(engine: EngineContext, atOnce: () => boolean = () => false): ImpostorBaker {
  const picture: { mode: ImpostorBakeMode } = { mode: 1 };
  let surface: SurfaceContext | null = null;
  let disposed = false;
  /** The bakes asked for, one after another. */
  let turn: Promise<unknown> = Promise.resolve();

  async function run(make: () => readonly BakeMesh[], pose: Float32Array, frame: ImpostorBakeFrame): Promise<BakedPictures | null> {
    if (disposed) return null;
    const meshes = make();
    /** The meshes no scene has taken yet: let go here where the bake ends before its scene holds them. */
    const loose = new Set(meshes.map((part) => part.mesh));
    const release = (): void => {
      for (const mesh of loose) disposeMeshGpu(mesh);
      loose.clear();
    };
    let scene: SceneContext | null = null;
    try {
      // Nothing is shown on it: a frame of this surface draws the bake's scene and no other.
      surface ??= createSurface(engine, new OffscreenCanvas(1, 1), { msaaSamples: 1 });
      const drawn = surface;
      scene = createSceneContext(drawn, { defaultRenderTask: false });
      if (atOnce()) scene.syncPipelines = true;
      enableMaterialPlugins(scene);
      // Side-on and orthographic: the picture's square is the frame's extent across and up.
      const camera = createFreeCamera(vec3(frame.eye.x, frame.eye.y, frame.eye.z), vec3(frame.centre.x, frame.centre.y, frame.centre.z));
      camera.nearPlane = frame.near;
      camera.farPlane = frame.far;
      enableOrthographicCamera(camera, {
        halfHeight: frame.height / 2, left: -frame.width / 2, right: frame.width / 2, bottom: -frame.height / 2, top: frame.height / 2,
      });
      addToScene(scene, camera);
      const materials: PbrMaterialProps[] = [];
      for (const { mesh, instance } of meshes) {
        setThinInstances(mesh, pose.slice(), 1);
        if (instance !== null && mesh.thinInstances !== undefined && mesh.thinInstances !== null) mesh.thinInstances.pluginData = instance;
        addToScene(scene, mesh);
        loose.delete(mesh);
        materials.push(mesh.material as PbrMaterialProps);
      }
      const target = createRenderTargetTexture(engine, {
        lbl: "forest_impostor_bake", format: "rgba8unorm", dFormat: "depth24plus", samples: 1,
        size: { width: IMPOSTOR_BAKE_SIZE, height: IMPOSTOR_BAKE_SIZE },
      });
      // The task owns the target: it goes with the scene.
      // Its picture is kept and read back: it draws whole or not at all (`drawWhole`), and is drawn once its pipelines are in.
      const task = createRenderTask({ name: "forest_impostor_bake", rt: target.rt, clr: true, clrColor: { r: 0, g: 0, b: 0, a: 0 }, drawWhole: true }, engine, scene);
      addTask(scene, task);
      await registerScene(scene);
      await whenRenderTaskPipelinesIdle(task);
      const draw = async (mode: ImpostorBakeMode): Promise<Uint8Array | null> => {
        if (disposed) return null;
        picture.mode = mode;
        for (const material of materials) markMaterialUboDirty(material);
        renderFrame(engine, 0, [drawn]);
        // A frame that drew nothing, a pipeline still compiling, is drawn again once those its draws waited for are in: each
        // wait ends only when a pipeline lands, and a bake that never ends is given up by its own bound
        // (`IMPOSTOR_BAKE_FAIL_MS`, `forestMeshes.ts`), as one whose read never comes back is.
        while (isRenderTaskHeld(task)) {
          await whenRenderTaskPipelinesIdle(task);
          if (disposed) return null;
          renderFrame(engine, 0, [drawn]);
        }
        // The target's first row is the picture's top: read from the last.
        const read = await readTexturePixelsRGBA8(engine, target.texture, { flipY: true });
        return disposed ? null : read.pixels;
      };
      const albedo = await draw(1);
      const normal = albedo === null ? null : await draw(2);
      return albedo === null || normal === null ? null : { albedo, normal };
    } finally {
      // Its meshes are in no other scene: they go with it, and the target with its task.
      if (scene !== null) disposeScene(scene);
      release();
    }
  }

  return {
    picture,
    bake(meshes, pose, frame) {
      const result = turn.then(() => run(meshes, pose, frame));
      turn = result.catch(() => undefined);
      return result;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      // After whatever bake is in flight has let its scene go.
      void turn.then(() => {
        if (surface !== null) disposeSurface(surface);
        surface = null;
      });
    },
  };
}
