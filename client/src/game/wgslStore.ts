/**
 * The browser's store of WGSL translations, one source of the WebGPU shader
 * lookup (`shaderLookup.ts`): IndexedDB, one database per salt, so a new
 * build's store is a new database and every older one is deleted when it
 * opens. Each entry is one stage's WGSL, gzipped, under its key, beside a
 * small record of its size and last use. The records are read whole when the
 * store opens, so whether it holds a key is known at once; a WGSL is read
 * only when it is used. Bounded (`WGSL_STORE_MAX_BYTES`,
 * `WGSL_STORE_MAX_ENTRIES`), the least recently used going first.
 *
 * Nothing here is the player's to see: storage refused (site data blocked),
 * a private window, a full disk or an entry that does not read back is a
 * store that has nothing, or keeps nothing, and the lookup translates as the
 * engine always has. Every call is guarded.
 */
import { sha256Hex } from "./sha256.js";
import type { WgslSource } from "./shaderLookup.js";

/** The databases' names begin so; the rest is the salt's digest. */
export const WGSL_STORE_PREFIX = "dayhike-wgsl-";
/** The most gzipped WGSL the store keeps: 64 MB. */
export const WGSL_STORE_MAX_BYTES = 67_108_864;
/** The most stages the store keeps. */
export const WGSL_STORE_MAX_ENTRIES = 2_000;
/** How long the lookup waits for the store to open, and its records to be
 * read, before its first shader: longer, and the store is none for that
 * engine (a translation then costs what it always did). The engine's own
 * start, the device, runs meanwhile. */
export const WGSL_STORE_OPEN_MS = 2_000;
/** How long a use waits to be written, so the uses of a start go in one
 * transaction. */
const TOUCH_MS = 1_000;

/** The object stores: each stage's WGSL, and each stage's record. */
const WGSL = "wgsl";
const META = "meta";

/** What the store knows of an entry without reading its WGSL. */
export type WgslEntry = { bytes: number; lastUsed: number };

/**
 * The keys to delete so that `index` keeps within the bounds: the least
 * recently used first (the key breaking a tie), until both the gzipped bytes
 * and the count are within them.
 */
export function evictions(
  index: ReadonlyMap<string, WgslEntry>,
  bounds: { bytes: number; entries: number } = { bytes: WGSL_STORE_MAX_BYTES, entries: WGSL_STORE_MAX_ENTRIES },
): string[] {
  let bytes = 0;
  for (const entry of index.values()) bytes += entry.bytes;
  let count = index.size;
  const oldest = [...index].sort(([k1, a], [k2, b]) => a.lastUsed - b.lastUsed || (k1 < k2 ? -1 : k1 > k2 ? 1 : 0));
  const gone: string[] = [];
  for (const [key, entry] of oldest) {
    if (bytes <= bounds.bytes && count <= bounds.entries) break;
    gone.push(key);
    bytes -= entry.bytes;
    count -= 1;
  }
  return gone;
}

/** The name of the store's database for `salt`. */
export function wgslStoreName(salt: string): string {
  return WGSL_STORE_PREFIX + sha256Hex(new TextEncoder().encode(salt)).slice(0, 16);
}

