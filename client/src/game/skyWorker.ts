/**
 * Where the sky's slices come from: the module worker (`sky.worker.ts`), which
 * makes them off the main thread in the order the start hour needs them, or,
 * where there is no Worker or the worker fails, this thread, one slice per
 * timer so a frame is never held for more than one. Either way the slices
 * fill one table, which the page keeps for its life.
 */
import { SLICE_ALTITUDES_DEG, buildSkyTables, buildSlice, type SkyTables } from "./skyModel.js";
import { createSkyTable, sliceOrder, type SkyTable } from "./skyTable.js";
import type { SkyWorkerReply, SkyWorkerRequest } from "./sky.worker.js";

export type SkySource = { readonly table: SkyTable; dispose(): void };

/** Starts the worker (new Worker(new URL("./sky.worker.ts", import.meta.url), { type: "module" }))
 *  and fills a table as slices arrive. Where Worker is undefined it makes the same slices in this
 *  thread, one per setTimeout(0), in the same order. dispose terminates the worker or stops the loop. */
export function startSkySource(startDeg: number): SkySource {
  const table = createSkyTable();
  const order = sliceOrder(startDeg);
  let disposed = false;
  let worker: Worker | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function endWorker(): void {
    if (worker === null) return;
    worker.onmessage = null;
    worker.onerror = null;
    worker.onmessageerror = null;
    worker.terminate();
    worker = null;
  }

  // In this thread: the tables with the first slice, then one slice per
  // timer, skipping any a failed worker already delivered.
  function runHere(): void {
    endWorker();
    let tables: SkyTables | null = null;
    let next = 0;
    const step = (): void => {
      timer = null;
      if (disposed) return;
      while (next < order.length && table.has(SLICE_ALTITUDES_DEG[order[next] as number] as number)) next++;
      if (next >= order.length) return;
      tables ??= buildSkyTables();
      const altitudeDeg = SLICE_ALTITUDES_DEG[order[next] as number] as number;
      next++;
      // The next timer first, so nothing the add runs can end the chain.
      if (next < order.length) timer = setTimeout(step, 0);
      table.add(buildSlice(tables, altitudeDeg));
    };
    timer = setTimeout(step, 0);
  }

  if (typeof Worker === "undefined") {
    runHere();
  } else {
    try {
      worker = new Worker(new URL("./sky.worker.ts", import.meta.url), { type: "module" });
    } catch {
      worker = null;
    }
    if (worker === null) {
      runHere();
    } else {
      worker.onmessage = (event: MessageEvent<SkyWorkerReply>): void => {
        if (disposed) return;
        try {
          table.add(event.data.slice);
        } catch {
          runHere();
          return;
        }
        // Every slice is in: the worker's thread is not needed again.
        if (table.count >= SLICE_ALTITUDES_DEG.length) endWorker();
      };
      // A worker that fails, or sends what cannot be read, leaves its slices
      // to this thread: without them the page would never be shown.
      worker.onerror = (): void => {
        if (!disposed) runHere();
      };
      worker.onmessageerror = (): void => {
        if (!disposed) runHere();
      };
      const request: SkyWorkerRequest = { startDeg };
      worker.postMessage(request);
    }
  }

  return {
    table,
    dispose() {
      disposed = true;
      endWorker();
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
}
