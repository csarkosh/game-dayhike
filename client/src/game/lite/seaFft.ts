/**
 * The wind sea's FFT on Babylon Lite: three cascades computed each frame the
 * sea is drawn, read by the sea's material as two texture arrays
 * (`seaPlugin.ts`). The compute shaders are the game's own, as they are
 * (`shaders/oceanFft*.compute.wgsl`); what they bind, the workgroups of a
 * frame's four dispatches and the amplitudes a spectrum is uploaded as are
 * kept with no engine (`oceanFftPasses.ts`), and `oceanGpuFft.ts` runs the
 * same passes on Babylon.js. `windSeaField.ts` decides when this field is
 * the one drawn.
 *
 * - **A frame's four dispatches are one compute pass of the hike's own
 *   frame**, before every pass that draws: a task of the scene's frame
 *   graph, which runs only on a frame `step` asked for and is switched off
 *   again once that frame is drawn (`frameDrawn`). A frame that does not
 *   draw the sea is not stepped: no pass, no dispatch, no write.
 * - **A frame writes four bytes**: the seconds, folded into the sea's
 *   repeat, sent as the pass begins. The spectrum's amplitudes, 3 MB, are
 *   asked for when the sea's wind has moved by a step (`windSeaField.ts`)
 *   and are built and sent with the next frame that is stepped: a wind that
 *   moves while the sea is out of sight builds nothing and sends nothing
 *   until the sea is drawn again, and then once, for the wind as it last
 *   stood.
 * - **The first frame is dispatched by itself, inside a validation error
 *   scope on the device**, in commands of its own: a pipeline or a binding
 *   the device refuses is reported there, and the field fails (the sea then
 *   draws the baked loop) rather than spoiling every frame's commands after
 *   it. Nothing more is dispatched until the scope answers.
 * - **The pipelines compile off the frame**: the field is `compiling` until
 *   all four are ready, and nothing is dispatched before.
 * - **Held**: the amplitudes (3 MB) and the spectra (6 MB) in two storage
 *   buffers with no copy kept on the page, and the two pictures (1.5 MB
 *   each, half floats, a layer a cascade, read bilinear and wrapping).
 */
import {
  addComputeDispatch, addTaskAtStart, computeStorageBufferBinding, computeStorageTextureViewBinding, computeUniformBufferBinding, createComputeBindingSet,
  createComputeDispatch, createComputeShader, createComputeStorageTexture, createComputeTask, createComputeUniformArena, createStorageBuffer,
  disposeComputeBindingSet, disposeComputeShader, disposeStorageBuffer, prepareComputeTask, removeTask, submitComputeTasks, updateComputeUniformSlot,
  updateStorageBuffer,
  type ComputeStorageTexture, type EngineContext, type SceneContext, type Texture2DArray,
} from "@babylonjs/lite";
import {
  OCEAN_FFT_DISPATCH, OCEAN_FFT_EVOLVE_BINDINGS, OCEAN_FFT_H0_BYTES, OCEAN_FFT_PARAM_FLOATS, OCEAN_FFT_PASS_BINDINGS, OCEAN_FFT_RESOLVE_BINDINGS,
  OCEAN_FFT_SPECTRA_BYTES, fftParams, fftSeconds, gpuWindSeaH0, type FftBinding,
} from "../oceanFftPasses.js";
import { FFT_CASCADES, FFT_N } from "../oceanSpectrum.js";
import evolveSource from "../shaders/oceanFftEvolve.compute.wgsl?raw";
import passSource from "../shaders/oceanFftPass.compute.wgsl?raw";
import resolveSource from "../shaders/oceanFftResolve.compute.wgsl?raw";
import type { WindSeaFftField } from "../windSeaField.js";
import type { FrameUploads } from "./frameUploads.js";

