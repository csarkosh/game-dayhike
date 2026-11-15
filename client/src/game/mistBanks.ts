/**
 * The valley mist banks as a frame draws them, with no engine: which of the
 * banks `mistField.ts` places round the camera are shown, where the wind has
 * carried each, and how far each has faded. A renderer's shell hands these to
 * its quads: the one on Babylon.js (`mistMeshes.ts`) a mesh a bank, the one on
 * Babylon Lite (`lite/mistMeshes.ts`) an instance a bank.
 *
 * A bank is a soft sprite on a quad that turns about the vertical to face
 * along the camera's view. It fades out near the eye so the camera can pass
 * through it, at the rim of the collection radius so the last bank never
 * pops, and at the edge of its own cell as the wind carries it there.
 */
import { clamp01 } from "./colour.js";
import { MIST_CELL, MIST_RADIUS, collectMistBanks, type MistBank } from "./mistField.js";
import type { QualityTier } from "./quality.js";
import { mistOpacityUnder, type WeatherParams } from "./weather.js";
import type { WindRecord } from "./windParams.js";

/** Below this distance a bank fades out so the camera can pass through it. */
export const MIST_NEAR_FADE_START = 25;
export const MIST_NEAR_FADE_SPAN = 40;
/** Fade span inside the collection radius so the 12th bank never pops. */
export const MIST_EDGE_FADE_SPAN = 150;
/** Drift speed, m/s, at wind speed 1. */
export const MIST_DRIFT = 0.25;
/** Span, metres, over which a bank dissolves as it nears its own wrap boundary. */
export const MIST_WRAP_FADE = 8;
/** The visibility at or under which a bank is not drawn at all. */
export const MIST_SHOWN_FLOOR = 0.01;

/**
 * Billboard quad cap by quality tier. `collectMistBanks` always
 * returns up to `MIST_CAP` banks nearest-first, so a lower cap here simply
 * drives fewer of the nearest banks — no change needed in `mistField.ts`.
 */
export const MIST_CAP_BY_TIER: Record<QualityTier, number> = { low: 6, medium: 12, high: 12 };

/**
 * Wraps a drift offset into ±MIST_CELL/2 so a bank wanders but never leaves
 * its cell. Every bank rides the same drift distance (`off`, below); wrapping it
 * unmodified would put every bank's own wrap boundary at the same `off`
 * value, so all twelve would cross it — and teleport by a full MIST_CELL —
 * in the same frame. The update loop instead wraps `off + bank.hash *
 * MIST_CELL`: folding in a per-bank hash before the modulus staggers each
 * bank onto its own phase of the 96 m cycle, so they wrap one at a time; the
 * near-boundary fade below still hides the jump itself.
 */
function wrap(v: number): number {
  return ((v + MIST_CELL / 2) % MIST_CELL + MIST_CELL) % MIST_CELL - MIST_CELL / 2;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** Fades a bank to invisible as its wrapped offset nears ±MIST_CELL/2, so it
 * dissolves before it would otherwise snap back a cell. */
function wrapFadeAt(offset: number): number {
  return 1 - smoothstep(MIST_CELL / 2 - MIST_WRAP_FADE, MIST_CELL / 2, Math.abs(offset));
}

/** One of a renderer's quads for a frame. */
export type DrawnMistBank = {
  /** Whether a bank stands at this place in the nearest-first list; the rest is the last bank's when none does. */
  placed: boolean;
  /** The quad's centre, where the wind has carried the bank. */
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  /** The quad's alpha over its sprite's: the weather's opacity under the three fades. */
  visibility: number;
};

export type MistBanks = {
  /** The tier's quads, nearest bank first, each filled in place by `update`. */
  readonly drawn: readonly DrawnMistBank[];
  /**
   * Steps the drift to `seconds` (the raw render clock; the drift is
   * differenced from it here) and fills `drawn` for a camera at (camX, camZ).
   * False where the weather has no mist: nothing is to be drawn and `drawn`
   * is left as it was.
   */
  update(camX: number, camZ: number, w: WeatherParams, wind: WindRecord, seconds: number): boolean;
};

/** Whether a quad is drawn this frame: a bank stands there and has not faded out. */
export function mistBankShown(bank: DrawnMistBank): boolean {
  return bank.placed && bank.visibility > MIST_SHOWN_FLOOR;
}

/** The banks of `seed`'s world as `tier` draws them. */
export function createMistBanks(seed: number, tier: QualityTier): MistBanks {
  const drawn: DrawnMistBank[] = [];
  for (let i = 0; i < MIST_CAP_BY_TIER[tier]; i++) drawn.push({ placed: false, x: 0, y: 0, z: 0, width: 1, height: 1, visibility: 0 });

  let banks: MistBank[] = [];
  let lastCellX: number | null = null;
  let lastCellZ: number | null = null;
  /** Metres of drift accumulated so far, and the clock the last step ended at.
   * INTEGRATED rather than read off the absolute clock: with `off = MIST_DRIFT
   * · speed · seconds` a change of speed rescales the whole history at once, so
   * clear turning to rain ten minutes in slid every bank about 97 m sideways in
   * a single frame. */
  let driftDistance = 0;
  let lastSeconds = 0;

  return {
    drawn,
    update(camX, camZ, w, wind, seconds) {
      // Stepped first, and before the early return below, so the clock is
      // tracked whether or not there is mist to draw. At most one second of
      // wind a step: a suspended tab (or a stalled first frame) resumes where
      // it left off instead of lurching the whole gap downwind at once, and a
      // clock that has not moved contributes nothing.
      driftDistance += MIST_DRIFT * wind.speed * Math.min(1, Math.max(0, seconds - lastSeconds));
      lastSeconds = seconds;
      const opacity = mistOpacityUnder(w);
      if (opacity <= 0) {
        lastCellX = null; // force a recollect when mist returns
        return false;
      }
      const cellX = Math.floor(camX / MIST_CELL);
      const cellZ = Math.floor(camZ / MIST_CELL);
      if (cellX !== lastCellX || cellZ !== lastCellZ) {
        banks = collectMistBanks(seed, camX, camZ);
        lastCellX = cellX;
        lastCellZ = cellZ;
      }
      const off = driftDistance;
      for (let i = 0; i < drawn.length; i++) {
        const quad = drawn[i] as DrawnMistBank;
        const bank = banks[i];
        if (!bank) {
          quad.placed = false;
          continue;
        }
        const offset = wrap(off + bank.hash * MIST_CELL);
        const drawnX = bank.x + offset * wind.dirX;
        const drawnZ = bank.z + offset * wind.dirZ;
        quad.placed = true;
        quad.x = drawnX;
        quad.y = bank.y;
        quad.z = drawnZ;
        quad.width = bank.width;
        quad.height = bank.height;
        // From the DRAWN position, not the seeded one: a bank's own hash can
        // phase it up to ±MIST_CELL/2 off its seeded spot even at rest (see
        // wrap's comment), and MIST_NEAR_FADE_SPAN is narrower than that, so
        // keying the fades off the seed would let a drifted bank sit inside
        // the near-fade ring — or past the collection radius — unfaded.
        const d = Math.sqrt((drawnX - camX) ** 2 + (drawnZ - camZ) ** 2);
        const nearFade = clamp01((d - MIST_NEAR_FADE_START) / MIST_NEAR_FADE_SPAN);
        const edgeFade = clamp01((MIST_RADIUS - d) / MIST_EDGE_FADE_SPAN);
        const wrapFade = wrapFadeAt(offset);
        quad.visibility = opacity * nearFade * edgeFade * wrapFade;
      }
      return true;
    },
  };
}
