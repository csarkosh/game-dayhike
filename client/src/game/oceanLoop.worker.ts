/**
 * The medium tier's wind sea loop, baked off the main thread (spec §6.3): a
 * module worker, which Vite bundles from the `new Worker(new URL(...),
 * { type: "module" })` in `oceanWindSource.ts`. One request, one reply, the
 * loop's buffer transferred, not copied.
 */
import { loopReply, type LoopRequest } from "./oceanLoopBake.js";

self.onmessage = (event: MessageEvent<LoopRequest>): void => {
  const reply = loopReply(event.data);
  self.postMessage(reply, { transfer: [reply.data.buffer] });
};
