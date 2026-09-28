/**
 * The browser's store of WGSL translations, one source of the WebGPU shader
 * lookup (`shaderLookup.ts`): IndexedDB, one database per salt, so a new
 * build's store is a new database and every older one is deleted when it
 * opens. Each entry is one stage's WGSL, gzipped, under its key, beside a
 * small record of its sizes and last use.
 *
 * A preparation never waits (`shaderLookup.ts`), so the store answers from
 * memory: `loadWgslStore` opens it, reads the records, and reads and
 * unzips the most recently used entries into memory, up to
 * `WGSL_START_MAX_BYTES` of WGSL, while the engine is made. An entry still
 * being unzipped when the engine is handed over lands in memory when it is
 * done, and is found from then on. What it read is held for the engine's
 * life, used or not: an effect the game makes again later (the rain re-makes
 * effects the start used) finds its stages, and those not asked for yet, the
 * headlamp's, the rain's, the last hike's creatures', are there when they
 * are. So what it holds never grows past the start's read. A translation
 * kept is written later, never waited on, and not held. Bounded on disk
 * (`WGSL_STORE_MAX_BYTES`, `WGSL_STORE_MAX_ENTRIES`), the least recently used
 * going first.
 *
 * Nothing here is the player's to see: storage refused (site data blocked),
 * a private window, a full disk, a newer build deleting this one's database,
 * or an entry that does not read back (gzip carries a CRC-32, checked as it
 * is unzipped) is a store that has nothing, or keeps nothing, and the lookup
 * translates as the engine always has. A browser without `CompressionStream`
 * has no store: the checksum is what stands between a damaged entry and the
 * device. Every call is guarded.
 */
import { sha256Hex } from "./sha256.js";
import type { WgslSource } from "./shaderLookup.js";

/** The databases' names begin so; the rest is the salt's digest. */
export const WGSL_STORE_PREFIX = "dayhike-wgsl-";
/** The most gzipped WGSL the store keeps on disk: 64 MB. */
export const WGSL_STORE_MAX_BYTES = 67_108_864;
/** The most stages the store keeps. */
export const WGSL_STORE_MAX_ENTRIES = 2_000;
/** The most WGSL read into memory for a start, unzipped: 32 MB, the most
 * recently used first. A start's own set is estimated at 6 to 24 MB. */
export const WGSL_START_MAX_BYTES = 33_554_432;
/** How long a use waits to be written, so the uses of a start go in one
 * transaction. */
const TOUCH_MS = 1_000;
/** The unzipped size assumed of an entry whose record has none. */
const ASSUMED_RATIO = 8;

/** The object stores: each stage's WGSL, and each stage's record. */
const WGSL = "wgsl";
const META = "meta";

/** What the store knows of an entry without reading its WGSL: its gzipped
 * size, its unzipped size (`raw`) and its last use. */
export type WgslEntry = { bytes: number; raw?: number; lastUsed: number };

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

/**
 * The keys to read into memory for a start: the most recently used first
 * (the key breaking a tie), while their unzipped WGSL fits in `maxBytes`.
 */
