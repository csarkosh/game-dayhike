/**
 * The wind sea's loop asked of its worker, with no engine: the medium
 * tier's field, and the high tier's where the FFT is not to be had, baked
 * off the main thread (`oceanLoop.worker.ts`, `oceanLoopBake.ts`). Whoever
 * draws the sea asks once and makes a texture of the reply.
 */
import type { LoopReply, LoopRequest } from "./oceanLoopBake.js";

/** Bakes the loop for a seed: by default in the worker, which `signal` ends when the sea is disposed. */
export type LoopStarter = (seed: number, signal: AbortSignal) => Promise<LoopReply>;
/**
 * The loop baked in the module worker. Rejects where there is no Worker (Node), where one cannot be made, on
 * a worker's error or a reply it cannot read, and when `signal` aborts first. The worker is ended whatever
 * happens: on its reply, on an error, and on the abort.
 */
export function startLoopWorker(seed: number, signal?: AbortSignal): Promise<LoopReply> {
  return new Promise<LoopReply>((resolve, reject) => {
    if (typeof Worker === "undefined") throw new Error("no Worker to bake the wind sea's loop in");
    if (signal?.aborted === true) throw new Error("the wind sea's loop is no longer wanted");
    const worker = new Worker(new URL("./oceanLoop.worker.ts", import.meta.url), { type: "module" });
    const end = (): void => {
      worker.terminate();
      signal?.removeEventListener("abort", abandon);
    };
    function abandon(): void {
      end();
      reject(new Error("the wind sea's loop is no longer wanted"));
    }
    signal?.addEventListener("abort", abandon);
    worker.onmessage = (event: MessageEvent<LoopReply>): void => {
      end();
      resolve(event.data);
    };
    worker.onerror = (event: ErrorEvent): void => {
      end();
      reject(new Error(event.message));
    };
    worker.onmessageerror = (): void => {
      end();
      reject(new Error("the wind sea's loop arrived unreadable"));
    };
    const request: LoopRequest = { seed };
    worker.postMessage(request);
  });
}
