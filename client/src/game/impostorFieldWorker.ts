/**
 * The page's side of the far trees' distance fields made off its thread: one
 * module worker (`impostorField.worker.ts`) for a forest's bakes, started at
 * the first, each bake's pixels sent as a copy and its fields taken back by
 * transfer. The seven bakes land within a frame or two of each other, and
 * their fields, computed on the page, were one stop of a third of a second.
 *
 * The far trees always get their fields. Where there is no Worker, it cannot
 * be made, it fails, it sends what cannot be read or it leaves a bake
 * unanswered for `FIELD_TIMEOUT_MS`, every bake out and every later one is
 * computed on the page from the pixels the page kept, each in a task of its
 * own, so even then no frame holds more than one. Nothing here rejects.
 */
import { impostorFields, type ImpostorFields } from "./impostorField.js";
import type { FieldReply, FieldRequest } from "./impostorField.worker.js";

/** How long a bake waits for the worker's answer before the page computes its fields itself. */
export const FIELD_TIMEOUT_MS = 10_000;

export type FieldMaker = {
  /** A bake's fields, made off the page where a worker can be had and here otherwise; null once the maker is disposed. Never rejects. */
  fields(albedo: Uint8Array, normal: Uint8Array | null, width: number, height: number): Promise<ImpostorFields | null>;
  /** Ends the worker; every bake still out, and any asked after, resolves null. */
  dispose(): void;
};

type Job = {
  albedo: Uint8Array; normal: Uint8Array | null; width: number; height: number;
  resolve(fields: ImpostorFields | null): void;
  timer: ReturnType<typeof setTimeout> | null;
};

/** The picture's own bytes, alone in a buffer: a view on a larger one would be cloned with all of it. */
const own = (picture: Uint8Array): Uint8Array =>
  picture.byteOffset === 0 && picture.byteLength === picture.buffer.byteLength ? picture : picture.slice();

let lastId = 0;

export function createFieldMaker(deps: { timeoutMs?: number } = {}): FieldMaker {
  const limit = deps.timeoutMs ?? FIELD_TIMEOUT_MS;
  let worker: Worker | null = null;
  /** The worker is of no use, or never was: every bake is the page's. */
  let broken = false;
  let disposed = false;
  const out = new Map<number, Job>();
  /** The page's own computations, one a task, in the order asked. */
  let turn: Promise<void> = Promise.resolve();

  function here(job: Job): void {
    turn = turn.then(() => new Promise<void>((done) => {
      setTimeout(() => {
        let fields: ImpostorFields | null = null;
        if (!disposed) {
          try {
            fields = impostorFields(job.albedo, job.normal, job.width, job.height);
          } catch {
            fields = null;
          }
        }
        job.resolve(fields);
        done();
      }, 0);
    }));
  }

  function stop(): void {
    if (worker === null) return;
    worker.onmessage = null;
    worker.onerror = null;
    worker.onmessageerror = null;
    worker.terminate();
    worker = null;
  }

  /** The worker is given up: what it was sent is computed here, and so is everything after. */
  function fail(): void {
    if (broken) return;
    broken = true;
    stop();
    const left = [...out.values()];
    out.clear();
    for (const job of left) {
      if (job.timer !== null) clearTimeout(job.timer);
      here(job);
    }
  }

  function take(reply: FieldReply): void {
    const job = out.get(reply.id);
    if (job === undefined) return;
    if (!("fields" in reply)) {
      fail();
      return;
    }
    out.delete(reply.id);
    if (job.timer !== null) clearTimeout(job.timer);
    job.resolve(reply.fields);
  }

  /** Whether there is a worker to send to, starting one at the first bake. */
  function started(): boolean {
    if (worker !== null) return true;
    if (broken || typeof Worker === "undefined") return false;
    try {
      worker = new Worker(new URL("./impostorField.worker.ts", import.meta.url), { type: "module" });
    } catch {
      return false;
    }
    worker.onmessage = (event: MessageEvent<FieldReply>): void => {
      try {
        take(event.data);
      } catch {
        fail();
      }
    };
    worker.onerror = fail;
    worker.onmessageerror = fail;
    return true;
  }

  return {
    fields(albedo, normal, width, height) {
      if (disposed) return Promise.resolve(null);
      return new Promise<ImpostorFields | null>((resolve) => {
        const job: Job = { albedo, normal, width, height, resolve, timer: null };
        if (!started()) {
          broken = true;
          here(job);
          return;
        }
        const id = ++lastId;
        out.set(id, job);
        job.timer = setTimeout(fail, limit);
        try {
          const request: FieldRequest = { id, albedo: own(albedo), normal: normal === null ? null : own(normal), width, height };
          (worker as Worker).postMessage(request);
        } catch {
          fail();
        }
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      stop();
      for (const job of out.values()) {
        if (job.timer !== null) clearTimeout(job.timer);
        job.resolve(null);
      }
      out.clear();
    },
  };
}
