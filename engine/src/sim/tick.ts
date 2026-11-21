/**
 * The tick every game's simulation shares, and what a game hands it. The engine moves each
 * player from its command, on every peer, so that a client predicts what its host computes;
 * what else a tick does is the game's, and runs on the host alone. A game says where a player
 * arrives and what its record holds beside the engine's fields, when a player is held still,
 * what further limits a move, and what the host does once everyone has moved.
 *
 * sim/ determinism rules: no trig, no Math.pow, no `**`, no hypot.
 */
import type { BoxProvider } from "./boxSource.js";
import { PLAYER_HALF, TICK_DT } from "./constants.js";
import type { InputCommand, Vec3 } from "./core.js";
import type { Forest } from "./forest.js";
import type { GroundField } from "./ground.js";
import { stepMovement, type MoveState } from "./movement.js";
import { containInLakes, waterLevelAt } from "./waters.js";

/** What the engine reads and writes of a player. A game's record has these and its own beside them. */
export type PlayerCore = {
  id: number;
  pos: Vec3;
  vel: Vec3;
  yaw: number;
  pitch: number;
  grounded: boolean;
  /** The sequence number of the last command this player's move was made from. */
  lastProcessedInput: number;
};

/** What the engine reads and writes of a simulation's state. A game's state has these and its own beside them. */
export type SimState<P extends PlayerCore> = {
  tick: number;
  players: Map<number, P>;
  nextEntityId: number;
  rngSeed: number;
};

/** What the engine reads of a world to move a player through it. A game's world has these and its own beside them. */
export type SimWorld<P extends PlayerCore> = {
  state: SimState<P>;
  boxes: BoxProvider;
  ground: GroundField | null;
  forest: Forest | null;
  /** False for a client's predicted copy, which moves its players and runs none of the game's own step. */
  authoritative: boolean;
  /** The sea's level, or null where the world has none. */
  waterLevel: number | null;
};

/** What a game hands the engine's tick. */
export type Rules<W extends SimWorld<P>, P extends PlayerCore> = {
  /** Where the next player arrives, and the way they face. */
  spawn(world: W): { pos: Vec3; yaw: number };
  /** A new player's whole record: the engine's fields from `id` and `at`, the game's own as a player starts with them. */
  newPlayer(id: number, at: { pos: Vec3; yaw: number }): P;
  /** Whether a player is held still: they look where their command looks and make no move. */
  held(player: P): boolean;
  /**
   * What further limits a move, on the place and velocity the step arrived at, before the
   * lakes' own walls. Inside the step and on every peer, so a client predicts it exactly.
   */
  constrain?(world: W, pos: Vec3, vel: Vec3): void;
  /** The game's own step, on the host alone, after every player has moved. */
  hostStep(world: W, inputs: Map<number, InputCommand>): void;
};

/** Adds a player under the next entity id, where the rules say and with the record the rules make. */
export function addPlayer<W extends SimWorld<P>, P extends PlayerCore>(world: W, rules: Rules<W, P>): P {
  const id = world.state.nextEntityId++;
  const player = rules.newPlayer(id, rules.spawn(world));
  world.state.players.set(id, player);
  return player;
}

export function removePlayer<P extends PlayerCore>(world: SimWorld<P>, id: number): void {
  world.state.players.delete(id);
}

/** One player's move for one command: the movement step, what the rules add to it, then the lakes' walls. */
function movePlayer<W extends SimWorld<P>, P extends PlayerCore>(world: W, player: P, cmd: InputCommand, rules: Rules<W, P>): void {
  const before: MoveState = { pos: player.pos, vel: player.vel, grounded: player.grounded };
  const after = stepMovement(
    before,
    cmd,
    TICK_DT,
    world.boxes,
    PLAYER_HALF,
    waterLevelAt(world, player.pos.x, player.pos.z),
    world.ground,
  );
  rules.constrain?.(world, after.pos, after.vel);
  containInLakes(world, after.pos, after.vel, PLAYER_HALF);
  player.pos = after.pos;
  player.vel = after.vel;
  player.grounded = after.grounded;
}

/**
 * One tick: every player moved from its command (or standing, with none), then, on the host,
 * the game's own step. A held player takes its command's look and its sequence number and
 * stays where it is.
 */
export function tickPlayers<W extends SimWorld<P>, P extends PlayerCore>(world: W, inputs: Map<number, InputCommand>, rules: Rules<W, P>): void {
  world.state.tick++;
  for (const player of world.state.players.values()) {
    const cmd = inputs.get(player.id);
    if (rules.held(player)) {
      player.vel = { x: 0, y: 0, z: 0 };
      if (cmd !== undefined) {
        player.yaw = cmd.yaw;
        player.pitch = cmd.pitch;
        player.lastProcessedInput = cmd.seq;
      }
      continue;
    }
    if (cmd === undefined) {
      movePlayer(world, player, {
        seq: player.lastProcessedInput,
        moveX: 0,
        moveZ: 0,
        yaw: player.yaw,
        pitch: player.pitch,
        buttons: 0,
      }, rules);
      continue;
    }
    player.yaw = cmd.yaw;
    player.pitch = cmd.pitch;
    movePlayer(world, player, cmd, rules);
    player.lastProcessedInput = cmd.seq;
  }
  if (!world.authoritative) return;
  rules.hostStep(world, inputs);
}

/** One command applied to one player outside the tick's own pass: a host's answer to a second input in one tick. */
export function applyInput<W extends SimWorld<P>, P extends PlayerCore>(world: W, playerId: number, cmd: InputCommand, rules: Rules<W, P>): void {
  const player = world.state.players.get(playerId);
  if (player === undefined) return;
  player.yaw = cmd.yaw;
  player.pitch = cmd.pitch;
  if (!rules.held(player)) movePlayer(world, player, cmd, rules);
  player.lastProcessedInput = cmd.seq;
}
