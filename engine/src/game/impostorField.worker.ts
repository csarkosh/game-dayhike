/**
 * The far trees' distance fields, made off the page's thread: a module
 * worker, which Vite bundles from the `new Worker(new URL(...),
 * { type: "module" })` in `impostorFieldWorker.ts`. Each of the forest's
 * bakes sends the pixels it read back and gets its fields (`impostorField.ts`:
 * five exact distance transforms of a 512² picture, about 50 ms on a phone),
 * the fields' buffers transferred, not copied.
 */
import { impostorFields, type ImpostorFields } from "./impostorField.js";

export type FieldRequest = { id: number; albedo: Uint8Array; normal: Uint8Array | null; width: number; height: number };
export type FieldReply = { id: number; fields: ImpostorFields } | { id: number; failed: string };

/** The request's fields and the buffers to send them by, or one failure where they cannot be made. */
export function fieldReply(request: FieldRequest): { reply: FieldReply; transfer: ArrayBuffer[] } {
  const { id } = request;
  try {
    const fields = impostorFields(request.albedo, request.normal, request.width, request.height);
    const transfer = [fields.albedo.buffer as ArrayBuffer];
    if (fields.normal !== null) transfer.push(fields.normal.buffer as ArrayBuffer);
    return { reply: { id, fields }, transfer };
  } catch (error) {
    return { reply: { id, failed: error instanceof Error ? error.message : String(error) }, transfer: [] };
  }
}

// Only inside a worker: under Node, where a test imports `fieldReply`, and on
// a page, there is no WorkerGlobalScope.
if (typeof (globalThis as { WorkerGlobalScope?: unknown }).WorkerGlobalScope === "function") {
  self.onmessage = (event: MessageEvent<FieldRequest>): void => {
    const { reply, transfer } = fieldReply(event.data);
    self.postMessage(reply, { transfer });
  };
}
