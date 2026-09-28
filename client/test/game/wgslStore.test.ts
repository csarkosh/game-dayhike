import { afterEach, describe, expect, it, vi } from "vitest";
import {
  WGSL_START_MAX_BYTES,
  WGSL_STORE_MAX_BYTES,
  WGSL_STORE_MAX_ENTRIES,
  WGSL_STORE_PREFIX,
  evictions,
  loadWgslStore,
  startSet,
  wgslStoreName,
} from "../../src/game/wgslStore.js";
import type { WgslSource } from "../../src/game/shaderLookup.js";
import { timeLimit } from "../helpers/timeLimit.js";
import { memoryIndexedDb } from "./helpers/memoryIndexedDb.js";

const SALT = "dayhike-wgsl/1|babylon=test|glslang=aa|twgsl=bb|staticUA=false";
const WGSL = "@fragment fn main() -> @location(0) vec4<f32> {\n  return vec4<f32>(1.0);\n}\n".repeat(40);

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** The store, opened on `idb` with its start's WGSL read in. */
async function loaded(idb: ReturnType<typeof memoryIndexedDb>, maxBytes?: number): Promise<WgslSource> {
  const store = await loadWgslStore(SALT, { idb: idb.factory, maxBytes });
  if (store === null) throw new Error("no store");
  await store.ready;
  return store;
}

/** Keeps `wgsl` under `key` and waits for it to be written. */
async function kept(idb: ReturnType<typeof memoryIndexedDb>, store: WgslSource, key: string, wgsl = WGSL): Promise<void> {
  store.put?.(key, wgsl);
  await vi.waitFor(() => expect(idb.databases.get(wgslStoreName(SALT))?.get("meta")?.has(key)).toBe(true), { timeout: timeLimit(5_000) });
}

describe("the bounds of the browser's WGSL store", () => {
  it("are 64 MB of gzipped WGSL and 2,000 stages on disk, and 32 MB of WGSL read in for a start", () => {
    expect(WGSL_STORE_MAX_BYTES).toBe(67_108_864);
    expect(WGSL_STORE_MAX_ENTRIES).toBe(2_000);
    expect(WGSL_START_MAX_BYTES).toBe(33_554_432);
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
    // A bound is within itself: 50 bytes left of 50 stop the eviction.
    expect(evictions(index, { bytes: 50, entries: 4 })).toEqual(["b", "c"]);
    expect(evictions(index, { bytes: 49, entries: 4 })).toEqual(["b", "c", "a"]);
    expect(evictions(index, { bytes: 1_000, entries: 2 })).toEqual(["b", "c"]);
    // A tie goes by key, so the choice does not hang on the map's order.
    expect(evictions(new Map([["y", { bytes: 1, lastUsed: 1 }], ["x", { bytes: 1, lastUsed: 1 }]]), { bytes: 1, entries: 9 })).toEqual(["x"]);
  });

  it("read the most recently used in for a start, while their unzipped WGSL fits", () => {
    const index = new Map([
      ["a", { bytes: 10, raw: 100, lastUsed: 3 }],
      ["b", { bytes: 10, raw: 100, lastUsed: 1 }],
      ["c", { bytes: 10, raw: 100, lastUsed: 2 }],
      // A record written without its unzipped size counts as eight times its gzip.
      ["d", { bytes: 10, lastUsed: 4 }],
    ]);
    expect(startSet(index, 1_000)).toEqual(["d", "a", "c", "b"]);
    expect(startSet(index, 280)).toEqual(["d", "a", "c"]);
    expect(startSet(index, 179)).toEqual(["d"]);
    expect(startSet(index, 79)).toEqual([]);
  });
});