function done<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function committed(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** `text` gzipped, or as it is where the browser has no `CompressionStream`. */
async function pack(text: string): Promise<Uint8Array | string> {
  if (typeof CompressionStream !== "function") return text;
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** What `pack` made, as text; rejects on anything else, or on gzip that does
 * not check out (gzip carries a checksum). */
async function unpack(value: unknown): Promise<string> {
  if (typeof value === "string") return value;
  if (!(value instanceof Uint8Array) || typeof DecompressionStream !== "function") throw new Error("not a stored WGSL");
  const stream = new Blob([value as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream("gzip"));
  return await new Response(stream).text();
}

function isEntry(value: unknown): value is WgslEntry {
  const r = value as Partial<WgslEntry> | null;
  return typeof r === "object" && r !== null && typeof r.bytes === "number" && typeof r.lastUsed === "number";
}

/** `promise`, or null once `ms` pass first. */
function within<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

/**
 * The store for `salt`, opened and its records read, or null where the
 * browser refuses it, has none, or it has not opened within `openMs`. Every
 * other database of this store's is deleted, unwaited.
 */
export async function openWgslStore(
  salt: string,
  deps: { idb?: IDBFactory | null; now?: () => number; openMs?: number } = {},
): Promise<WgslSource | null> {
  let idb: IDBFactory | null;
  try {
    idb = deps.idb === undefined ? (globalThis.indexedDB ?? null) : deps.idb;
  } catch {
    idb = null;
  }
  if (idb === null) return null;
  const factory = idb;
  const name = wgslStoreName(salt);
  const now = deps.now ?? (() => Date.now());

  const opening = (async (): Promise<{ db: IDBDatabase; index: Map<string, WgslEntry> }> => {
    const request = factory.open(name, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(WGSL)) db.createObjectStore(WGSL);
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
    };
    const db = await done(request);
    try {
      const tx = db.transaction([META], "readonly");
      const meta = tx.objectStore(META);
      const [keys, values] = await Promise.all([done(meta.getAllKeys()), done(meta.getAll())]);
      const index = new Map<string, WgslEntry>();
      keys.forEach((key, i) => {
        const value: unknown = values[i];
        if (typeof key === "string" && isEntry(value)) index.set(key, { bytes: value.bytes, lastUsed: value.lastUsed });
      });
      return { db, index };
    } catch (error) {
      db.close();
      throw error;
    }
  })();

  let opened: { db: IDBDatabase; index: Map<string, WgslEntry> } | null;
  try {
    opened = await within(opening, deps.openMs ?? WGSL_STORE_OPEN_MS);
  } catch {
    return null;
  }
  if (opened === null) {
    // Came in too late for this engine: closed, whenever it does.
    opening.then(({ db }) => db.close(), () => undefined);
    return null;
  }
  const { db, index } = opened;

  void (async () => {
    const others = (await factory.databases?.()) ?? [];
    for (const other of others) {
      if (other.name?.startsWith(WGSL_STORE_PREFIX) && other.name !== name) factory.deleteDatabase(other.name);
    }
  })().catch(() => undefined);

  /** Uses not yet written. */
  const touched = new Set<string>();
  let touchTimer: ReturnType<typeof setTimeout> | null = null;
  const writeTouches = (): void => {
    touchTimer = null;
    try {
      const tx = db.transaction([META], "readwrite");
      const meta = tx.objectStore(META);
      for (const key of touched) {
        const entry = index.get(key);
        if (entry !== undefined) meta.put(entry, key);
      }
      touched.clear();
      committed(tx).catch(() => undefined);
    } catch {
      /* the store is gone or refuses writes: the uses go unwritten */
    }
  };

  const drop = (key: string): void => {
    index.delete(key);
    try {
      const tx = db.transaction([WGSL, META], "readwrite");
      tx.objectStore(WGSL).delete(key);
      tx.objectStore(META).delete(key);
      committed(tx).catch(() => undefined);
    } catch {
      /* dropped from the index: it is not asked for again */
    }
  };

  return {
    has: (key) => index.has(key),
    get: async (key) => {
      const entry = index.get(key);
      if (entry === undefined) return null;
      try {
        const value: unknown = await done(db.transaction([WGSL], "readonly").objectStore(WGSL).get(key));
        const wgsl = await unpack(value);
        entry.lastUsed = now();
        touched.add(key);
        touchTimer ??= setTimeout(writeTouches, TOUCH_MS);
        return wgsl;
      } catch {
        drop(key);
        return null;
      }
    },
    put: (key, wgsl) => {
      if (index.has(key)) return;
      void (async () => {
        const value = await pack(wgsl);
        const entry = { bytes: typeof value === "string" ? value.length : value.byteLength, lastUsed: now() };
        const next = new Map(index);
        next.set(key, entry);
        const gone = evictions(next);
        const tx = db.transaction([WGSL, META], "readwrite");
        const store = tx.objectStore(WGSL);
        const meta = tx.objectStore(META);
        store.put(value, key);
        meta.put(entry, key);
        for (const old of gone) {
          store.delete(old);
          meta.delete(old);
        }
        await committed(tx);
        for (const old of gone) index.delete(old);
        if (!gone.includes(key)) index.set(key, entry);
      })().catch(() => undefined);
    },
    drop,
    close: () => {
      if (touchTimer !== null) {
        clearTimeout(touchTimer);
        writeTouches();
      }
      index.clear();
      try {
        db.close();
      } catch {
        /* already closed */
      }
    },
  };
}
