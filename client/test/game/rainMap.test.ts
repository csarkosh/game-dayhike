import { describe, it, expect, afterEach, beforeAll } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera.js";
import { Camera } from "@babylonjs/core/Cameras/camera.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { Constants } from "@babylonjs/core/Engines/constants.js";
import { Texture } from "@babylonjs/core/Materials/Textures/texture.js";
import { RenderTargetTexture } from "@babylonjs/core/Materials/Textures/renderTargetTexture.js";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial.js";
import { Effect } from "@babylonjs/core/Materials/effect.js";
import { createRainMap, RAIN_HEIGHT_FRAGMENT, RAIN_HEIGHT_VERTEX, RAIN_MAP_CLEAR, type RainMap } from "../../src/game/rainMap.js";
import { startTranslators, translateStage, type StartedTranslators } from "../../../tools/wgsl/lib/translators.mjs";
import { translatorInput, uniformityOff } from "../../src/game/wgslFormat.js";
import { drawnEffect, webgpuProcessingEngine } from "./helpers/webgpuProcessing.js";
import { timeLimit } from "../helpers/timeLimit.js";
import "@babylonjs/core/Meshes/thinInstanceMesh.js";

let engine: NullEngine | null = null;
afterEach(() => { engine?.dispose(); engine = null; });
function scene(): Scene {
  engine = new NullEngine();
  const s = new Scene(engine);
  s.activeCamera = new UniversalCamera("player", new Vector3(0, 2, 0), s);
  return s;
}

/** The map's own camera: the scene's cameras minus the player's. */
function mapCamera(s: Scene): Camera {
  const cam = s.cameras.find((c) => c.name === "rain_map_cam");
  if (!cam) throw new Error("no map camera");
  return cam;
}

