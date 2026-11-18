/**
 * An engine as everything outside the renderer holds it.
 *
 * A renderer makes its engine from the canvas it is built on and lets it go
 * with itself; the hike tells one engine from another when a failure is
 * reported (`answerFailures`). None of that reads what the engine is made of,
 * so outside the renderer it is held as this: something that can be let go
 * of, and that says whether it has been. The same object all along, so it is
 * its own identity. What draws with it is the renderer's own business.
 * Loads and names no engine.
 */
export type EngineHandle = {
  /** Whether the engine has been let go of. */
  readonly isDisposed: boolean;
  /** Lets go of the engine and everything drawn with it. */
  dispose(): void;
};

/** Which engine a renderer draws with (`Renderer.engineName`): WebGPU for the
 * hike's renderer, which draws with nothing else. */
export type EngineName = "webgpu";
