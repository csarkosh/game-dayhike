/**
 * A client's session: it predicts its own player from its own input, sends that input to the
 * host, corrects the prediction by each snapshot, and blends everyone else between snapshots.
 * Which world, what a snapshot holds and what a frame is drawn from are the game's (`game.ts`).
 */
import type { InputCommand, Vec3 } from "../sim/core.js";
import { cloneVec3 } from "../sim/core.js";
import { INTERP_DELAY_MS, MAX_UNACKED_INPUTS, TELEPORT_M } from "../sim/constants.js";
import { addPlayer, tickPlayers, type PlayerCore, type SimWorld } from "../sim/tick.js";
import type { NetGame, SnapshotCore } from "./game.js";
import type { Transport } from "./transport.js";
import { MessageType, decodeWireEvent, encodeInput, encodeWireEvent, messageTypeOf } from "./wire.js";

const SNAPSHOT_BUFFER_MS = 1500;
const PING_INTERVAL_MS = 1000;

export type NetStats = {
  rttMs: number;
  lastPredictionError: number;
  snapshotsReceived: number;
  unackedInputs: number;
  bytesReceived: number;
};

export type NamedHandler = (e: { entityId: number; peerId: string }) => void;

/**
 * Why a session ended, as far as the client can tell from the host's messages.
 *
 * - `version_skew`: the host's Welcome carried another protocol version, or a
 *   level id for the same world built by different generator code, so the
 *   two pages are running different builds. Nothing on this page can join
 *   that host; a reload that fetches the current build can. `message` names
 *   what each side runs, for the console.
 * - `world_changed`: the host's level id names another world (another seed
 *   or terrain variant) — typically a follower still connecting to a game
 *   the host has already left. Following the host's route fixes it; a
 *   reload would not.
 * - `host_ended`: the host sent SessionEnded. `message` is its reason,
 *   possibly empty.
 *
 * A transport that drops, or a lobby that ends, is noticed by whoever owns
 * those (app.ts), not here.
 */
export type SessionEnd =
  | { kind: "version_skew"; message: string }
  | { kind: "world_changed"; message: string }
  | { kind: "host_ended"; message: string };

const STALE_CLIENT_ADVICE = "Reload the page to update.";

/**
 * A remote entity's place between two snapshots: part-way from the older to
 * the newer, but for a jump no walk makes (`TELEPORT_M`: a player back on
 * the crest, a Hollow moved to meet them), which is drawn where it landed,
 * never as a streak across the screen.
 */
export function blendPosition(from: Vec3, to: Vec3, alpha: number): Vec3 {
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
  if (dx * dx + dy * dy + dz * dz > TELEPORT_M * TELEPORT_M) return { x: to.x, y: to.y, z: to.z };
  return { x: from.x + dx * alpha, y: from.y + dy * alpha, z: from.z + dz * alpha };
}

/** The angle `alpha` of the shorter way round from `from` to `to`. */
export function lerpAngle(from: number, to: number, alpha: number): number {
  const twoPi = Math.PI * 2;
  let delta = (to - from) % twoPi;
  if (delta > Math.PI) delta -= twoPi;
  if (delta < -Math.PI) delta += twoPi;
  return from + delta * alpha;
}

/**
 * Why two forest level ids disagree. An id reads
 * `forest/<generation>/<variant>/<seed>/<fieldHash>/<passHash>` (sim/forest.ts):
 * the variant and seed choose the world, and the rest digest the code that
 * builds it. Only a difference in the choice, at the same generation, is a
 * different world; anything else, including an id that does not parse, is a
 * different build.
 */
export function classifyLevelMismatch(
  hostLevelId: string,
  ownLevelId: string,
): "version_skew" | "world_changed" {
  const host = hostLevelId.split("/");
  const own = ownLevelId.split("/");
  const isForest = (parts: string[]) => parts.length === 6 && parts[0] === "forest";
  if (!isForest(host) || !isForest(own)) return "version_skew";
  // Another generation is another build whatever else differs: the ids are
  // not comparable segment by segment across generator versions.
  if (host[1] !== own[1]) return "version_skew";
  return host[2] !== own[2] || host[3] !== own[3] ? "world_changed" : "version_skew";
}

export type ClientSession<W, P, V, E> = {
  readonly ready: boolean;
  readonly localEntityId: number;
  readonly stats: NetStats;
  /** The predicted world: the local player's, stepped ahead of the host's word. */
  readonly world: W;
  tick(input: InputCommand): void;
  /** What a frame at `nowMs` is drawn from: the game's own view of the predicted world and the snapshots. */
  renderState(nowMs: number): V;
  localPlayer(): P | undefined;
  onSessionEnd(handler: (end: SessionEnd) => void): void;
  /** Hears an event of the game's own that the host said to this client. */
  onGameEvent(handler: (event: E) => void): void;
  onNamed(handler: NamedHandler): void;
  dispose(): void;
};

