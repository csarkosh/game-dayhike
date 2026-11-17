/**
 * The engine of Babylon.js behind a handle.
 *
 * Outside the renderer an engine is held as something that can be let go of
 * and no more (`engineHandle.ts`). The renderer on Babylon.js, the module
 * that makes its WebGPU engine and the one that keeps an engine between
 * hikes draw with it, and read it back as what it is here.
 */
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine.js";
import type { EngineHandle } from "./engineHandle.js";

/** The engine a handle stands for, for the game's own modules that draw with it. */
export function engineOf(handle: EngineHandle): AbstractEngine {
  return handle as AbstractEngine;
}
