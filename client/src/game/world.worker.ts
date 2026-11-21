/**
 * Day Hike's world worker: the game's entry over the world's work
 * (`worldWork.ts`), a module worker which Vite bundles from the
 * `new Worker(new URL(...), { type: "module" })` in `hikeWorldWorker.ts`. It
 * runs the sim's own code for the hike that is about to start, and the page
 * takes what it posts (`worldPrep.ts`).
 *
 * The sim's passes register as they are imported, on every thread that runs
 * the sim, so that import comes first.
 */
import "../sim/passes/index.js";
import { spawnChunkCells, trailheadStart } from "../sim/spawn.js";
import { serveWorldWork, type WorldWorkGame } from "@csarkosh/engine/game/worldWork";

/** Day Hike's part of the world's work: where the player first stands, and the chunk cells the first spawn reads. */
export const HIKE_WORLD_WORK: WorldWorkGame = { startOf: trailheadStart, spawnCells: spawnChunkCells };

serveWorldWork(HIKE_WORLD_WORK);