type TimedSnapshot<S> = { at: number; snapshot: S };

export function createClientSession<W extends SimWorld<P>, P extends PlayerCore, S extends SnapshotCore, V, E>(
  game: NetGame<W, P, S, V, E>,
  predicted: W,
  transport: Transport,
  clock: () => number,
  opts: { expectedLevelId?: string } = {},
): ClientSession<W, P, V, E> {
  const { expectedLevelId } = opts;
  let localId = 0;
  let ready = false;

  const unacked: InputCommand[] = [];
  const snapshots: TimedSnapshot<S>[] = [];
  let latest: S | null = null;

  let lastPingAt = -Infinity;
  const stats: NetStats = {
    rttMs: 0,
    lastPredictionError: 0,
    snapshotsReceived: 0,
    unackedInputs: 0,
    bytesReceived: 0,
  };

  let endHandler: ((end: SessionEnd) => void) | null = null;
  let gameEventHandler: ((event: E) => void) | null = null;
  let namedHandler: NamedHandler | null = null;
  // A roster or end screen typically wires up onNamed after the session is
  // already connected, well after the host announced every pairing that
  // existed at join time — so those are kept and replayed to a late
  // subscriber rather than lost.
  const namedSoFar: Array<{ entityId: number; peerId: string }> = [];

  transport.onEvent((data) => {
    try {
      const own = game.decodeEvent(messageTypeOf(data), data);
      if (own !== null) {
        gameEventHandler?.(own);
        return;
      }
      const event = decodeWireEvent(data);
      switch (event.t) {
        case MessageType.Welcome: {
          // An older host's Welcome has the level length at byte 7, so it decodes
          // here as a "version" of 9 (sandbox01) or 38-50 (a forest id) and is
          // refused; an older client reads our version byte as its level length
          // and refuses on its own level check — both directions fail in words,
          // neither decodes garbage.
          if (event.protocolVersion !== game.protocolVersion) {
            endHandler?.({
              kind: "version_skew",
              message:
                `Protocol mismatch: the host is running protocol ${event.protocolVersion}, this client has ` +
                `${game.protocolVersion}. ${STALE_CLIENT_ADVICE}`,
            });
            return;
          }
          // Nothing about the world crosses the wire, so this string is the only
          // agreement check there is — and with a generated level the realistic
          // failure is not float divergence but version skew: one peer on a
          // bundle cached from before a deploy, simulating a different forest and
          // desyncing invisibly. Refusing loudly beats that.
          if (expectedLevelId !== undefined && event.levelId !== expectedLevelId) {
            // A reload fetches the current bundle, on the web and in the
            // desktop shell alike: the shell loads the live site.
            const kind = classifyLevelMismatch(event.levelId, expectedLevelId);
            endHandler?.(
              kind === "world_changed"
                ? {
                    kind,
                    message:
                      `World mismatch: the host is running ${event.levelId}, this client has ` +
                      `${expectedLevelId}.`,
                  }
                : {
                    kind,
                    message:
                      `Level mismatch: the host is running ${event.levelId}, this client has ` +
                      `${expectedLevelId}. ${STALE_CLIENT_ADVICE}`,
                  },
            );
            return;
          }
          localId = event.entityId;
          const player = addPlayer(predicted, game.rules);
          // Re-key the spawned player to the id the host assigned us.
          predicted.state.players.delete(player.id);
          player.id = localId;
          predicted.state.players.set(localId, player);
          predicted.state.tick = event.tick;
          ready = true;
          break;
        }
        case MessageType.Pong:
          stats.rttMs = clock() - event.stamp;
          break;
        case MessageType.Ping:
          // The host measures RTT too, for its own connection-quality tracking.
          transport.sendEvent(
            encodeWireEvent({ t: MessageType.Pong, stamp: event.stamp, hostTick: 0 }),
          );
          break;
        case MessageType.SessionEnded:
          endHandler?.({ kind: "host_ended", message: event.reason });
          break;
        case MessageType.Named: {
          const named = { entityId: event.entityId, peerId: event.peerId };
          namedSoFar.push(named);
          namedHandler?.(named);
          break;
        }
        default:
          break;
      }
    } catch {
      // Ignore malformed events rather than tearing down the session.
    }
  });

  transport.onState((data) => {
    try {
      if (messageTypeOf(data) !== MessageType.Snapshot) return;
      stats.bytesReceived += data.byteLength;
      const snapshot = game.decodeSnapshot(data);

      // Unordered channel: an older snapshot can arrive after a newer one.
      // Applying it would move everything backwards.
      if (latest !== null && snapshot.tick <= latest.tick) return;

      latest = snapshot;
      stats.snapshotsReceived++;

      const now = clock();
      snapshots.push({ at: now, snapshot });
      while (snapshots.length > 0 && now - (snapshots[0] as TimedSnapshot<S>).at > SNAPSHOT_BUFFER_MS) {
        snapshots.shift();
      }

      reconcile(snapshot);
    } catch {
      // Ignore malformed snapshots.
    }
  });

  function reconcile(snapshot: S): void {
    if (!ready) return;
    const authoritative = snapshot.players.find((p) => p.id === localId);
    const local = predicted.state.players.get(localId);
    if (authoritative === undefined || local === undefined) return;

    const beforeCorrection: Vec3 = cloneVec3(local.pos);

    // Snap to the authoritative state, velocity included. Zeroing velocity
    // here instead would restart acceleration from a standstill on every
    // snapshot and make movement feel sluggish for reasons that look like a
    // physics bug rather than a netcode one.
    local.pos = cloneVec3(authoritative.pos);
    local.vel = cloneVec3(authoritative.vel);
    local.grounded = authoritative.grounded;
    local.lastProcessedInput = snapshot.lastProcessedInput;
    predicted.state.tick = snapshot.tick;
    // The game's own fields of the player and of the match, as the host has them.
    game.correct(predicted, local, authoritative, snapshot);

    // ...drop everything the host has already applied...
    while (unacked.length > 0 && (unacked[0] as InputCommand).seq <= snapshot.lastProcessedInput) {
      unacked.shift();
    }

    // ...and replay the rest through the same movement code the host runs.
    // Identical code plus identical inputs means the correction is invisible.
    for (const cmd of unacked) {
      tickPlayers(predicted, new Map([[localId, cmd]]), game.rules);
    }

    const after = predicted.state.players.get(localId);
    if (after !== undefined) {
      stats.lastPredictionError = Math.sqrt(
        (after.pos.x - beforeCorrection.x) ** 2 +
          (after.pos.y - beforeCorrection.y) ** 2 +
          (after.pos.z - beforeCorrection.z) ** 2,
      );
    }
    stats.unackedInputs = unacked.length;
  }

  function interpolatedSnapshot(nowMs: number): S | null {
    if (snapshots.length === 0) return null;
    const target = nowMs - INTERP_DELAY_MS;

    let older: TimedSnapshot<S> | null = null;
    let newer: TimedSnapshot<S> | null = null;
    for (const entry of snapshots) {
      if (entry.at <= target) older = entry;
      else {
        newer = entry;
        break;
      }
    }
    if (older === null) return (newer ?? (snapshots[0] as TimedSnapshot<S>)).snapshot;
    if (newer === null) return older.snapshot;

    const span = newer.at - older.at;
    const alpha = span > 0 ? (target - older.at) / span : 0;
    return game.blend(older.snapshot, newer.snapshot, alpha);
  }

  return {
    get ready() {
      return ready;
    },
    get localEntityId() {
      return localId;
    },
    get stats() {
      return { ...stats, unackedInputs: unacked.length };
    },
    get world() {
      return predicted;
    },

    tick(input) {
      if (!ready) return;
      unacked.push(input);

      // Predict immediately: this is what makes own-player movement feel local.
      tickPlayers(predicted, new Map([[localId, input]]), game.rules);

      // Resend recent commands so a single lost packet costs nothing.
      const batch = unacked.slice(-MAX_UNACKED_INPUTS);
      transport.sendState(encodeInput(batch));

      const now = clock();
      if (now - lastPingAt >= PING_INTERVAL_MS) {
        lastPingAt = now;
        transport.sendEvent(encodeWireEvent({ t: MessageType.Ping, stamp: Math.round(now) }));
      }
    },

    localPlayer() {
      return predicted.state.players.get(localId);
    },

    renderState(nowMs) {
      return game.view(predicted, localId, interpolatedSnapshot(nowMs), latest);
    },

    onSessionEnd(handler) {
      endHandler = handler;
    },
    onGameEvent(handler) {
      gameEventHandler = handler;
    },
    onNamed(handler) {
      namedHandler = handler;
      for (const named of namedSoFar) handler(named);
    },
    dispose() {
      transport.close();
    },
  };
}
