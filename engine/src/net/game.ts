/**
 * What a game hands the network sessions. The engine carries inputs to the host, steps the
 * world there, sends snapshots back, predicts the local player and blends the others between
 * snapshots; a game says what a snapshot holds and how it is packed, what a pressed button does
 * on the host, how the host's word corrects the predicted world, and what a frame is drawn from.
 */
import type { Vec3 } from "../sim/core.js";
import type { PlayerCore, Rules, SimWorld } from "../sim/tick.js";

/** What the sessions read of a player in a snapshot: enough to correct a prediction and to blend. */
export type SnapshotMover = { id: number; pos: Vec3; vel: Vec3; yaw: number; grounded: boolean };

/** What the sessions read of a snapshot. A game's snapshot has these and its own beside them. */
export type SnapshotCore = { tick: number; lastProcessedInput: number; players: readonly SnapshotMover[] };

/**
 * A game, as the sessions see it: `W` its world, `P` a player's record, `S` its snapshot, `V`
 * what a frame is drawn from, `E` an event of its own.
 */
export type NetGame<W extends SimWorld<P>, P extends PlayerCore, S extends SnapshotCore, V, E> = {
  /** What two ends must share to play together; a peer on another is told to update. */
  protocolVersion: number;
  rules: Rules<W, P>;

  encodeSnapshot(snapshot: S): ArrayBuffer;
  decodeSnapshot(buffer: ArrayBuffer): S;
  /** An event of the game's own, packed under a message type the engine's wire leaves free. */
  encodeEvent(event: E): ArrayBuffer;
  /** The game's event out of a message of `type`, or null for a type that is not the game's. */
  decodeEvent(type: number, buffer: ArrayBuffer): E | null;

  /** On the host: what a peer is sent of the world, with the last input of theirs it has taken. */
  snapshot(world: W, lastProcessedInput: number): S;
  /** On the host: what the lag history keeps a place for each tick, beside nothing else. */
  tracked(world: W): Iterable<{ id: number; pos: Vec3 }>;
  /**
   * On the host, after a tick: what the buttons a player newly pressed do. A player the rules
   * hold still presses nothing. An event it returns is said to the player whose press it was.
   */
  pressed(world: W, player: P, bits: number): E | null;

  /**
   * On a client: the host's word on the local player and the match, taken into the predicted
   * world. The engine has taken the place, the velocity, the grounding and the tick already.
   */
  correct(world: W, local: P, truth: S["players"][number], snapshot: S): void;
  /** On a client: the snapshot `alpha` of the way from `a` to `b`, for whatever is not predicted. */
  blend(a: S, b: S, alpha: number): S;
  /**
   * On a client: what a frame is drawn from. `between` is the blended snapshot for this moment
   * and `latest` the newest one, either null before the first arrives; the local player is the
   * predicted world's own.
   */
  view(world: W, localId: number, between: S | null, latest: S | null): V;
};
