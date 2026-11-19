/**
 * A skinned model drawn many times in one draw, each body at its own place
 * in its own clip: what an instance is drawn by, with no engine.
 *
 * The model's clips are baked once into a table of bone matrices, a row a
 * frame, the clips one after another (a renderer's own bake; `BakedClip`
 * says where each landed). A body is then two things: its matrix, and
 * eight floats that say which rows it plays and from where, which the
 * vertex stage turns into a row by a clock every body shares:
 *
 *     row = fromRow + floor((offset + clock × fps) mod (toRow − fromRow + 1))
 *
 * The offset carries half a frame, so the row read is the baked frame
 * nearest the clip's time and a time that falls on a frame reads that frame
 * whatever a float makes of the sum.
 *
 * So a body that plays on at a steady rate costs nothing a frame: only the
 * shared clock moves. Its floats are written again when its clip or its
 * rate changes, or when the clock is folded back (`SKIN_CLOCK_FOLD`), which
 * keeps the numbers small enough for a float to hold a frame's fraction.
 *
 * A clip that loops comes round in its own length, to the fraction of a
 * frame: the rows it plays are that length in frames, which need be no
 * whole number, so its last row, the first again or a frame past the end,
 * is never read. One that holds stands on its last row once it has run.
 */

/**
 * Where a clip landed in a model's table: its first row, its rows, its
 * frames a second, and how long the clip is, seconds. The rows run a frame
 * past the clip's end where its length is no whole number of frames.
 */
export type BakedClip = { readonly fromRow: number; readonly frames: number; readonly fps: number; readonly seconds: number };

/** Floats an instance's clips take: two clips of four, the second mixed in by its third float. */
export const CLIP_FLOATS = 8;

/** Seconds after which the shared clock starts again from nothing, every instance's floats written again for it. */
export const SKIN_CLOCK_FOLD = 512;

/** How far, in frames, an instance may stand from where its clip's clock puts it before its floats are written again. */
export const CLIP_DRIFT_FRAMES = 0.25;

const mod = (a: number, n: number): number => a - Math.floor(a / n) * n;

/**
 * The floats of instance `index` in `out` for `clip` at `seconds` into it,
 * playing at `rate`, under a shared clock now at `clock` seconds; `loop`
 * false holds the clip's last row once `seconds` has passed its end. True
 * where the floats changed: an instance already playing those rows at that
 * rate, within `CLIP_DRIFT_FRAMES` of the frame asked for, is left as it is.
 */
export function writeClipParams(out: Float32Array, index: number, clip: BakedClip, seconds: number, rate: number, clock: number, loop: boolean): boolean {
  const at = index * CLIP_FLOATS;
  const rows = loop ? Math.max(1, clip.seconds * clip.fps) : clip.frames;
  const toRow = Math.fround(clip.fromRow + rows - 1);
  const frame = seconds * clip.fps;
  const ended = !loop && frame >= rows - 1;
  const fps = ended || rows === 1 ? 0 : clip.fps * rate;
  const offset = ended ? rows - 1 : mod(frame + 0.5 - clock * fps, rows);
  if (out[at] === clip.fromRow && out[at + 1] === toRow && Math.abs((out[at + 3] as number) - fps) <= 1e-4 * Math.max(1, Math.abs(fps))) {
    const apart = mod(offset - (out[at + 2] as number) + rows / 2, rows) - rows / 2;
    if (Math.abs(apart) < CLIP_DRIFT_FRAMES) return false;
  }
  out[at] = clip.fromRow;
  out[at + 1] = toRow;
  out[at + 2] = offset;
  out[at + 3] = fps;
  // The second clip is the first again, mixed in by nothing.
  out[at + 4] = clip.fromRow;
  out[at + 5] = toRow;
  out[at + 6] = 0;
  out[at + 7] = fps;
  return true;
}

/** The row the vertex stage reads for the floats of instance `index` under a clock at `clock`: the shader's own arithmetic. */
export function clipRow(params: Float32Array, index: number, clock: number): number {
  const at = index * CLIP_FLOATS;
  const from = params[at] as number;
  const span = Math.max(1, (params[at + 1] as number) - from + 1);
  const raw = (params[at + 2] as number) + clock * (params[at + 3] as number);
  return Math.trunc(from + (raw - Math.floor(raw / span) * span));
}

/**
 * The matrix of a body standing at (x, y, z), turned `yaw` about the
 * vertical and `scale` times its model's size, into the sixteen floats of
 * instance `index`: the turn a left-handed yaw makes, +Z toward +X.
 */
export function writeBodyMatrix(out: Float32Array, index: number, x: number, y: number, z: number, yaw: number, scale: number): void {
  const at = index * 16;
  const c = Math.cos(yaw) * scale;
  const s = Math.sin(yaw) * scale;
  out[at] = c;
  out[at + 1] = 0;
  out[at + 2] = -s;
  out[at + 3] = 0;
  out[at + 4] = 0;
  out[at + 5] = scale;
  out[at + 6] = 0;
  out[at + 7] = 0;
  out[at + 8] = s;
  out[at + 9] = 0;
  out[at + 10] = c;
  out[at + 11] = 0;
  out[at + 12] = x;
  out[at + 13] = y;
  out[at + 14] = z;
  out[at + 15] = 1;
}
