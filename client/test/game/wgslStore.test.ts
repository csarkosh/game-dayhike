import { afterEach, describe, expect, it, vi } from "vitest";
import {
  WGSL_STORE_MAX_BYTES,
  WGSL_STORE_MAX_ENTRIES,
  WGSL_STORE_OPEN_MS,
  WGSL_STORE_PREFIX,
  evictions,
  openWgslStore,
  wgslStoreName,
} from "../../src/game/wgslStore.js";
import { timeLimit } from "../helpers/timeLimit.js";
import { memoryIndexedDb } from "./helpers/memoryIndexedDb.js";

const SALT = "dayhike-wgsl/1|babylon=test|glslang=aa|twgsl=bb|staticUA=false";
const WGSL = "@fragment fn main() -> @location(0) vec4<f32> {\n  return vec4<f32>(1.0);\n}\n".repeat(40);

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the bounds of the browser's WGSL store", () => {
  it("are 64 MB of gzipped WGSL and 2,000 stages, the store opening within 2 s", () => {
    expect(WGSL_STORE_MAX_BYTES).toBe(67_108_864);
    expect(WGSL_STORE_MAX_ENTRIES).toBe(2_000);
    expect(WGSL_STORE_OPEN_MS).toBe(2_000);
  });

  it("evict the least recently used first, until both the bytes and the count are within them", () => {
    const index = new Map([
      ["a", { bytes: 40, lastUsed: 3 }],
      ["b", { bytes: 40, lastUsed: 1 }],
      ["c", { bytes: 40, lastUsed: 2 }],
      ["d", { bytes: 10, lastUsed: 4 }],
    ]);
    expect(evictions(index, { bytes: 130, entries: 4 })).toEqual([]);
    expect(evictions(index, { bytes: 100, entries: 4 })).toEqual(["b"]);
    expect(evictions(index, { bytes: 50, entries: 4 })).toEqual(["b", "c", "a"]);
    expect(evictions(index, { bytes: 1_000, entries: 2 })).toEqual(["b", "c"]);
    // A tie goes by key, so the choice does not hang on the map's order.
    expect(evictions(new Map([["y", { bytes: 1, lastUsed: 1 }], ["x", { bytes: 1, lastUsed: 1 }]]), { bytes: 1, entries: 9 })).toEqual(["x"]);
  });
});

