/**
 * The values a ground-cover shell (blades, duff, clutter) computes for one
 * instance, kept for as long as the shell's collector keeps the instance.
 *
 * Everything a fill writes per instance, other than what depends on the
 * bucket, is a function of the instance and the seed alone: its matrix (the
 * trample frame beside the bench included) and its ground colour and canopy
 * shade (`writeFoliage`, several walks through the terrain's noise). The
 * collectors hand back the same object for a cell on every rebuild until
 * their sweep lets the cell go, so the shell computes those values the first
 * time an instance is listed, keeps them in one slab under the object, and
 * copies them on every later rebuild. The collector's sweep calls `release`,
 * so the kept set never outgrows the collector's own.
 *
 * One `Float32Array` for every instance, `stride` floats a slot, grown by
 * doubling and never shrunk; a released slot is reused by the next instance.
 * The floats are the ones the fill writes into its Float32 buffers, so a copy
 * is the same bits a fresh computation would upload.
 */
export type KeptValues<K extends object> = {
  /**
   * The offset in `data` of `key`'s values, computing them with the
   * shell's `compute` the first time. Read `data` after this call: the slab
   * is replaced when it grows.
   */
  offsetOf(key: K): number;
  /** Lets `key`'s values go, freeing its slot; a key never kept is ignored. */
  release(key: K): void;
  /** The slab, `stride` floats a slot. */
  readonly data: Float32Array;
  /** Instances kept. */
  readonly size: number;
};

/** Slots the slab first holds. */
const MIN_SLOTS = 256;

export function createKeptValues<K extends object>(
  stride: number,
  compute: (key: K, out: Float32Array, offset: number) => void,
): KeptValues<K> {
  const slots = new Map<K, number>();
  const free: number[] = [];
  let data = new Float32Array(MIN_SLOTS * stride);
  let used = 0;
  return {
    offsetOf(key) {
      const slot = slots.get(key);
      if (slot !== undefined) return slot * stride;
      let next = free.pop();
      if (next === undefined) {
        if (used * stride === data.length) {
          const grown = new Float32Array(data.length * 2);
          grown.set(data);
          data = grown;
        }
        next = used++;
      }
      slots.set(key, next);
      compute(key, data, next * stride);
      return next * stride;
    },
    release(key) {
      const slot = slots.get(key);
      if (slot === undefined) return;
      slots.delete(key);
      free.push(slot);
    },
    get data() {
      return data;
    },
    get size() {
      return slots.size;
    },
  };
}
