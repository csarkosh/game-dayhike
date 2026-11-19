/**
 * Had by the crowd (docs/gameplay/2026-11-13-the-way-down.md): in the chase
 * the woods beside the way are full of shades the host knows nothing of,
 * each screen's own (game/crowdField.ts). A player who walks into one is had
 * by it, and their own screen is the only one that can know: it says so in a
 * bit of its command's buttons (`Button.Taken`), and the host makes the
 * death here, where every death is made.
 *
 * It takes a player's word for their own death and for nothing else: the
 * bit kills only the player who sent it, only where the chase kills at all
 * (not on the road, not in the hold after a return, not once the match is
 * decided), and it comes back as any death of the chase does.
 */
import { Button, DeathCause, Outcome, Phase, type InputCommand } from "./types.js";
import type { World } from "./world.js";
import { chaseLineDistance } from "./chaseLine.js";
import { OFF_TRAIL_M } from "./deathCause.js";

/** Host only, after the tick's moves and its safety: every living player whose command says a shade of their crowd has them dies of it. */
export function stepTaken(world: World, inputs: ReadonlyMap<number, InputCommand>): void {
  const state = world.state;
  if (world.forest === null || world.peaceful || state.phase !== Phase.Chase || state.outcome !== Outcome.Playing) return;
  for (const p of state.players.values()) {
    const cmd = inputs.get(p.id);
    if (cmd === undefined || (cmd.buttons & Button.Taken) === 0) continue;
    if (p.health <= 0 || p.safe || p.heldFor > 0) continue;
    // Off the path they died of leaving it; on it, of walking into what stood there.
    p.cause = chaseLineDistance(world, p.pos.x, p.pos.z) > OFF_TRAIL_M ? DeathCause.OffTrail : DeathCause.Into;
    p.killedBy = 0;
    p.health = 0;
  }
}