describe("the browser's WGSL store", () => {
  it("keeps a stage, gzipped, and a later open knows it at once and reads it back", async () => {
    const idb = memoryIndexedDb();
    const store = await openWgslStore(SALT, { idb: idb.factory });
    expect(store).not.toBe(null);
    store?.put("k1", WGSL);
    await vi.waitFor(() => expect(store?.has("k1")).toBe(true), { timeout: timeLimit(5_000) });
    const kept = idb.databases.get(wgslStoreName(SALT))?.get("wgsl")?.get("k1");
    expect(kept).toBeInstanceOf(Uint8Array);
    expect([...(kept as Uint8Array).subarray(0, 2)]).toEqual([0x1f, 0x8b]);
    expect((kept as Uint8Array).byteLength).toBeLessThan(WGSL.length / 10);

    const again = await openWgslStore(SALT, { idb: idb.factory });
    expect(again?.has("k1")).toBe(true);
    expect(again?.has("k2")).toBe(false);
    expect(await again?.get("k1")).toBe(WGSL);
    expect(await again?.get("k2")).toBe(null);
  });

  it("is one database per salt, and deletes the other ones of its own when it opens, nothing else", async () => {
    const idb = memoryIndexedDb();
    const old = await openWgslStore("an older build's salt", { idb: idb.factory });
    old?.put("k1", WGSL);
    idb.databases.set("someone-elses", new Map());
    await vi.waitFor(() => expect(old?.has("k1")).toBe(true), { timeout: timeLimit(5_000) });
    expect(wgslStoreName(SALT).startsWith(WGSL_STORE_PREFIX)).toBe(true);
    expect(wgslStoreName(SALT)).not.toBe(wgslStoreName("an older build's salt"));
    const store = await openWgslStore(SALT, { idb: idb.factory });
    expect(store?.has("k1")).toBe(false);
    await vi.waitFor(() => expect([...idb.databases.keys()].sort()).toEqual([wgslStoreName(SALT), "someone-elses"].sort()), { timeout: timeLimit(5_000) });
  });

  it("drops an entry that does not read back, and answers it as not there", async () => {
    const idb = memoryIndexedDb();
    const store = await openWgslStore(SALT, { idb: idb.factory });
    store?.put("k1", WGSL);
    await vi.waitFor(() => expect(store?.has("k1")).toBe(true), { timeout: timeLimit(5_000) });
    store?.put("k2", WGSL);
    await vi.waitFor(() => expect(store?.has("k2")).toBe(true), { timeout: timeLimit(5_000) });
    // Garbled on disk: no gzip at all, and not even bytes.
    const stores = idb.databases.get(wgslStoreName(SALT));
    stores?.get("wgsl")?.set("k1", new Uint8Array([1, 2, 3, 4]));
    stores?.get("wgsl")?.set("k2", 42);
    const again = await openWgslStore(SALT, { idb: idb.factory });
    for (const key of ["k1", "k2"]) {
      expect(again?.has(key), key).toBe(true);
      expect(await again?.get(key), key).toBe(null);
      expect(again?.has(key), key).toBe(false);
      await vi.waitFor(() => expect(stores?.get("meta")?.has(key)).toBe(false), { timeout: timeLimit(5_000) });
      expect(stores?.get("wgsl")?.has(key), key).toBe(false);
    }
  });

  it("forgets a stage it is told to drop", async () => {
    const idb = memoryIndexedDb();
    const store = await openWgslStore(SALT, { idb: idb.factory });
    store?.put("k1", WGSL);
    await vi.waitFor(() => expect(store?.has("k1")).toBe(true), { timeout: timeLimit(5_000) });
    store?.drop("k1");
    expect(store?.has("k1")).toBe(false);
    const stores = idb.databases.get(wgslStoreName(SALT));
    await vi.waitFor(() => expect([stores?.get("wgsl")?.has("k1"), stores?.get("meta")?.has("k1")]).toEqual([false, false]), { timeout: timeLimit(5_000) });
    expect((await openWgslStore(SALT, { idb: idb.factory }))?.has("k1")).toBe(false);
  });

  it("keeps nothing on a full disk, and says nothing", async () => {
    const idb = memoryIndexedDb();
    const store = await openWgslStore(SALT, { idb: idb.factory });
    idb.failWrites = true;
    store?.put("k1", WGSL);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(store?.has("k1")).toBe(false);
    expect(await store?.get("k1")).toBe(null);
  });

  it("evicts the least recently used as it keeps a stage past its bounds", async () => {
    const idb = memoryIndexedDb();
    let now = 0;
    const store = await openWgslStore(SALT, { idb: idb.factory, now: () => (now += 1) });
    const stages = WGSL_STORE_MAX_ENTRIES + 1;
    // Straight into the database, as a store that has filled over many loads.
    const stores = idb.databases.get(wgslStoreName(SALT));
    for (let i = 0; i < WGSL_STORE_MAX_ENTRIES; i++) {
      stores?.get("wgsl")?.set(`old${String(i).padStart(4, "0")}`, "x");
      stores?.get("meta")?.set(`old${String(i).padStart(4, "0")}`, { bytes: 1, lastUsed: i === 0 ? 5_000 : i });
    }
    const full = await openWgslStore(SALT, { idb: idb.factory, now: () => (now += 10_000) });
    full?.put("new", WGSL);
    await vi.waitFor(() => expect(full?.has("new")).toBe(true), { timeout: timeLimit(5_000) });
    expect(stores?.get("meta")?.size).toBe(stages - 1);
    // The oldest use went, not the first key.
    expect(full?.has("old0001")).toBe(false);
    expect(full?.has("old0000")).toBe(true);
    expect(store).not.toBe(null);
  });

  it("is none where the browser refuses storage, has none, throws, or does not answer in time", async () => {
    const refusing = memoryIndexedDb();
    refusing.refuse = true;
    expect(await openWgslStore(SALT, { idb: refusing.factory })).toBe(null);
    expect(await openWgslStore(SALT, { idb: null })).toBe(null);
    const throwing = { open: () => { throw new DOMException("denied", "SecurityError"); } } as unknown as IDBFactory;
    expect(await openWgslStore(SALT, { idb: throwing })).toBe(null);
    vi.stubGlobal("indexedDB", undefined);
    expect(await openWgslStore(SALT)).toBe(null);
    vi.useFakeTimers();
    const silent = { open: () => ({}) } as unknown as IDBFactory;
    const opening = openWgslStore(SALT, { idb: silent });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await opening).toBe(null);
  });
});
