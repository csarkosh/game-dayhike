import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { impostorFields, type ImpostorFields } from "../../src/game/impostorField.js";
import { fieldReply, type FieldReply, type FieldRequest } from "../../src/game/impostorField.worker.js";
import { FIELD_TIMEOUT_MS, createFieldMaker } from "../../src/game/impostorFieldWorker.js";

/** A 16 by 16 picture with a disc drawn in it: enough for the field to have an inside and an outside. */
function picture(shade = 200): Uint8Array {
  const data = new Uint8Array(16 * 16 * 4);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const i = (y * 16 + x) * 4;
      const inside = Math.hypot(x - 7.5, y - 7.5) < 5;
      data[i] = shade;
      data[i + 1] = x * 10;
      data[i + 2] = y * 10;
      data[i + 3] = inside ? 255 : 0;
    }
  }
  return data;
}

/** A Worker that records what it is sent and whether it was ended; the test answers for it. */
class FakeWorker {
  static made: FakeWorker[] = [];
  static refuse = false;
  readonly posted: FieldRequest[] = [];
  readonly transfers: unknown[] = [];
  terminated = 0;
  onmessage: ((event: MessageEvent<FieldReply>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  constructor(readonly url: URL, readonly options: WorkerOptions) {
    if (FakeWorker.refuse) throw new Error("no worker to be had");
    FakeWorker.made.push(this);
  }
  postMessage(message: FieldRequest, transfer?: unknown): void {
    this.posted.push(message);
    this.transfers.push(transfer);
  }
  terminate(): void {
    this.terminated++;
  }
  /** Answers request `n` as the real worker would. */
  answer(n: number): ImpostorFields {
    const { reply } = fieldReply(this.posted[n] as FieldRequest);
    this.onmessage?.({ data: reply } as MessageEvent<FieldReply>);
    return (reply as { fields: ImpostorFields }).fields;
  }
}

describe("a bake's fields, as the worker makes them", () => {
  it("answers a request with the fields the page makes, their buffers in the transfer list", () => {
    const albedo = picture();
    const normal = picture(90);
    const { reply, transfer } = fieldReply({ id: 5, albedo, normal, width: 16, height: 16 });
    const want = impostorFields(picture(), picture(90), 16, 16);
    expect(reply).toEqual({ id: 5, fields: want });
    if (!("fields" in reply)) throw new Error("no fields");
    expect(transfer).toEqual([reply.fields.albedo.buffer, reply.fields.normal!.buffer]);
    // Without a normal picture there is one buffer to send.
    const one = fieldReply({ id: 6, albedo: picture(), normal: null, width: 16, height: 16 });
    expect(one.transfer).toHaveLength(1);
    expect((one.reply as { fields: ImpostorFields }).fields.normal).toBeNull();
  });

  it("answers a request it cannot work with one failure", () => {
    const { reply, transfer } = fieldReply({ id: 7, albedo: null as unknown as Uint8Array, normal: null, width: 16, height: 16 });
    expect(reply).toEqual({ id: 7, failed: expect.any(String) });
    expect(transfer).toEqual([]);
  });
});

describe("a forest's bakes' fields, made off the page", () => {
  /** The page's own computations wait for these: the wrapper's `setTimeout(0)` turns. */
  const tasks = async (): Promise<void> => {
    for (let i = 0; i < 6; i++) {
      await Promise.resolve();
      vi.advanceTimersByTime(0);
    }
    await Promise.resolve();
  };
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("Worker", FakeWorker);
    FakeWorker.made = [];
    FakeWorker.refuse = false;
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("starts a module worker in the form Vite bundles, at the first bake and not before", () => {
    const text = readFileSync(new URL("../../src/game/impostorFieldWorker.ts", import.meta.url), "utf8");
    const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).toContain('new Worker(new URL("./impostorField.worker.ts", import.meta.url), { type: "module" })');
    const maker = createFieldMaker();
    expect(FakeWorker.made).toHaveLength(0);
    void maker.fields(picture(), null, 16, 16);
    expect(FakeWorker.made).toHaveLength(1);
    expect((FakeWorker.made[0] as FakeWorker).options).toEqual({ type: "module" });
    maker.dispose();
  });

  it("sends every bake to one worker as a copy, and resolves each with the arrays that came back", async () => {
    const maker = createFieldMaker();
    const first = picture();
    const second = picture(120);
    const a = maker.fields(first, picture(90), 16, 16);
    const b = maker.fields(second, null, 16, 16);
    expect(FakeWorker.made).toHaveLength(1);
    const worker = FakeWorker.made[0] as FakeWorker;
    expect(worker.posted).toHaveLength(2);
    expect(worker.posted[0]).toMatchObject({ width: 16, height: 16 });
    expect(worker.posted[1]!.id).not.toBe(worker.posted[0]!.id);
    // Posted with no transfer list: the page still holds the pixels, should the worker fail.
    expect(worker.transfers).toEqual([undefined, undefined]);
    expect(first.byteLength).toBe(16 * 16 * 4);
    // Answered out of order: each promise takes its own.
    const sentB = worker.answer(1);
    const sentA = worker.answer(0);
    expect(await b).toBe(sentB);
    expect(await a).toBe(sentA);
    expect(sentA).toEqual(impostorFields(picture(), picture(90), 16, 16));
    expect(worker.terminated).toBe(0);
    maker.dispose();
    expect(worker.terminated).toBe(1);
  });

  it("posts a picture that is a view on a larger buffer as its own bytes alone", () => {
    const maker = createFieldMaker();
    const big = new Uint8Array(16 * 16 * 4 * 3);
    big.set(picture(), 16 * 16 * 4);
    const view = new Uint8Array(big.buffer, 16 * 16 * 4, 16 * 16 * 4);
    void maker.fields(view, null, 16, 16);
    const sent = (FakeWorker.made[0] as FakeWorker).posted[0]!.albedo;
    expect(sent.buffer.byteLength).toBe(16 * 16 * 4);
    expect(sent).toEqual(picture());
    maker.dispose();
  });

  it("computes on the page, a bake a task, where there is no worker or it gives up, and never rejects", async () => {
    const want = impostorFields(picture(), null, 16, 16);
    for (const way of ["no Worker", "refused", "onerror", "onmessageerror", "failed", "unreadable", "timeout", "cannot post"] as const) {
      FakeWorker.made = [];
      FakeWorker.refuse = way === "refused";
      if (way === "no Worker") vi.stubGlobal("Worker", undefined);
      else vi.stubGlobal("Worker", FakeWorker);
      const post = way === "cannot post" ? vi.spyOn(FakeWorker.prototype, "postMessage").mockImplementation(() => {
        throw new Error("cannot post");
      }) : null;
      const maker = createFieldMaker();
      const a = maker.fields(picture(), null, 16, 16);
      const b = maker.fields(picture(), null, 16, 16);
      const worker = FakeWorker.made[0];
      if (way === "onerror" || way === "onmessageerror") worker?.[way]?.({} as ErrorEvent & MessageEvent);
      else if (way === "failed") worker?.onmessage?.({ data: { id: worker.posted[0]!.id, failed: "it threw" } } as MessageEvent<FieldReply>);
      else if (way === "unreadable") worker?.onmessage?.({ data: null } as unknown as MessageEvent<FieldReply>);
      else if (way === "timeout") vi.advanceTimersByTime(FIELD_TIMEOUT_MS);
      // Neither is computed in the call that gave up: each waits for a task of its own.
      let settled = 0;
      void a.then(() => settled++);
      void b.then(() => settled++);
      await Promise.resolve();
      await Promise.resolve();
      expect(settled, way).toBe(0);
      await tasks();
      expect(await a, way).toEqual(want);
      expect(await b, way).toEqual(want);
      if (worker !== undefined) expect(worker.terminated, way).toBe(1);
      // From then every bake is the page's, and no worker is tried again.
      const made = FakeWorker.made.length;
      const c = maker.fields(picture(), null, 16, 16);
      await tasks();
      expect(await c, way).toEqual(want);
      expect(FakeWorker.made, way).toHaveLength(made);
      maker.dispose();
      post?.mockRestore();
    }
  });

  it("resolves null for what is out, and for anything asked after, once it is disposed", async () => {
    const maker = createFieldMaker();
    const out = maker.fields(picture(), null, 16, 16);
    const worker = FakeWorker.made[0] as FakeWorker;
    maker.dispose();
    maker.dispose();
    expect(await out).toBeNull();
    expect(worker.terminated).toBe(1);
    expect(await maker.fields(picture(), null, 16, 16)).toBeNull();
    expect(FakeWorker.made).toHaveLength(1);
    // A bake waiting its turn on the page when the maker is disposed is not computed either.
    vi.stubGlobal("Worker", undefined);
    const here = createFieldMaker();
    const waiting = here.fields(picture(), null, 16, 16);
    here.dispose();
    await tasks();
    expect(await waiting).toBeNull();
  });
});