describe("createRainMap", () => {
  it("is null on low, and on the other tiers one 512-texel half-float RGBA target with a depth buffer, drawn once", () => {
    const s = scene();
    expect(createRainMap(s, "low")).toBeNull();
    const map = createRainMap(s, "medium") as RainMap;
    expect(map).not.toBeNull();
    const t = map.texture;
    expect(t.name).toBe("rain_map");
    expect(t.getRenderWidth()).toBe(512);
    expect(t.getRenderHeight()).toBe(512);
    expect(t.renderTargetOptions.type).toBe(Constants.TEXTURETYPE_HALF_FLOAT);
    expect(t.renderTargetOptions.format).toBe(Constants.TEXTUREFORMAT_RGBA);
    expect(t.samplingMode).toBe(Texture.NEAREST_SAMPLINGMODE);
    expect(t.renderTargetOptions.generateDepthBuffer).toBe(true);
    expect(t.renderTargetOptions.generateMipMaps).toBe(false);
    expect(t.refreshRate).toBe(RenderTargetTexture.REFRESHRATE_RENDER_ONCE);
    expect(t.renderParticles).toBe(false);
    expect(t.renderSprites).toBe(false);
    expect(t.renderList?.length).toBe(0);
    // Registered with the scene, which draws it before the main pass.
    expect(s.customRenderTargets).toContain(t);
    map.dispose();
    expect(createRainMap(s, "high")).not.toBeNull();
  });

  it("clears to a height far below the world, open to the rain, so an unwritten texel never covers", () => {
    const s = scene();
    const map = createRainMap(s, "high") as RainMap;
    expect(RAIN_MAP_CLEAR).toEqual({ height: -1000, transmission: 1, lift: 0 });
    expect(map.texture.clearColor.asArray()).toEqual([-1000, 1, 0, 1]);
    map.dispose();
  });

  it("looks straight down through its own orthographic camera over 96 m, never the scene's active one", () => {
    const s = scene();
    const player = s.activeCamera;
    const map = createRainMap(s, "high") as RainMap;
    const cam = mapCamera(s);
    expect(map.texture.activeCamera).toBe(cam);
    expect(s.activeCamera).toBe(player);
    expect(s.activeCameras ?? []).not.toContain(cam);
    expect(cam.mode).toBe(Camera.ORTHOGRAPHIC_CAMERA);
    expect([cam.orthoLeft, cam.orthoRight, cam.orthoBottom, cam.orthoTop]).toEqual([-48, 48, -48, 48]);
    expect([cam.minZ, cam.maxZ]).toEqual([1, 200]);
    map.update({ x: 10, y: 5, z: -20 });
    expect(cam.position.asArray()).toEqual([10, 105, -20]);
    // A point 1 m east, 50 m below the camera and 2 m north of the centre is
    // 1 right, 2 up and 50 deep in the view: u runs along x, v along z.
    const view = cam.getViewMatrix(true);
    const p = Vector3.TransformCoordinates(new Vector3(11, 55, -18), view);
    expect(p.x).toBeCloseTo(1, 6);
    expect(p.y).toBeCloseTo(2, 6);
    expect(p.z).toBeCloseTo(50, 6);
    map.dispose();
  });

  it("moves by the step rule: the first update places it, then only a move of more than 8 m re-arms a render", () => {
    const s = scene();
    const map = createRainMap(s, "high") as RainMap;
    const t = map.texture;
    expect(map.centre.x).toBeNaN();
    expect(map.update({ x: 10, y: 5, z: -20 })).toBe(true);
    expect(map.centre).toEqual({ x: 10, y: 5, z: -20 });
    // Drawn once, then left: Babylon's counter runs past the once.
    expect(t._shouldRender()).toBe(true);
    expect(t._shouldRender()).toBe(false);
    expect(t._shouldRender()).toBe(false);
    expect(map.update({ x: 17, y: 9, z: -20 })).toBe(false);
    expect(map.centre).toEqual({ x: 10, y: 5, z: -20 });
    expect(t._shouldRender()).toBe(false);
    // Climbing alone is never a move.
    expect(map.update({ x: 10, y: 60, z: -20 })).toBe(false);
    expect(map.update({ x: 10, y: 9, z: -29 })).toBe(true);
    expect(map.centre).toEqual({ x: 10, y: 9, z: -29 });
    expect(mapCamera(s).position.asArray()).toEqual([10, 109, -29]);
    expect(t._shouldRender()).toBe(true);
    expect(t._shouldRender()).toBe(false);
    map.dispose();
  });

  it("registers a mesh into the render list with its kind's material for the map's pass, and takes it out again", () => {
    const s = scene();
    const map = createRainMap(s, "high") as RainMap;
    const ground = MeshBuilder.CreateGround("ring", { width: 2, height: 2 }, s);
    const roof = MeshBuilder.CreateBox("roof", { size: 1 }, s);
    const lake = MeshBuilder.CreateDisc("lake", { radius: 1 }, s);
    map.register(ground, "terrain");
    map.register(roof, "hard");
    map.register(lake, "water");
    map.register(roof, "hard");
    const listed = () => map.texture.renderList?.map((m) => m.name);
    expect(listed()).toEqual(["ring", "roof", "lake"]);
    const pass = map.texture.renderPassId;
    const over = (m: Mesh) => m.getMaterialForRenderPass(pass) as ShaderMaterial | undefined;
    expect(over(ground)?.name).toBe("rain_height_terrain");
    expect(over(roof)?.name).toBe("rain_height_hard");
    expect(over(lake)?.name).toBe("rain_height_water");
    expect(over(ground)).toBeInstanceOf(ShaderMaterial);
    // The mesh's own material is untouched for the main pass.
    expect(ground.material).toBeNull();
    map.unregister(roof);
    expect(listed()).toEqual(["ring", "lake"]);
    expect(over(roof)).toBeUndefined();
    map.unregister(roof);
    expect(listed()).toEqual(["ring", "lake"]);
    map.dispose();
  });

  it("builds three height materials from one stored shader: the terrain's reads the canopy density, the water's is open, the rest is hard", () => {
    const s = scene();
    const map = createRainMap(s, "high") as RainMap;
    const names = s.materials.map((m) => m.name).filter((n) => n.startsWith("rain_height_")).sort();
    expect(names).toEqual(["rain_height_hard", "rain_height_terrain", "rain_height_water"]);
    expect(Effect.ShadersStore["rainHeightVertexShader"]).toBe(RAIN_HEIGHT_VERTEX);
    expect(Effect.ShadersStore["rainHeightFragmentShader"]).toBe(RAIN_HEIGHT_FRAGMENT);
    const options = (name: string) =>
      (s.getMaterialByName(name) as unknown as { _options: { attributes: string[]; uniforms: string[]; defines: string[] } })._options;
    expect(options("rain_height_terrain").attributes).toEqual(["position", "terrainWeights2"]);
    expect(options("rain_height_terrain").defines).toEqual(["RAIN_HEIGHT_TERRAIN"]);
    expect(options("rain_height_hard").attributes).toEqual(["position"]);
    expect(options("rain_height_hard").defines).toEqual([]);
    expect(options("rain_height_water").defines).toEqual(["RAIN_HEIGHT_WATER"]);
    for (const name of names) expect(options(name).uniforms).toEqual(["world", "viewProjection"]);
    // Thin instances draw: the vertex stage carries the instancing includes
    // and builds the world position from `finalWorld`.
    expect(RAIN_HEIGHT_VERTEX).toContain("#include<instancesDeclaration>");
    expect(RAIN_HEIGHT_VERTEX).toContain("#include<instancesVertex>");
    expect(RAIN_HEIGHT_VERTEX).toContain("vec4 worldPos = finalWorld * vec4(position, 1.0);");
    expect(RAIN_HEIGHT_VERTEX).toContain("vHeight = worldPos.y;");
    expect(RAIN_HEIGHT_VERTEX).toContain("vCanopy = terrainWeights2.w;");
    // The texel: height, transmission, lift, with the map's literals.
    expect(RAIN_HEIGHT_FRAGMENT).toContain("float transmission = 1.0 - 0.65 * vCanopy;");
    expect(RAIN_HEIGHT_FRAGMENT).toContain("float lift = 10.0 * step(0.01, vCanopy);");
    expect(RAIN_HEIGHT_FRAGMENT).toContain("gl_FragColor = vec4(vHeight, transmission, lift, 1.0);");
    map.dispose();
  });

  it("never spells a hashed preprocessor keyword in a comment, nor a semicolon in a trailing one", () => {
    for (const line of `${RAIN_HEIGHT_VERTEX}\n${RAIN_HEIGHT_FRAGMENT}`.split("\n")) {
      const comment = line.indexOf("//");
      if (comment === -1) continue;
      expect(line.slice(comment)).not.toMatch(/#\s*(if|ifdef|ifndef|else|elif|endif|define)/);
      if (!line.trim().startsWith("//")) expect(line.slice(comment)).not.toContain(";");
    }
  });

  it("dispose takes the target out of the scene's custom targets and the materials and camera out of the scene", () => {
    const s = scene();
    const map = createRainMap(s, "high") as RainMap;
    const cam = mapCamera(s);
    const ground = MeshBuilder.CreateGround("ring", { width: 2, height: 2 }, s);
    map.register(ground, "terrain");
    map.dispose();
    expect(s.customRenderTargets).toEqual([]);
    expect(s.textures).not.toContain(map.texture);
    expect(s.cameras).not.toContain(cam);
    expect(s.materials.filter((m) => m.name.startsWith("rain_height_"))).toEqual([]);
    expect(ground.isDisposed()).toBe(false);
  });
});

describe("the height materials' stages, compiled", () => {
  let translators: StartedTranslators;
  beforeAll(async () => { translators = await startTranslators(); }, timeLimit(60_000));

  it("compile through glslang and translate to WGSL for a terrain ring, a thin-instanced bucket and a water ring", async () => {
    const gpu = webgpuProcessingEngine();
    const gpuScene = new Scene(gpu);
    try {
      gpuScene.activeCamera = new UniversalCamera("player", new Vector3(0, 2, 0), gpuScene);
      const map = createRainMap(gpuScene, "high") as RainMap;
      const ring = MeshBuilder.CreateGround("ring", { width: 2, height: 2, subdivisions: 1 }, gpuScene);
      ring.setVerticesData("terrainWeights2", new Float32Array(4 * 4), false, 4);
      const bucket = MeshBuilder.CreateBox("bucket", { size: 1 }, gpuScene);
      bucket.thinInstanceSetBuffer("matrix", new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]), 16, true);
      const lake = MeshBuilder.CreateDisc("lake", { radius: 1 }, gpuScene);
      // The map's materials, as the map's pass draws them, on the meshes' own
      // slot so the helper compiles them.
      ring.material = gpuScene.getMaterialByName("rain_height_terrain");
      bucket.material = gpuScene.getMaterialByName("rain_height_hard");
      lake.material = gpuScene.getMaterialByName("rain_height_water");
      const stages = async (mesh: Mesh) => {
        const effect = await drawnEffect(mesh);
        const defines = (effect as unknown as { defines: string }).defines;
        const stage = (kind: "vertex" | "fragment", code: string) =>
          translateStage(translators, { stage: kind, flag: uniformityOff(code), glsl: translatorInput(code, defines) });
        return { defines, vertex: stage("vertex", effect._vertexSourceCode), fragment: stage("fragment", effect._fragmentSourceCode) };
      };
      const terrain = await stages(ring);
      expect(terrain.defines).toContain("#define RAIN_HEIGHT_TERRAIN");
      expect(terrain.vertex).toContain("terrainWeights2");
      expect(terrain.fragment).toContain("vCanopy");
      const hard = await stages(bucket);
      expect(hard.defines).toContain("#define INSTANCES");
      expect(hard.defines).toContain("#define THIN_INSTANCES");
      expect(hard.vertex).toContain("world0");
      expect(hard.fragment).not.toContain("vCanopy");
      const water = await stages(lake);
      expect(water.defines).toContain("#define RAIN_HEIGHT_WATER");
      expect(water.fragment).not.toContain("vCanopy");
      map.dispose();
    } finally {
      gpuScene.dispose();
      gpu.dispose();
    }
  }, timeLimit(60_000));
});
