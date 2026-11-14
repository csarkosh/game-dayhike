/**
 * The version of the library the game draws with, for the page. A failure of
 * a WebGPU engine is remembered for this browser and this version
 * (`EngineEnv.babylon`, `engineChoice.ts`), so a new version of either is
 * tried afresh.
 */
import { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine.js";

export function engineVersion(): string {
  return AbstractEngine.Version;
}