export function startSet(index: ReadonlyMap<string, WgslEntry>, maxBytes: number = WGSL_START_MAX_BYTES): string[] {
  const newest = [...index].sort(([k1, a], [k2, b]) => b.lastUsed - a.lastUsed || (k1 < k2 ? -1 : k1 > k2 ? 1 : 0));
  const chosen: string[] = [];
  let total = 0;
  for (const [key, entry] of newest) {
    const raw = entry.raw ?? entry.bytes * ASSUMED_RATIO;
    if (total + raw > maxBytes) break;
    total += raw;
    chosen.push(key);
  }
  return chosen;
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

/** `text` gzipped. */
async function pack(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** What `pack` made, as text; rejects on anything else, or on gzip whose
 * CRC-32 does not check out. */
async function unpack(value: unknown): Promise<string> {
  if (!(value instanceof Uint8Array)) throw new Error("not a stored WGSL");
  const stream = new Blob([value as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream("gzip"));
  return await new Response(stream).text();
}

function isEntry(value: unknown): value is WgslEntry {
  const r = value as Partial<WgslEntry> | null;
  return typeof r === "object" && r !== null && typeof r.bytes === "number" && typeof r.lastUsed === "number";
}

/**
 * The store for `salt`, opened and its records read, or null where the
 * browser refuses it, has none, or cannot check what it would read back
 * (no `CompressionStream`). Its `ready` resolves once the start's WGSL is in
 * memory (`startSet`); the lookup bounds the whole. Every other database of
 * this store's is deleted, unwaited. A newer build deleting this one's closes
 * it (`versionchange`), from when it keeps nothing more.
 */
export async function loadWgslStore(
  salt: string,
  deps: { idb?: IDBFactory | null; now?: () => number; maxBytes?: number } = {},
): Promise<WgslSource | null> {
  let idb: IDBFactory | null;
  try {
    idb = deps.idb === undefined ? (globalThis.indexedDB ?? null) : deps.idb;
  } catch {
    idb = null;
  }
  if (idb === null || typeof CompressionStream !== "function" || typeof DecompressionStream !== "function") return null;
  const factory = idb;
  const name = wgslStoreName(salt);
  const now = deps.now ?? (() => Date.now());

  let db: IDBDatabase;
  const index = new Map<string, WgslEntry>();
  try {
    const request = factory.open(name, 1);
    request.onupgradeneeded = () => {
      const upgrading = request.result;
      if (!upgrading.objectStoreNames.contains(WGSL)) upgrading.createObjectStore(WGSL);
      if (!upgrading.objectStoreNames.contains(META)) upgrading.createObjectStore(META);
    };
    db = await done(request);
  } catch {
    return null;
  }
  let open = true;
  const close = (): void => {
    if (!open) return;
    open = false;
    try {
      db.close();
    } catch {
      /* already closed */
    }
  };
  // A newer build deleting this one's database: let it.
  db.onversionchange = () => close();
  try {
    const meta = db.transaction([META], "readonly").objectStore(META);
    const [keys, values] = await Promise.all([done(meta.getAllKeys()), done(meta.getAll())]);
    keys.forEach((key, i) => {
      const value: unknown = values[i];
      if (typeof key === "string" && isEntry(value)) index.set(key, { bytes: value.bytes, raw: value.raw, lastUsed: value.lastUsed });
    });
  } catch {
    close();
    return null;
  }

  void (async () => {
    const others = (await factory.databases?.()) ?? [];
    for (const other of others) {
      if (other.name?.startsWith(WGSL_STORE_PREFIX) && other.name !== name) factory.deleteDatabase(other.name);
    }
  })().catch(() => undefined);

  /** The WGSL read in for the start, held for the engine's life. */
  const held = new Map<string, string>();

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
    held.delete(key);
    try {
      const tx = db.transaction([WGSL, META], "readwrite");
      tx.objectStore(WGSL).delete(key);
      tx.objectStore(META).delete(key);
      committed(tx).catch(() => undefined);
    } catch {
      /* dropped from the index: it is not asked for again */
    }
  };

  const ready = (async (): Promise<void> => {
    const chosen = startSet(index, deps.maxBytes ?? WGSL_START_MAX_BYTES);
    if (chosen.length === 0) return;
    const store = db.transaction([WGSL], "readonly").objectStore(WGSL);
    await Promise.all(
      chosen.map(async (key) => {
        try {
          const wgsl = await unpack(await done(store.get(key)));
          if (open) held.set(key, wgsl);
        } catch {
          drop(key);
        }
      }),
    );
  })().catch(() => undefined);

  return {
    name: "store",
    salt,
    ready,
    get: (key) => {
      const wgsl = held.get(key);
      if (wgsl === undefined) return null;
      const entry = index.get(key);
      if (entry !== undefined) {
        entry.lastUsed = now();
        touched.add(key);
        touchTimer ??= setTimeout(writeTouches, TOUCH_MS);
      }
      return wgsl;
    },
    put: (key, wgsl) => {
      if (index.has(key) || !open) return;
      void (async () => {
        const value = await pack(wgsl);
        const entry: WgslEntry = { bytes: value.byteLength, raw: wgsl.length, lastUsed: now() };
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
    close: () => {
      if (touchTimer !== null) {
        clearTimeout(touchTimer);
        writeTouches();
      }
      held.clear();
      index.clear();
      close();
    },
  };
}
