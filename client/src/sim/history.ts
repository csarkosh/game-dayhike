import type { Vec3 } from "./types.js";
import { cloneVec3 } from "./types.js";
import { LAG_COMP_HISTORY_TICKS } from "./constants.js";

type Frame = { tick: number; positions: Map<number, Vec3> };

/**
 * Ring buffer of entity positions, one entry per tick, covering roughly the
 * last second. Lag compensation rewinds into this to reconstruct the world a
 * shooting client actually saw.
 */
export class PositionHistory {
  private readonly frames: (Frame | undefined)[] = new Array(LAG_COMP_HISTORY_TICKS).fill(
    undefined,
  );

  private static slotFor(tick: number): number {
    return ((tick % LAG_COMP_HISTORY_TICKS) + LAG_COMP_HISTORY_TICKS) % LAG_COMP_HISTORY_TICKS;
  }

  recordPositions(tick: number, positions: Map<number, Vec3>): void {
    const copy = new Map<number, Vec3>();
    // Copy: the caller's vectors keep mutating as the sim advances.
    for (const [id, pos] of positions) copy.set(id, cloneVec3(pos));
    this.frames[PositionHistory.slotFor(tick)] = { tick, positions: copy };
  }

  at(tick: number): Map<number, Vec3> | undefined {
    const frame = this.frames[PositionHistory.slotFor(tick)];
    // The slot may hold a newer tick that wrapped over the one asked for.
    return frame !== undefined && frame.tick === tick ? frame.positions : undefined;
  }
}
