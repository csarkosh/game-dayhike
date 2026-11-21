/** Starts Day Hike's world worker (`world.worker.ts`): the entry is the game's, since a worker is named by a path; the page's side of it is `worldPrep.ts`. */
export function startHikeWorldWorker(): Worker {
  return new Worker(new URL("./world.worker.ts", import.meta.url), { type: "module" });
}
