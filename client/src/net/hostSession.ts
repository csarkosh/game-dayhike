import type { InputCommand, Vec3 } from "../sim/types.js";
import { Button } from "../sim/types.js";
import type { Level } from "../sim/level.js";
import type { World } from "../sim/world.js";
import {
  applyPlayerInput,
  createForestWorld,
  createWorld,
  isDead,
  removePlayer,
  spawnPlayer,
  tickWorld,
} from "../sim/world.js";
import { PositionHistory } from "../sim/history.js";
import type { Forest } from "../sim/forest.js";
import { pressedEdges, resolveInteract } from "../sim/interact.js";
import {
  INPUT_BUFFER_TARGET,
  MAX_INPUTS_PER_TICK,
  MAX_UNACKED_INPUTS,
  TICKS_PER_SNAPSHOT,
} from "../sim/constants.js";

const PING_INTERVAL_MS = 1000;

/** Hard cap on a peer's queued inputs. Bounds memory against a flooding peer. */
const MAX_PENDING_INPUTS = MAX_UNACKED_INPUTS * 2;
import type { Transport } from "./transport.js";
import {
  MessageType,
  PROTOCOL_VERSION,
  decodeEvent,
  decodeInput,
  encodeEvent,
  encodeSnapshot,
  messageTypeOf,
  type Snapshot,
} from "./protocol.js";

type PeerRecord = {
  peerId: string;
  entityId: number;
  transport: Transport;
  pending: InputCommand[];
  lastProcessedSeq: number;
  rttMs: number;
  lastPingAt: number;
  removed: boolean;
  /** The buttons this peer's last-applied command carried; edges are measured against it. */
  lastButtons: number;
};

const HALF_PI = Math.PI / 2;

/**
 * Everything crossing the wire is untrusted, including from friends: a bug or
 * a corrupted packet is as damaging as malice here. A non-finite yaw reaches
 * Math.sin and turns the player's position into NaN permanently, which then
 * poisons every snapshot that player appears in.
 */
function sanitizeInput(cmd: InputCommand): InputCommand | null {
  if (!Number.isFinite(cmd.yaw) || !Number.isFinite(cmd.pitch)) return null;
  if (!Number.isFinite(cmd.moveX) || !Number.isFinite(cmd.moveZ)) return null;
  const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
  return {
    seq: cmd.seq >>> 0,
    moveX: clamp(cmd.moveX, -1, 1),
    moveZ: clamp(cmd.moveZ, -1, 1),
    // Wrapped rather than clamped: yaw is legitimately unbounded as the player
    // spins, but must not be allowed to grow without limit.
    yaw: cmd.yaw % (Math.PI * 2),
    pitch: clamp(cmd.pitch, -HALF_PI, HALF_PI),
    buttons: cmd.buttons & 0xff,
  };
}

export type InteractedHandler = (e: { entityId: number; targetId: number }) => void;

export type HostSession = {
  world: World;
  localEntityId: number;
  readonly peerCount: number;
  addPeer(peerId: string, transport: Transport): number;
  removePeer(peerId: string): void;
  tick(localInput: InputCommand): void;
  onInteracted(handler: InteractedHandler): void;
  dispose(): void;
};

/**
 * `clock` must be monotonic and small enough to survive the protocol's uint32
 * ping stamp — `performance.now()` is both, `Date.now()` is neither. A
 * truncated stamp makes every measured RTT astronomically large, poisoning
 * every peer's rttMs.
 */
