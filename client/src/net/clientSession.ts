import type { EnemyState, InputCommand, PlayerState, Vec3, WorldState } from "../sim/types.js";
import { AiState, Outcome, cloneVec3 } from "../sim/types.js";
import type { Level } from "../sim/level.js";
import {
  createForestWorld,
  createWorld,
  spawnPlayer,
  tickWorld,
  type World,
} from "../sim/world.js";
import type { Forest } from "../sim/forest.js";
import { INTERP_DELAY_MS, MAX_UNACKED_INPUTS } from "../sim/constants.js";
import { syncItemInteractables } from "../sim/register.js";
import type { Transport } from "./transport.js";
import {
  MessageType,
  PROTOCOL_VERSION,
  decodeEvent,
  decodeSnapshot,
  encodeEvent,
  encodeInput,
  messageTypeOf,
  type Snapshot,
} from "./protocol.js";

const SNAPSHOT_BUFFER_MS = 1500;
const PING_INTERVAL_MS = 1000;

export type NetStats = {
  rttMs: number;
  lastPredictionError: number;
  snapshotsReceived: number;
  unackedInputs: number;
  bytesReceived: number;
};

export type InteractedHandler = (e: { entityId: number; targetId: number }) => void;

export type ClientSession = {
  readonly ready: boolean;
  readonly localEntityId: number;
  readonly stats: NetStats;
  /**
   * The predicted world: the local player and, once app.ts registers them,
   * the same interactables the host has. Read to resolve what is in reach for
   * the prompt; the host still decides what an Interact does.
   */
  readonly world: World;
  tick(input: InputCommand): void;
  renderState(nowMs: number): WorldState;
  localPlayer(): PlayerState | undefined;
  onSessionEnd(handler: (reason: string) => void): void;
  onInteracted(handler: InteractedHandler): void;
  dispose(): void;
};

type TimedSnapshot = { at: number; snapshot: Snapshot };