/** The wind sea's FFT as the sea's material reads it and the renderer runs it. */
export type LiteSeaFft = WindSeaFftField<Texture2DArray> & {
  /** The frame the last `step` asked for has been drawn: nothing is dispatched again until the next `step`. */
  frameDrawn(): void;
  /** Frames a `step` asked the four dispatches of, and times a spectrum's amplitudes were sent. */
  readonly steps: number;
  readonly spectra: number;
};

/** A cascade's picture: half floats, four a texel, a layer a cascade, read bilinear and wrapping, written by the resolve pass. */
function cascadePicture(engine: EngineContext, label: string): Promise<ComputeStorageTexture> {
  return createComputeStorageTexture(engine, {
    width: FFT_N, height: FFT_N, depthOrArrayLayers: FFT_CASCADES.length, viewDimension: "2d-array", format: "rgba16float", access: "write-only", sampled: true,
    sampler: { addressModeU: "repeat", addressModeV: "repeat", magFilter: "linear", minFilter: "linear" }, label, invertY: false,
  });
}

const at = (bindings: Record<string, FftBinding>, name: string): FftBinding => {
  const binding = bindings[name];
  if (binding === undefined) throw new Error(`the wind sea's passes bind no ${name}`);
  return binding;
};

/**
 * The wind sea's FFT on `engine`, its pass the first of `scene`'s frame. Its
 * pictures read nothing drawn until the first frame: the field is not the
 * one drawn before it runs (`windSeaField.ts`).
 */
