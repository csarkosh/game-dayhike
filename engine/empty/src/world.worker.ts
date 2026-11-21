/**
 * The empty game's world worker: the game's entry over the world's work
 * (`worldWork.ts`), a module worker which Vite bundles from the
 * `new Worker(new URL(...), { type: "module" })` in `page.ts`. The terrain
 * registers on every thread that runs the simulation, so that import comes
 * first. The empty game has no start of its own and names no cells ahead.
 */
import "./terrain.js";
import { serveWorldWork } from "@csarkosh/engine/game/worldWork";

serveWorldWork({ startOf: () => null, spawnCells: () => [] });
