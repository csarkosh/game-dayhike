/**
 * What a frame of the hike's renderer on Babylon Lite hands to the GPU, and
 * the bound on how much of it the streamed world may be.
 *
 * **The count.** Every shell says what it hands to Lite as it hands it:
 * the bytes of an instance list's matrices and of its plugin instance data,
 * of a mesh's geometry and of its plugin vertex data, of a table written to
 * a texture and of the frame's uniform block, each with the buffer or
 * texture writes it costs; how many instances it composed, the meshes it
 * made and let go, and the materials whose own uniforms it marked to be
 * written. Lite sends most of it as the frame is drawn, so a frame's
 * record is closed once the frame's jobs have run, and `last` is the
 * record of the frame before. It counts what the game's code hands over,
 * not what Lite writes for itself (the scene's uniforms, a light's).
 *
 * **The bound.** What follows the camera is streamed: the rings and the
 * patches, the forest's lists and the ground cover's. A frame's streamed
 * bytes are held to `UPLOAD_BUDGET_BYTES`: a hand-over asks first
 * (`hold`), and one that does not fit in what is left of the frame's
 * budget waits for a frame that has room, so what one frame would have
 * sent is carried over the frames after. The renderer on Babylon.js has no
 * such number: what bounds its frame is the scheduler's time
 * (`SYNC_BUDGET_MS`), with each upload slice said ahead (a millisecond a
 * ring, two for the forest's lists). The budget here is two mebibytes,
 * about one shell's lists at a forest view (the forest's and the clutter's
 * are 1.9 MB each on the low tier), so two shells' hand-overs do not share
 * a frame and the small ones (a cut of the grass, the duff's lists) do.
 *
 * A hand-over is whole: a build is shown in one step, so a list or a set
 * of rings is never drawn half written, and one larger than the whole
 * budget is not split. It goes alone, first in its frame: `fits` lets the
 * frame's first streamed hand-over through whatever its size. And a job
 * the scheduler runs to its end because it is late (`SYNC_LATE_FRAMES_MAX`)
 * does not wait: the game's bound on how far the picture trails the view
 * comes before this one.
 *
 * Loads no engine: a test drives it.
 */
import { SYNC_BUDGET_MS, type Slices } from "../syncJobs.js";

/** The most streamed bytes a frame hands to the GPU, past which a hand-over waits for the next. */
export const UPLOAD_BUDGET_BYTES = 2 * 1024 * 1024;

/**
 * What a waiting hand-over tells the scheduler its next slice takes (ms):
 * more than a frame's whole share, so the slice starts only as a frame's
 * share begins (`syncJobs.ts`), which is the next frame's.
 */
export const UPLOAD_WAIT_MS = SYNC_BUDGET_MS + 1;

/** The kinds of data a shell hands over. */
export const UPLOAD_KINDS = ["instances", "pluginInstances", "geometry", "pluginVertices", "textures", "uniforms"] as const;
export type UploadKind = (typeof UPLOAD_KINDS)[number];

/** One frame's record. */
export type FrameUploadCounts = {
  /** Bytes handed to the GPU, all kinds. */
  bytes: number;
  /** Buffer and texture writes those bytes cost. */
  writes: number;
  /** Of `bytes`, the streamed ones: what the budget bounds. */
  streamed: number;
  /** Bytes by kind. */
  byKind: Record<UploadKind, number>;
  /** Instances whose matrices were handed over. */
  instances: number;
  /** Meshes made, and let go. */
  meshesMade: number;
  meshesDropped: number;
  /** Materials whose own uniforms were marked to be written again: a buffer write each, of a size that is Lite's. */
  materialsMarked: number;
  /** Hand-overs that waited for this frame to end. */
  held: number;
};