export async function createLiteSeaFft(engine: EngineContext, scene: SceneContext, uploads?: FrameUploads): Promise<LiteSeaFft> {
  const device = (engine as unknown as { _device: Pick<GPUDevice, "pushErrorScope" | "popErrorScope"> })._device;
  const disp = await cascadePicture(engine, "oceanWindDisp");
  const slope = await cascadePicture(engine, "oceanWindSlope");
  // Neither buffer keeps a copy on the page: the amplitudes are made again when the wind moves, the spectra are the GPU's own.
  const h0 = createStorageBuffer(engine, OCEAN_FFT_H0_BYTES, { label: "oceanFftH0", writable: true });
  const spectra = createStorageBuffer(engine, OCEAN_FFT_SPECTRA_BYTES, { label: "oceanFftSpectra", writable: true });

  const task = createComputeTask(engine, "oceanFft");
  // The passes' uniforms: written whole once, and a frame's seconds alone after that, as the pass begins.
  const params = createComputeUniformArena(task, OCEAN_FFT_PARAM_FLOATS * 4, 1, { label: "oceanFftParams" });
  updateComputeUniformSlot(params, 0, fftParams());
  const seconds = new Float32Array(1);

  const evolve = createComputeShader(engine, {
    name: "oceanFftEvolve", computeSource: evolveSource, bindings: [
      computeStorageBufferBinding("h0", { ...at(OCEAN_FFT_EVOLVE_BINDINGS, "h0"), access: "read" }),
      computeStorageBufferBinding("spectra", { ...at(OCEAN_FFT_EVOLVE_BINDINGS, "spectra"), access: "read-write" }),
      computeUniformBufferBinding("params", at(OCEAN_FFT_EVOLVE_BINDINGS, "params")),
    ],
  });
  const line = (name: string, entryPoint: string) => createComputeShader(engine, {
    name, computeSource: passSource, entryPoint, bindings: [computeStorageBufferBinding("spectra", { ...at(OCEAN_FFT_PASS_BINDINGS, "spectra"), access: "read-write" })],
  });
  const rows = line("oceanFftRows", "rows");
  const columns = line("oceanFftColumns", "columns");
  const picture = (name: string) => computeStorageTextureViewBinding(name, { ...at(OCEAN_FFT_RESOLVE_BINDINGS, name), format: "rgba16float", access: "write-only", viewDimension: "2d-array" });
  const resolve = createComputeShader(engine, {
    name: "oceanFftResolve", computeSource: resolveSource, bindings: [
      computeStorageBufferBinding("spectra", { ...at(OCEAN_FFT_RESOLVE_BINDINGS, "spectra"), access: "read" }),
      computeUniformBufferBinding("params", at(OCEAN_FFT_RESOLVE_BINDINGS, "params")),
      picture("disp"), picture("slope"),
    ],
  });
  const shaders = [evolve, rows, columns, resolve];
  const sets = [
    createComputeBindingSet(evolve, { h0, spectra, params: params.buffer }),
    createComputeBindingSet(rows, { spectra }),
    createComputeBindingSet(columns, { spectra }),
    createComputeBindingSet(resolve, { spectra, params: params.buffer, disp, slope }),
  ];
  const d = OCEAN_FFT_DISPATCH;
  const sizes = [d.evolve, d.rows, d.columns, d.resolve];
  shaders.forEach((shader, i) => {
    const size = sizes[i] as readonly [number, number, number];
    addComputeDispatch(task, createComputeDispatch(shader, sets[i] as (typeof sets)[number], { size: { x: size[0], y: size[1], z: size[2] } }));
  });
  // Off until a frame asks for it.
  task.executionEnabled = false;
  addTaskAtStart(scene, task);
  task.record();

  let ready = false;
  let failed = false;
  let ran = false;
  let disposed = false;
  // The first frame's validation: none asked yet, awaited, or answered clean.
  let validation: "unasked" | "awaited" | "clean" = "unasked";
  let steps = 0;
  let sent = 0;
  // The spectrum asked for and not built yet: the wind's state and the seed, kept until a frame is stepped.
  let asked: { u10: number; dir: [number, number]; seed: number } | null = null;
  const fail = (what: string, why: unknown): void => {
    if (!failed && !disposed) console.warn(`Ocean: ${what}; the sea draws without it.`, why);
    failed = true;
  };
  // The four pipelines compile together, whether or not the sea is in sight.
  prepareComputeTask(task).then(() => {
    ready = true;
  }, (reason: unknown) => fail("the wind sea's shaders did not compile", reason));

  return {
    disp: disp.sampledTexture as Texture2DArray,
    slope: slope.sampledTexture as Texture2DArray,
    get steps() {
      return steps;
    },
    get spectra() {
      return sent;
    },
    setSpectrum(state, seed) {
      if (!disposed) asked = { u10: state.u10, dir: [state.dir[0], state.dir[1]], seed };
    },
    step(at) {
      if (disposed || failed || !ready || validation === "awaited") return;
      if (asked !== null) {
        updateStorageBuffer(engine, h0, gpuWindSeaH0(asked, asked.seed));
        uploads?.count("uniforms", OCEAN_FFT_H0_BYTES);
        sent++;
        asked = null;
      }
      seconds[0] = fftSeconds(at);
      updateComputeUniformSlot(params, 0, seconds);
      uploads?.count("uniforms", seconds.byteLength);
      steps++;
      if (validation === "clean") {
        task.executionEnabled = true;
        return;
      }
      device.pushErrorScope("validation");
      try {
        task.executionEnabled = true;
        submitComputeTasks([task]);
        ran = true;
      } finally {
        // The scope is popped whatever the dispatches did, so it never holds the device's later errors.
        task.executionEnabled = false;
        validation = "awaited";
        device.popErrorScope().then(
          (error) => {
            if (error === null) validation = "clean";
            else fail("the device refused the wind sea's first frame", error.message);
          },
          (reason: unknown) => fail("the wind sea's first frame could not be checked", reason),
        );
      }
    },
    frameDrawn() {
      task.executionEnabled = false;
    },
    status() {
      if (failed) return "failed";
      return ran ? "running" : "compiling";
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      removeTask(scene, task);
      task.dispose();
      for (const set of sets) disposeComputeBindingSet(set);
      for (const shader of shaders) disposeComputeShader(shader);
      disposeStorageBuffer(h0);
      disposeStorageBuffer(spectra);
      // The two pictures stay bound in the sea's material while it stands: they go with the engine.
    },
  };
}
