/**
 * An `indexedDB` in memory, as much of one as the WebGPU shader store uses
 * (`wgslStore.ts`): databases opened by name and version, an upgrade that
 * creates object stores, transactions whose requests answer a task later and
 * that complete once they have, `get`, `put`, `delete`, `getAll`,
 * `getAllKeys` (in key order), `databases` and `deleteDatabase`. Values are
 * copied in and out, as a browser's structured clone does. `refuse` fails
 * every open, as a browser with site data blocked does; `failWrites` aborts
 * every write, as a full disk does.
 */
export type MemoryIndexedDb = {
  factory: IDBFactory;
  /** The databases, by name: each object store's entries. */
  databases: Map<string, Map<string, Map<string, unknown>>>;
  refuse: boolean;
  failWrites: boolean;
};

const later = (run: () => void): void => void setTimeout(run, 0);

export function memoryIndexedDb(): MemoryIndexedDb {
  const databases = new Map<string, Map<string, Map<string, unknown>>>();
  const state = { refuse: false, failWrites: false };

  function request<T>(): { request: IDBRequest<T>; succeed(value: T): void; fail(error: unknown): void } {
    const req = { result: undefined, error: null, onsuccess: null, onerror: null } as unknown as {
      result: T;
      error: unknown;
      onsuccess: ((e: unknown) => void) | null;
      onerror: ((e: unknown) => void) | null;
    };
    return {
      request: req as unknown as IDBRequest<T>,
      succeed: (value) => {
        req.result = value;
        req.onsuccess?.({ target: req });
      },
      fail: (error) => {
        req.error = error;
        req.onerror?.({ target: req });
      },
    };
  }

  function database(name: string, stores: Map<string, Map<string, unknown>>): IDBDatabase {
    return {
      name,
      objectStoreNames: { contains: (store: string) => stores.has(store) },
      createObjectStore: (store: string) => {
        stores.set(store, new Map());
        return {};
      },
      close: () => undefined,
      transaction: (names: string | string[], mode: IDBTransactionMode = "readonly") => {
        const tx = { oncomplete: null, onerror: null, onabort: null, error: null } as unknown as {
          oncomplete: (() => void) | null;
          onerror: (() => void) | null;
          onabort: (() => void) | null;
          error: unknown;
          objectStore(name: string): unknown;
        };
        let open = 0;
        let failed = false;
        const settle = (): void => {
          if (open > 0) return;
          later(() => {
            if (failed) {
              tx.onerror?.();
              tx.onabort?.();
            } else tx.oncomplete?.();
          });
        };
        const run = <T>(work: () => T, write: boolean): IDBRequest<T> => {
          const r = request<T>();
          open++;
          later(() => {
            open--;
            if (write && state.failWrites) {
              failed = true;
              tx.error = new DOMException("the disk is full", "QuotaExceededError");
              r.fail(tx.error);
            } else r.succeed(work());
            settle();
          });
          return r.request;
        };
        tx.objectStore = (store: string) => {
          if (!(Array.isArray(names) ? names : [names]).includes(store)) throw new DOMException(`${store} is not in the transaction`, "NotFoundError");
          const entries = stores.get(store);
          if (entries === undefined) throw new DOMException(`no object store ${store}`, "NotFoundError");
          const sorted = (): string[] => [...entries.keys()].sort();
          const writable = (): void => {
            if (mode !== "readwrite") throw new DOMException("read-only transaction", "ReadOnlyError");
          };
          return {
            get: (key: string) => run(() => (entries.has(key) ? structuredClone(entries.get(key)) : undefined), false),
            getAll: () => run(() => sorted().map((key) => structuredClone(entries.get(key))), false),
            getAllKeys: () => run(() => sorted(), false),
            put: (value: unknown, key: string) => {
              writable();
              return run(() => {
                entries.set(key, structuredClone(value));
                return key;
              }, true);
            },
            delete: (key: string) => {
              writable();
              return run(() => {
                entries.delete(key);
              }, true);
            },
          };
        };
        // A transaction with no request completes too.
        later(settle);
        return tx as unknown as IDBTransaction;
      },
    } as unknown as IDBDatabase;
  }

  const factory = {
    open: (name: string, version?: number) => {
      const r = request<IDBDatabase>();
      const req = r.request as unknown as { onupgradeneeded: ((e: unknown) => void) | null; onblocked: (() => void) | null };
      req.onupgradeneeded = null;
      req.onblocked = null;
      later(() => {
        if (state.refuse) {
          r.fail(new DOMException("site data is blocked", "SecurityError"));
          return;
        }
        let stores = databases.get(name);
        const fresh = stores === undefined;
        if (stores === undefined) {
          stores = new Map();
          databases.set(name, stores);
        }
        const db = database(name, stores);
        if (fresh && (version ?? 1) >= 1) {
          (r.request as unknown as { result: IDBDatabase }).result = db;
          req.onupgradeneeded?.({ target: r.request });
        }
        r.succeed(db);
      });
      return r.request;
    },
    deleteDatabase: (name: string) => {
      const r = request<undefined>();
      later(() => {
        databases.delete(name);
        r.succeed(undefined);
      });
      return r.request;
    },
    databases: () => Promise.resolve([...databases.keys()].map((name) => ({ name, version: 1 }))),
    cmp: () => 0,
  } as unknown as IDBFactory;

  return {
    factory,
    databases,
    get refuse() {
      return state.refuse;
    },
    set refuse(value: boolean) {
      state.refuse = value;
    },
    get failWrites() {
      return state.failWrites;
    },
    set failWrites(value: boolean) {
      state.failWrites = value;
    },
  };
}
