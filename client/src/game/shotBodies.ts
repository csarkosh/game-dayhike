/**
 * Who a frame's scene shows, taken up by that frame's own bodies.
 *
 * A frame poses every body first (`entityPoses.ts`), because the scene it
 * then steps reads where another hiker's body is drawn (an end scene shown
 * on someone else's run follows the runner as the frame draws them). The
 * scene in turn says who is shown: the local hiker's own body in a shot
 * whose camera stands elsewhere, and the other bodies at the car's door
 * hidden. Where that has just changed, the bodies are posed again at once,
 * with no time passing, under what the scene now says. So a shot's first
 * frame holds the body it is of, the lamp it wears there is lit in that
 * frame, and the first frame after a shot has handed the camera back to the
 * hiker's own eye does not draw their body round it.
 *
 * Posing twice in a frame changes nothing else: a body's place is its
 * simulation place between two ticks at the frame's own share, and every
 * fade and pace steps by the time passed, which the second pose is given
 * none of. No engine.
 */
import type { WorldState } from "../sim/types.js";
import type { EntityFrame, EntityModels, EntityPoses } from "./entityPoses.js";

/** What a scene says of the bodies for a frame (`PlayNow`, `scenePlay.ts`). */
export type ShotShown = { readonly showLocal: boolean; readonly hideNear: { readonly x: number; readonly z: number; readonly radius: number } | null };

function sameDoor(a: ShotShown["hideNear"], b: ShotShown["hideNear"]): boolean {
  return a === b || (a !== null && b !== null && a.x === b.x && a.z === b.z && a.radius === b.radius);
}

/**
 * The frame's bodies under what its scene shows. `posed` is the frame's
 * bodies as they were posed before the scene was stepped (null while no
 * body can be drawn); the same record comes back unless the scene has just
 * changed who is shown, and then the bodies posed again for this frame.
 */
export function bodiesInShot(
  poses: EntityPoses, posed: EntityFrame | null, shown: ShotShown,
  state: WorldState, localId: number, alpha: number, models: EntityModels | null,
): EntityFrame | null {
  const moved = poses.showLocal !== shown.showLocal || !sameDoor(poses.hideNear, shown.hideNear);
  poses.showLocal = shown.showLocal;
  poses.hideNear = shown.hideNear;
  return moved && posed !== null && models !== null ? poses.step(state, localId, alpha, 0, models) : posed;
}