describe("the browser's WGSL store", () => {
  it("keeps a stage, gzipped, and a later load holds it in memory and answers it at once", async () => {
    const idb = memoryIndexedDb();
    const store = await loaded(idb);
    expect([store.name, store.salt]).toEqual(["store", SALT]);
    await kept(idb, store, "k1");
    const on = idb.databases.get(wgslStoreName(SALT));
    const value = on?.get("wgsl")?.get("k1");
    expect(value).toBeInstanceOf(Uint8Array);
    expect([...(value as Uint8Array).subarray(0, 2)]).toEqual([0x1f, 0x8b]);
    expect((value as Uint8Array).byteLength).toBeLessThan(WGSL.length / 10);
    expect(on?.get("meta")?.get("k1")).toMatchObject({ raw: WGSL.length });

    const again = await loaded(idb);
    expect(again.get("k1")).toBe(WGSL);
    expect(again.get("k2")).toBe(null);
  });

  it("holds nothing it keeps: a translation is written, and found on a later load", async () => {
    const idb = memoryIndexedDb();
    const store = await loaded(idb);
    await kept(idb, store, "k1");
    expect(store.get("k1")).toBe(null);
    expect((await loaded(idb)).get("k1")).toBe(WGSL);
  });

  it("holds what it read for the engine's life: a stage used at the start is there when asked again, one not asked for yet when it is; closed, nothing", async () => {
    const idb = memoryIndexedDb();
    const writing = await loaded(idb);
    await kept(idb, writing, "used");
    await kept(idb, writing, "later");
    const store = await loaded(idb);
    expect(store.get("used")).toBe(WGSL);
    // The rain's effect made again, say, and the headlamp's variant.
    expect(store.get("used")).toBe(WGSL);
    expect(store.get("later")).toBe(WGSL);
    expect(store.get("later")).toBe(WGSL);
    store.close?.();
    expect([store.get("used"), store.get("later")]).toEqual([null, null]);
  });

  it("reads in only what fits the start's bound, the most recently used first", async () => {
    const idb = memoryIndexedDb();
    let now = 0;
    const store = await loadWgslStore(SALT, { idb: idb.factory, now: () => (now += 1) });
    for (const key of ["old", "newer", "newest"]) await kept(idb, store as WgslSource, key);
    const small = await loaded(idb, WGSL.length * 2);
    expect(["old", "newer", "newest"].map((key) => small.get(key) !== null)).toEqual([false, true, true]);
  });

  it("is one database per salt, and deletes the other ones of its own when it opens, nothing else", async () => {
    const idb = memoryIndexedDb();
    const old = await loadWgslStore("an older build's salt", { idb: idb.factory });
    old?.put?.("k1", WGSL);
    idb.databases.set("someone-elses", new Map());
    await vi.waitFor(() => expect(idb.databases.get(wgslStoreName("an older build's salt"))?.get("meta")?.has("k1")).toBe(true), {
      timeout: timeLimit(5_000),
    });
    expect(wgslStoreName(SALT).startsWith(WGSL_STORE_PREFIX)).toBe(true);
    expect(wgslStoreName(SALT)).not.toBe(wgslStoreName("an older build's salt"));
    const store = await loaded(idb);
    expect(store.get("k1")).toBe(null);
    await vi.waitFor(() => expect([...idb.databases.keys()].sort()).toEqual([wgslStoreName(SALT), "someone-elses"].sort()), {
      timeout: timeLimit(5_000),
    });
  });

  it("closes when a newer build deletes its database, and keeps nothing more, quietly", async () => {
    const idb = memoryIndexedDb();
    const store = await loaded(idb);
    const connection = idb.connections[idb.connections.length - 1];
    (connection as unknown as { onversionchange: (() => void) | null }).onversionchange?.();
    expect(connection?.closed).toBe(true);
    expect(() => store.put?.("k1", WGSL)).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(idb.databases.get(wgslStoreName(SALT))?.get("meta")?.has("k1")).toBe(false);
  });

  it("drops an entry that does not read back, and answers it as not there", async () => {
    const idb = memoryIndexedDb();
    const store = await loaded(idb);
    await kept(idb, store, "k1");
    await kept(idb, store, "k2");
    // Garbled on disk: no gzip at all, and not even bytes.
    const on = idb.databases.get(wgslStoreName(SALT));
    on?.get("wgsl")?.set("k1", new Uint8Array([1, 2, 3, 4]));
    on?.get("wgsl")?.set("k2", 42);
    const again = await loaded(idb);
    for (const key of ["k1", "k2"]) {
      expect(again.get(key), key).toBe(null);
      await vi.waitFor(() => expect(on?.get("meta")?.has(key)).toBe(false), { timeout: timeLimit(5_000) });
      expect(on?.get("wgsl")?.has(key), key).toBe(false);
    }
  });

  it("keeps nothing on a full disk, and says nothing", async () => {
    const idb = memoryIndexedDb();
    const store = await loaded(idb);
    idb.failWrites = true;
    store.put?.("k1", WGSL);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(idb.databases.get(wgslStoreName(SALT))?.get("meta")?.has("k1")).toBe(false);
  });

  it("evicts the least recently used as it keeps a stage past its bounds", async () => {
    const idb = memoryIndexedDb();
    await loaded(idb);
    // Straight into the database, as a store that has filled over many loads.
    const on = idb.databases.get(wgslStoreName(SALT));
    for (let i = 0; i < WGSL_STORE_MAX_ENTRIES; i++) {
      on?.get("wgsl")?.set(`old${String(i).padStart(4, "0")}`, new Uint8Array([0]));
      // Too large to read in for a start: this is about the disk.
      on?.get("meta")?.set(`old${String(i).padStart(4, "0")}`, { bytes: 1, raw: 1_000_000_000, lastUsed: i === 0 ? 5_000 : i });
    }
    let now = 10_000;
    const full = await loadWgslStore(SALT, { idb: idb.factory, now: () => (now += 1) });
    full?.put?.("new", WGSL);
    await vi.waitFor(() => expect(on?.get("meta")?.has("new")).toBe(true), { timeout: timeLimit(5_000) });
    expect(on?.get("meta")?.size).toBe(WGSL_STORE_MAX_ENTRIES);
    // The oldest use went, not the first key.
    expect(on?.get("meta")?.has("old0001")).toBe(false);
    expect(on?.get("meta")?.has("old0000")).toBe(true);
  });

  it("lets everything go when closed", async () => {
    const idb = memoryIndexedDb();
    const store = await loaded(idb);
    store.put?.("k1", WGSL);
    store.close?.();
    expect(store.get("k1")).toBe(null);
    expect(idb.connections[idb.connections.length - 1]?.closed).toBe(true);
  });

  it("is none where the browser refuses storage, has none, throws, or cannot check what it reads back", async () => {
    const refusing = memoryIndexedDb();
    refusing.refuse = true;
    expect(await loadWgslStore(SALT, { idb: refusing.factory })).toBe(null);
    expect(await loadWgslStore(SALT, { idb: null })).toBe(null);
    const throwing = { open: () => { throw new DOMException("denied", "SecurityError"); } } as unknown as IDBFactory;
    expect(await loadWgslStore(SALT, { idb: throwing })).toBe(null);
    vi.stubGlobal("indexedDB", undefined);
    expect(await loadWgslStore(SALT)).toBe(null);
    vi.unstubAllGlobals();
    vi.stubGlobal("CompressionStream", undefined);
    expect(await loadWgslStore(SALT, { idb: memoryIndexedDb().factory })).toBe(null);
  });
});