export function createHostSession(
  level: Level,
  seed: number,
  clock: () => number = () => performance.now(),
  opts: { forest?: Forest | null } = {},
): HostSession {
  const { forest = null } = opts;
  // A forest world's `level.id` is the versioned generator identity, which is
  // what the Welcome event below sends and the client validates. No geometry
  // crosses the wire either way, so the codec is untouched.
  const world = forest === null ? createWorld(level, seed) : createForestWorld(forest);
  const localPlayer = spawnPlayer(world);
  const peers = new Map<string, PeerRecord>();
  const history = new PositionHistory();
  let localLastButtons = 0;
  let interactedHandler: InteractedHandler | null = null;

  function peerForEntity(entityId: number): PeerRecord | undefined {
    for (const peer of peers.values()) {
      if (peer.entityId === entityId) return peer;
    }
    return undefined;
  }

  function handleState(peer: PeerRecord, data: ArrayBuffer): void {
    // A transport can deliver messages that were already in flight when the
    // peer was removed. Without this the record stays reachable from the
    // handler closure and its queue grows forever.
    if (peer.removed) return;
    try {
      if (messageTypeOf(data) !== MessageType.Input) return;
      for (const raw of decodeInput(data)) {
        // Redundant resends are expected: every packet repeats recent
        // commands so a single loss costs nothing. Drop anything already
        // applied or already queued.
        if (raw.seq <= peer.lastProcessedSeq) continue;
        if (peer.pending.some((p) => p.seq === raw.seq)) continue;
        const cmd = sanitizeInput(raw);
        if (cmd === null) continue;
        peer.pending.push(cmd);
      }
      peer.pending.sort((a, b) => a.seq - b.seq);
      // Nothing rate-limits how fast a peer sends. Anything beyond this window
      // is stale by the time we would reach it, and reconciliation already
      // handles a skipped range via lastProcessedInput.
      if (peer.pending.length > MAX_PENDING_INPUTS) {
        peer.pending.splice(0, peer.pending.length - MAX_PENDING_INPUTS);
      }
    } catch {
      // A malformed packet must never take down the host.
    }
  }

  function buildSnapshot(forPeer: PeerRecord | null): Snapshot {
    return {
      tick: world.state.tick,
      lastProcessedInput: forPeer?.lastProcessedSeq ?? 0,
      players: [...world.state.players.values()].map((p) => ({
        id: p.id,
        pos: p.pos,
        vel: p.vel,
        yaw: p.yaw,
        pitch: p.pitch,
        health: p.health,
        grounded: p.grounded,
        respawnTimer: p.respawnTimer,
        lamp: { on: p.lamp.on, charge: p.lamp.charge },
      })),
      enemies: [...world.state.enemies.values()].map((e) => ({
        id: e.id,
        pos: e.pos,
        yaw: e.yaw,
        health: e.health,
        ai: e.ai,
      })),
    };
  }

  return {
    world,
    localEntityId: localPlayer.id,

    get peerCount() {
      return peers.size;
    },

    addPeer(peerId, transport) {
      const player = spawnPlayer(world);
      const record: PeerRecord = {
        peerId,
        entityId: player.id,
        transport,
        pending: [],
        lastProcessedSeq: 0,
        rttMs: 0,
        // Not 0: with a monotonic clock that starts near zero, 0 would suppress
        // the first ping for a whole second.
        lastPingAt: -Infinity,
        removed: false,
        lastButtons: 0,
      };
      peers.set(peerId, record);
      transport.onState((data) => handleState(record, data));

      transport.onEvent((data) => {
        try {
          const event = decodeEvent(data);
          if (event.t === MessageType.Ping) {
            transport.sendEvent(
              encodeEvent({ t: MessageType.Pong, stamp: event.stamp, hostTick: world.state.tick }),
            );
          } else if (event.t === MessageType.Pong) {
            // Reply to our own ping. This is the only RTT measurement the
            // host has for this peer.
            record.rttMs = Math.max(0, clock() - event.stamp);
          }
        } catch {
          // ignore malformed events
        }
      });

      transport.sendEvent(
        encodeEvent({
          t: MessageType.Welcome,
          entityId: player.id,
          tick: world.state.tick,
          protocolVersion: PROTOCOL_VERSION,
          // `world.level`, not the `level` parameter. For a generated world those
          // differ: the parameter is the sandbox fallback that app.ts still passes,
          // while `world.level.id` is the versioned generator identity the client
          // validates against. Sending the parameter advertised "sandbox01" from a
          // host that was correctly simulating a forest, and every client was
          // refused.
          levelId: world.level.id,
        }),
      );
      for (const other of peers.values()) {
        if (other.peerId === peerId) continue;
        other.transport.sendEvent(
          encodeEvent({ t: MessageType.PlayerJoined, entityId: player.id }),
        );
      }
      return player.id;
    },

    removePeer(peerId) {
      const record = peers.get(peerId);
      if (record === undefined) return;
      peers.delete(peerId);
      // Close the transport and flag the record: its handler closures outlive
      // this call, and a still-open channel would keep filling a queue that
      // nothing drains.
      record.removed = true;
      record.pending.length = 0;
      record.transport.close();
      removePlayer(world, record.entityId);
      for (const other of peers.values()) {
        other.transport.sendEvent(
          encodeEvent({ t: MessageType.PlayerLeft, entityId: record.entityId }),
        );
      }
    },

    tick(localInput) {
      const inputs = new Map<number, InputCommand>();
      inputs.set(localPlayer.id, localInput);

      // A press acts on the tick its bit turns on, once, never while held —
      // including across every catch-up command taken this tick, which is
      // why this ORs edges per player rather than only looking at the last
      // command applied.
      const edges = new Map<number, number>();
      const noteEdges = (id: number, prev: number, cmd: InputCommand): number => {
        const e = pressedEdges(prev, cmd.buttons);
        if (e !== 0) edges.set(id, (edges.get(id) ?? 0) | e);
        return cmd.buttons;
      };
      localLastButtons = noteEdges(localPlayer.id, localLastButtons, localInput);

      for (const peer of peers.values()) {
        // One command per tick is the steady state. When a peer has built a
        // backlog, take an extra: the client also produces one per tick, so a
        // strict 1:1 diet means a backlog never drains and every input stays
        // permanently late.
        const budget = peer.pending.length > INPUT_BUFFER_TARGET ? MAX_INPUTS_PER_TICK : 1;
        const take = Math.min(budget, peer.pending.length);
        if (take === 0) continue;

        // Catch-up commands are applied as extra movement steps for this
        // player alone, so the rest of the world still advances exactly once.
        for (let i = 0; i < take - 1; i++) {
          const cmd = peer.pending.shift() as InputCommand;
          applyPlayerInput(world, peer.entityId, cmd);
          peer.lastProcessedSeq = cmd.seq;
          peer.lastButtons = noteEdges(peer.entityId, peer.lastButtons, cmd);
        }
        const last = peer.pending.shift() as InputCommand;
        inputs.set(peer.entityId, last);
        peer.lastProcessedSeq = last.seq;
        peer.lastButtons = noteEdges(peer.entityId, peer.lastButtons, last);
      }

      tickWorld(world, inputs);

      // Recorded after the tick so the frame is labelled with the tick whose
      // motion it reflects.
      const positions = new Map<number, Vec3>();
      for (const enemy of world.state.enemies.values()) positions.set(enemy.id, enemy.pos);
      history.recordPositions(world.state.tick, positions);

      // The dead check comes first: a player who died this tick, or a peer
      // whose command predates their death, still acts on nothing.
      for (const [id, bits] of edges) {
        const player = world.state.players.get(id);
        if (player === undefined || isDead(player)) continue;
        if ((bits & Button.Interact) !== 0) {
          const target = resolveInteract(world, player);
          if (target !== null) {
            target.onInteract(id);
            const peer = peerForEntity(id);
            const event = { t: MessageType.Interacted as const, entityId: id, targetId: target.id };
            if (peer === undefined) interactedHandler?.(event);
            else peer.transport.sendEvent(encodeEvent(event));
          }
        }
        if ((bits & Button.Lamp) !== 0) player.lamp.on = !player.lamp.on;
      }

      const now = clock();
      for (const peer of peers.values()) {
        if (now - peer.lastPingAt >= PING_INTERVAL_MS) {
          peer.lastPingAt = now;
          peer.transport.sendEvent(encodeEvent({ t: MessageType.Ping, stamp: Math.round(now) }));
        }
      }

      if (world.state.tick % TICKS_PER_SNAPSHOT === 0) {
        for (const peer of peers.values()) {
          peer.transport.sendState(encodeSnapshot(buildSnapshot(peer)));
        }
      }
    },

    onInteracted(handler) {
      interactedHandler = handler;
    },

    dispose() {
      for (const peer of peers.values()) peer.transport.close();
      peers.clear();
    },
  };
}
