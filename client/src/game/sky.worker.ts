/**
 * The sky's slices, made off the main thread: a module worker, which Vite
 * bundles from the `new Worker(new URL(...), { type: "module" })` in
 * `skyWorker.ts`. One request, the start altitude; then one reply per slice,
 * in `sliceOrder`, each slice's buffers transferred, not copied, so the
 * slices the start hour needs reach the page first.
 */
import { SLICE_ALTITUDES_DEG, buildSkyTables, buildSlice, type SkySlice } from "./skyModel.js";
import { sliceOrder } from "./skyTable.js";

export type SkyWorkerRequest = { startDeg: number };
export type SkyWorkerReply = { slice: SkySlice };

/**
 * Builds the tables, then every slice in `sliceOrder(startDeg)`, handing each
 * to `post` as it is made. A `post` that throws stops the run.
 */
export function makeSlices(startDeg: number, post: (slice: SkySlice) => void): void {
  const tables = buildSkyTables();
  for (const index of sliceOrder(startDeg)) post(buildSlice(tables, SLICE_ALTITUDES_DEG[index] as number));
}

// Only inside a worker: under Node, where a test imports `makeSlices`, and on
// a page, there is no WorkerGlobalScope.
if (typeof (globalThis as { WorkerGlobalScope?: unknown }).WorkerGlobalScope === "function") {
  self.onmessage = (event: MessageEvent<SkyWorkerRequest>): void => {
    makeSlices(event.data.startDeg, (slice) => {
      const reply: SkyWorkerReply = { slice };
      self.postMessage(reply, { transfer: [slice.texels.buffer, slice.ring.buffer] });
    });
  };
}
