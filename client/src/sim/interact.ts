import type { PlayerState, Vec3 } from "./types.js";
import type { World } from "./world.js";
import { PLAYER_EYE_OFFSET } from "./constants.js";
import { aimDirection } from "./view.js";

/**
 * A thing a player can act on. Registered by the system that owns
 * it — the register's box and other interactables — and resolved here; `onInteract` is
 * that system's effect, called by the host with the acting player's id. The
 * resolver applies nothing itself.
 */
export type Interactable = {
  id: number;
  pos: Vec3;
  /** Half-extent of the thing, so reach is measured to its surface. */
  radius: number;
  kind: number;
  /**
   * What the prompt says, when the verb depends on the thing ("Read the
   * poster") rather than only on its kind. Absent: the kind's own label.
   */
  label?: string;
  /** False while the thing cannot be acted on. Absent means enabled. */
  enabled?: boolean;
  onInteract: (playerId: number) => void;
};

/** Metres from the eye to a target's surface. */
export const INTERACT_REACH = 2.5;
/** cos 35°: the target's centre must lie inside a 35° cone around the eye ray. */
export const INTERACT_HALF_ANGLE_COS = 0.8192;

/** The bits of `current` that are not set in `previous`: a press, not a hold. */
export function pressedEdges(previous: number, current: number): number {
  return current & ~previous;
}

/**
 * The nearest interactable within reach and inside the facing cone, or null.
 * Pure: reads the world's registry and the player's pose, mutates nothing.
 */
export function resolveInteract(world: World, player: PlayerState): Interactable | null {
  const ex = player.pos.x, ey = player.pos.y + PLAYER_EYE_OFFSET, ez = player.pos.z;
  const dir = aimDirection(player.yaw, player.pitch);
  let best: Interactable | null = null;
  let bestDist = Infinity;
  // `Map` iterates in insertion order, which the host controls by the order it
  // registers each interactable — deterministic across peers, and what makes
  // a tie between two equally-near targets resolve the same way everywhere.
  for (const it of world.interactables.values()) {
    if (it.enabled === false) continue;
    const dx = it.pos.x - ex, dy = it.pos.y - ey, dz = it.pos.z - ez;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist - it.radius > INTERACT_REACH) continue;
    if (dist > 1e-9 && (dx * dir.x + dy * dir.y + dz * dir.z) / dist < INTERACT_HALF_ANGLE_COS) continue;
    if (dist < bestDist) { best = it; bestDist = dist; }
  }
  return best;
}