export type FrameUploads = {
  /** Counts `bytes` of `kind` handed over, in `writes` writes, outside the budget: a first build's, a bake's, the frame's uniforms. */
  count(kind: UploadKind, bytes: number, writes?: number): void;
  /** Counts `bytes` of `kind` handed over by the streamed world, and takes them from the frame's budget. */
  stream(kind: UploadKind, bytes: number, writes?: number): void;
  /** Whether a streamed hand-over of `bytes` may go this frame: it fits in what is left, or nothing was streamed yet. */
  fits(bytes: number): boolean;
  /**
   * Holds a job until a streamed hand-over of `bytes` may go: as slices, each wait said to the scheduler as a slice
   * longer than a share, so the job is taken up again as the next frame's share begins. Returns at once where it
   * fits, and after one wait where the scheduler runs the job on within the same frame (it is late, or built at once).
   */
  hold(bytes: number): Slices;
  /** Counts instances composed, meshes made and let go, materials marked. */
  composed(instances: number): void;
  made(meshes?: number): void;
  dropped(meshes?: number): void;
  marked(materials?: number): void;
  /** Closes the frame's record: it becomes `last`, and the next frame's begins with the whole budget. */
  close(): void;
  /** Frames closed. */
  readonly frame: number;
  /** The record of the frame last closed, written in place at each close. */
  readonly last: Readonly<FrameUploadCounts>;
  /** The record of the frame in progress. */
  readonly now: Readonly<FrameUploadCounts>;
};

function emptyCounts(): FrameUploadCounts {
  return {
    bytes: 0, writes: 0, streamed: 0,
    byKind: { instances: 0, pluginInstances: 0, geometry: 0, pluginVertices: 0, textures: 0, uniforms: 0 },
    instances: 0, meshesMade: 0, meshesDropped: 0, materialsMarked: 0, held: 0,
  };
}

function copyCounts(from: Readonly<FrameUploadCounts>, to: FrameUploadCounts): void {
  to.bytes = from.bytes;
  to.writes = from.writes;
  to.streamed = from.streamed;
  for (const kind of UPLOAD_KINDS) to.byKind[kind] = from.byKind[kind];
  to.instances = from.instances;
  to.meshesMade = from.meshesMade;
  to.meshesDropped = from.meshesDropped;
  to.materialsMarked = from.materialsMarked;
  to.held = from.held;
}

/** A frame that handed nothing over. */
const NONE: Readonly<FrameUploadCounts> = emptyCounts();

/** A copy of `counts`, for a read-out that keeps a reading a frame: the records are written in place. */
export function uploadCountsCopy(counts: Readonly<FrameUploadCounts>): FrameUploadCounts {
  const copy = emptyCounts();
  copyCounts(counts, copy);
  return copy;
}

/** A renderer's record of its uploads, a frame's streamed bytes bounded by `budget`. */
export function createFrameUploads(budget: number = UPLOAD_BUDGET_BYTES): FrameUploads {
  const now = emptyCounts();
  const last = emptyCounts();
  let frame = 0;

  function count(kind: UploadKind, bytes: number, writes = 1): void {
    now.bytes += bytes;
    now.writes += writes;
    now.byKind[kind] += bytes;
  }
  const fits = (bytes: number): boolean => now.streamed === 0 || now.streamed + bytes <= budget;

  return {
    count,
    stream(kind, bytes, writes = 1) {
      count(kind, bytes, writes);
      now.streamed += bytes;
    },
    fits,
    *hold(bytes) {
      while (!fits(bytes)) {
        const waited = frame;
        now.held++;
        yield UPLOAD_WAIT_MS;
        // Run on within the frame it waited in: the scheduler wants the job's end now.
        if (frame === waited) return;
      }
    },
    composed(instances) {
      now.instances += instances;
    },
    made(meshes = 1) {
      now.meshesMade += meshes;
    },
    dropped(meshes = 1) {
      now.meshesDropped += meshes;
    },
    marked(materials = 1) {
      now.materialsMarked += materials;
    },
    close() {
      copyCounts(now, last);
      copyCounts(NONE, now);
      frame++;
    },
    get frame() {
      return frame;
    },
    last,
    now,
  };
}
