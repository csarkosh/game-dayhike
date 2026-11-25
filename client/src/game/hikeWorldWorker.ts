import worldWorkerScript from "./world.worker.ts?worker&url";

/** Starts Day Hike's world worker (`world.worker.ts`): the entry is the game's, since a worker is named by a path; the page's side of it is `worldPrep.ts`. */
export function startHikeWorldWorker(): Worker {
  return new Worker(new URL("./world.worker.ts", import.meta.url), { type: "module" });
}

/** The address of that worker's script, the same file, for the page to fetch ahead of the worker: a browser asks for a worker's script last of all, behind the title's films (the engine's `workerScripts.ts`). */
export const HIKE_WORLD_WORKER_SCRIPT: string = worldWorkerScript;
