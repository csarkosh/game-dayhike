/**
 * What the suite can see of a material as Babylon's WebGPU engine builds it.
 * The suite cannot translate a shader to WGSL or make a device (both need a
 * browser), but Babylon's WebGPU GLSL processing runs on `NullEngine`: given
 * the processor and its processing context, an effect comes out with the
 * locations of its varyings and the bindings of each stage as the WebGPU
 * engine would lay them out. `interStage.test.ts` and `stageBindings.test.ts`
 * read them.
 */
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { WebGPUShaderProcessorGLSL } from "@babylonjs/core/Engines/WebGPU/webgpuShaderProcessorsGLSL.js";
import { WebGPUShaderProcessingContext } from "@babylonjs/core/Engines/WebGPU/webgpuShaderProcessingContext.js";
import type { Scene } from "@babylonjs/core/scene.js";
import type { Mesh } from "@babylonjs/core/Meshes/mesh.js";

/**
 * A `NullEngine` that processes GLSL as the WebGPU engine does, with the caps
 * of the WebGPU engine's that shape a material's shader (canaries in
 * `stageBindings.test.ts`): derivatives, which the normal map's basis needs;
 * texture LOD, which spares a PBR material the two extra reflection samplers
 * it takes without it; and uniform buffers, which WebGPU always binds.
 */
export function webgpuProcessingEngine(): NullEngine {
  const engine = new NullEngine();
  const processing = engine as unknown as {
    _shaderProcessor: unknown;
    _getShaderProcessingContext: (language: number) => unknown;
  };
  processing._shaderProcessor = new WebGPUShaderProcessorGLSL();
  processing._getShaderProcessingContext = (language) => new WebGPUShaderProcessingContext(language, false);
  const caps = engine.getCaps();
  caps.standardDerivatives = true;
  caps.textureLOD = true;
  Object.defineProperty(engine, "supportsUniformBuffers", { get: () => true });
  return engine;
}

type Readiness = { isReady(): boolean; getInternalTexture(): { isReady: boolean } | null };

/** Marks a texture ready: NullEngine never uploads or renders one. */
function markReady(texture: Readiness): void {
  if (texture.isReady()) return;
  const internal = texture.getInternalTexture();
  if (internal) internal.isReady = true;
  if (!texture.isReady()) (texture as unknown as { isReady: () => boolean }).isReady = () => true;
}

/** The scene's environment (the reflection probe's cube), ready as it is once
 * it first renders, which on NullEngine it never does. */
export function probeReady(scene: Scene): void {
  const probe = scene.environmentTexture as unknown as Readiness | null;
  if (probe) markReady(probe);
}

/** The processed effect a mesh draws its material with, once ready: every
 * texture on the material and its plugins marked ready, the compile given a
 * few ticks. */
export async function drawnEffect(mesh: Mesh): Promise<ProcessedEffect> {
  const material = mesh.material;
  const subMesh = mesh.subMeshes?.[0];
  if (!material || !subMesh) throw new Error(`${mesh.name} draws nothing`);
  const texturesReady = (): void => {
    const own = (material as unknown as { getActiveTextures(): Readiness[] }).getActiveTextures();
    const plugins = (material as unknown as { pluginManager?: { _plugins: object[] } }).pluginManager?._plugins ?? [];
    const held = plugins.flatMap((plugin) =>
      Object.values(plugin).filter(
        (value): value is Readiness =>
          value !== null && typeof value === "object" && typeof (value as { getInternalTexture?: unknown }).getInternalTexture === "function",
      ),
    );
    for (const texture of [...own, ...held]) markReady(texture);
  };
  for (let tick = 0; tick < 50; tick++) {
    texturesReady();
    if (material.isReadyForSubMesh(mesh, subMesh, true)) return subMesh.effect as unknown as ProcessedEffect;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`${material.name} never became ready on the NullEngine`);
}

/** An effect as Babylon's WebGPU processing leaves it. */
export type ProcessedEffect = {
  _processingContext: {
    _varyingNextLocation: number;
    bindGroupLayoutEntries: (({ visibility: number; texture?: unknown; storageTexture?: unknown; externalTexture?: unknown; sampler?: unknown; buffer?: unknown } | undefined)[] | undefined)[];
    availableTextures: Record<string, unknown>;
    availableBuffers: Record<string, unknown>;
  };
  _vertexSourceCode: string;
  _fragmentSourceCode: string;
};

/** What one stage binds, counted as WebGPU's per-stage limits count it. */
export type StageBindings = { textures: number; samplers: number; uniformBuffers: number };

/** The bindings each stage of `effect` sees, from its bind group layouts. */
export function stageBindings(effect: ProcessedEffect): { vertex: StageBindings; fragment: StageBindings } {
  const count = (bit: number): StageBindings => {
    const seen: StageBindings = { textures: 0, samplers: 0, uniformBuffers: 0 };
    for (const group of effect._processingContext.bindGroupLayoutEntries) {
      for (const entry of group ?? []) {
        if (!entry || (entry.visibility & bit) === 0) continue;
        if (entry.texture || entry.storageTexture || entry.externalTexture) seen.textures++;
        if (entry.sampler) seen.samplers++;
        if (entry.buffer && ((entry.buffer as { type?: string }).type ?? "uniform") === "uniform") seen.uniformBuffers++;
      }
    }
    return seen;
  };
  // GPUShaderStage.VERTEX is 1, FRAGMENT 2.
  return { vertex: count(1), fragment: count(2) };
}