export function createClientSession(
  level: Level,
  seed: number,
  transport: Transport,
  clock: () => number,
  opts: { expectedLevelId?: string; forest?: Forest | null; staleClientAdvice?: string } = {},
): ClientSession {
  const { expectedLevelId, forest = null, staleClientAdvice = "Reload the page to update." } = opts;

  // The predicted world holds ONLY the local player. Remote entities are
  // interpolated from snapshots instead: the client has no authority over
  // them and cannot predict them correctly. Non-authoritative, so it never
  // runs the spawn director, enemy AI, or respawn timers.
  const predicted: World =
    forest === null ? createWorld(level, seed, false) : createForestWorld(forest, false);
  let localId = 0;
  let ready = false;

  const unacked: InputCommand[] = [];
  const snapshots: TimedSnapshot[] = [];
  let latest: Snapshot | null = null;

  let lastPingAt = -Infinity;
  const stats: NetStats = {
    rttMs: 0,
    lastPredictionError: 0,
    snapshotsReceived: 0,
    unackedInputs: 0,
    bytesReceived: 0,
  };

  let endHandler: ((reason: string) => void) | null = null;
  let interactedHandler: InteractedHandler | null = null;

  transport.onEvent((data) => {
    try {
      const event = decodeEvent(data);
      switch (event.t) {
        case MessageType.Welcome: {
          // An older host's Welcome has the level length at byte 7, so it decodes
          // here as a "version" of 9 (sandbox01) or 38-50 (a forest id) and is
          // refused; an older client reads our version byte as its level length
          // and refuses on its own level check — both directions fail in words,
          // neither decodes garbage.
          if (event.protocolVersion !== PROTOCOL_VERSION) {
            endHandler?.(
              `Protocol mismatch: the host is running protocol ${event.protocolVersion}, this client has ` +
                `${PROTOCOL_VERSION}. ${staleClientAdvice}`,
            );
            return;
          }
          // Nothing about the world crosses the wire, so this string is the only
          // agreement check there is — and with a generated level the realistic
          // failure is not float divergence but version skew: one peer on a
          // bundle cached from before a deploy, simulating a different forest and
          // desyncing invisibly. Refusing loudly beats that.
          if (expectedLevelId !== undefined && event.levelId !== expectedLevelId) {
            // The advice is the caller's: on the web a reload fetches the
            // current bundle; in the desktop shell the bundle is the app, and
            // the way out is a new download.
            endHandler?.(
              `Level mismatch: the host is running ${event.levelId}, this client has ` +
                `${expectedLevelId}. ${staleClientAdvice}`,
            );
            return;
          }
          localId = event.entityId;
          const player = spawnPlayer(predicted);
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
            encodeEvent({ t: MessageType.Pong, stamp: event.stamp, hostTick: 0 }),
          );
          break;
        case MessageType.SessionEnded:
          endHandler?.(event.reason);
          break;
        case MessageType.Interacted:
          interactedHandler?.({ entityId: event.entityId, targetId: event.targetId });
          break;
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
      const snapshot = decodeSnapshot(data);

      // Unordered channel: an older snapshot can arrive after a newer one.
      // Applying it would move everything backwards.
      if (latest !== null && snapshot.tick <= latest.tick) return;

      latest = snapshot;
      stats.snapshotsReceived++;

      const now = clock();
      snapshots.push({ at: now, snapshot });
      while (snapshots.length > 0 && now - (snapshots[0] as TimedSnapshot).at > SNAPSHOT_BUFFER_MS) {
        snapshots.shift();
      }

      reconcile(snapshot);
    } catch {
      // Ignore malformed snapshots.
    }
  });

  function reconcile(snapshot: Snapshot): void {
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
    local.health = authoritative.health;
    local.grounded = authoritative.grounded;
    local.respawnTimer = authoritative.respawnTimer;
    // A fresh object, never a reference to the snapshot's: the client never
    // toggles its own lamp locally, so the host's value is the only truth,
    // but the predicted player must own its own object rather than alias
    // one that belongs to a decoded snapshot.
    local.lamp = { on: authoritative.lamp.on, charge: authoritative.lamp.charge };
    local.carrying = authoritative.carrying;
    local.signOutTicks = authoritative.signOutTicks;
    local.stare = authoritative.stare;
    local.lastProcessedInput = snapshot.lastProcessedInput;
    predicted.state.tick = snapshot.tick;
    predicted.state.items = snapshot.items.map((it) => ({ ...it, pos: cloneVec3(it.pos) }));
    predicted.state.outcome = snapshot.outcome;
    // The prompt resolves against the predicted world's interactables, so
    // they follow the host's items: a carried item is not there to reach
    // for, a dropped one is where it fell.
    syncItemInteractables(predicted);

    // ...drop everything the host has already applied...
    while (unacked.length > 0 && (unacked[0] as InputCommand).seq <= snapshot.lastProcessedInput) {
      unacked.shift();
    }

    // ...and replay the rest through the same movement code the host runs.
    // Identical code plus identical inputs means the correction is invisible.
    for (const cmd of unacked) {
      tickWorld(predicted, new Map([[localId, cmd]]));
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

  function interpolatedSnapshot(nowMs: number): Snapshot | null {
    if (snapshots.length === 0) return null;
    const target = nowMs - INTERP_DELAY_MS;

    let older: TimedSnapshot | null = null;
    let newer: TimedSnapshot | null = null;
    for (const entry of snapshots) {
      if (entry.at <= target) older = entry;
      else {
        newer = entry;
        break;
      }
    }
    if (older === null) return (newer ?? (snapshots[0] as TimedSnapshot)).snapshot;
    if (newer === null) return older.snapshot;

    const span = newer.at - older.at;
    const alpha = span > 0 ? (target - older.at) / span : 0;
    return blend(older.snapshot, newer.snapshot, alpha);
  }

  function blend(a: Snapshot, b: Snapshot, alpha: number): Snapshot {
    const lerp = (x: number, y: number) => x + (y - x) * alpha;
    const players = b.players.map((to) => {
      const from = a.players.find((p) => p.id === to.id);
      if (from === undefined) return to;
      return {
        ...to,
        pos: {
          x: lerp(from.pos.x, to.pos.x),
          y: lerp(from.pos.y, to.pos.y),
          z: lerp(from.pos.z, to.pos.z),
        },
        yaw: lerpAngle(from.yaw, to.yaw, alpha),
      };
    });
    const enemies = b.enemies.map((to) => {
      const from = a.enemies.find((e) => e.id === to.id);
      if (from === undefined) return to;
      return {
        ...to,
        pos: {
          x: lerp(from.pos.x, to.pos.x),
          y: lerp(from.pos.y, to.pos.y),
          z: lerp(from.pos.z, to.pos.z),
        },
        yaw: lerpAngle(from.yaw, to.yaw, alpha),
      };
    });
    // Items are not interpolated: the newer snapshot's are the truth.
    return { tick: b.tick, lastProcessedInput: b.lastProcessedInput, players, enemies, items: b.items, outcome: b.outcome };
  }

  /** Interpolates the short way around the circle, so 359 -> 1 does not spin. */
  function lerpAngle(from: number, to: number, alpha: number): number {
    const twoPi = Math.PI * 2;
    let delta = (to - from) % twoPi;
    if (delta > Math.PI) delta -= twoPi;
    if (delta < -Math.PI) delta += twoPi;
    return from + delta * alpha;
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
      tickWorld(predicted, new Map([[localId, input]]));

      // Resend recent commands so a single lost packet costs nothing.
      const batch = unacked.slice(-MAX_UNACKED_INPUTS);
      transport.sendState(encodeInput(batch));

      const now = clock();
      if (now - lastPingAt >= PING_INTERVAL_MS) {
        lastPingAt = now;
        transport.sendEvent(encodeEvent({ t: MessageType.Ping, stamp: Math.round(now) }));
      }
    },

    localPlayer() {
      return predicted.state.players.get(localId);
    },

    renderState(nowMs) {
      const players = new Map<number, PlayerState>();
      const enemies = new Map<number, EnemyState>();

      const view = interpolatedSnapshot(nowMs);
      if (view !== null) {
        for (const p of view.players) {
          if (p.id === localId) continue; // local player is predicted, not interpolated
          players.set(p.id, {
            id: p.id,
            pos: cloneVec3(p.pos),
            vel: cloneVec3(p.vel),
            yaw: p.yaw,
            pitch: p.pitch,
            health: p.health,
            grounded: p.grounded,
            lastProcessedInput: 0,
            respawnTimer: p.respawnTimer,
            lamp: { on: p.lamp.on, charge: p.lamp.charge },
            carrying: p.carrying,
            signOutTicks: p.signOutTicks,
            stare: p.stare,
            // Host-only and not in the snapshot. A client has no use for a remote
            // player's own sign-out flag or where they died: respawn placement
            // is decided host-side and arrives as a corrected position.
            signedOut: false,
            deathPos: null,
          });
        }
        for (const e of view.enemies) {
          enemies.set(e.id, {
            id: e.id,
            pos: cloneVec3(e.pos),
            vel: { x: 0, y: 0, z: 0 },
            yaw: e.yaw,
            health: e.health,
            ai: e.ai as AiState,
            targetId: 0,
            stateTimer: 0,
            attackCooldown: 0,
            // Host-only stuck detection, absent from the snapshot. A client has no
            // use for it: enemy positions arrive interpolated, not predicted.
            lastDistSq: Infinity,
            stuckTimer: 0,
            unstickTimer: 0,
            // Host-only Hollow walk state, also absent from the snapshot.
            route: [],
            routeAt: 0,
            stemDir: -1,
            approach: false,
            seen: false,
          });
        }
      }

      const local = predicted.state.players.get(localId);
      if (local !== undefined) players.set(localId, local);

      return {
        tick: predicted.state.tick,
        players,
        enemies,
        items: (latest?.items ?? []).map((it) => ({ ...it, pos: cloneVec3(it.pos) })),
        outcome: latest?.outcome ?? Outcome.Playing,
        nextEntityId: predicted.state.nextEntityId,
        rngSeed: predicted.state.rngSeed,
      };
    },

    onSessionEnd(handler) {
      endHandler = handler;
    },
    onInteracted(handler) {
      interactedHandler = handler;
    },
    dispose() {
      transport.close();
    },
  };
}
