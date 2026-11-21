/**
 * Day Hike, as the network's sessions see it (`@csarkosh/engine/net/game`): what a snapshot of a
 * hike holds, what the interact and lamp buttons do on the host, how the host's word corrects
 * the hiker a client predicts, and the state a frame is drawn from.
 */
import { cloneVec3 } from "@csarkosh/engine/sim/core";
import { blendPosition, lerpAngle } from "@csarkosh/engine/net/client";
import type { NetGame } from "@csarkosh/engine/net/game";
import { resolveInteract } from "../sim/interact.js";
import { AiState, Button, Outcome, Phase, type EnemyState, type PlayerState, type WorldState } from "../sim/types.js";
import { RULES, type World } from "../sim/world.js";
import {
  GameMessage, PROTOCOL_VERSION, decodeGameEvent, decodeSnapshot, encodeEvent, encodeSnapshot, type Interacted, type Snapshot,
} from "./protocol.js";

export const DAYHIKE: NetGame<World, PlayerState, Snapshot, WorldState, Interacted> = {
  protocolVersion: PROTOCOL_VERSION,
  rules: RULES,
  encodeSnapshot,
  decodeSnapshot,
  encodeEvent,
  decodeEvent: decodeGameEvent,

  snapshot(world, lastProcessedInput) {
    return {
      tick: world.state.tick,
      lastProcessedInput,
      players: [...world.state.players.values()].map((p) => ({
        id: p.id,
        pos: p.pos,
        vel: p.vel,
        yaw: p.yaw,
        pitch: p.pitch,
        health: p.health,
        grounded: p.grounded,
        lamp: { on: p.lamp.on, charge: p.lamp.charge },
        safe: p.safe,
        cause: p.cause,
        stare: p.stare,
      })),
      enemies: [...world.state.enemies.values()].map((e) => ({
        id: e.id,
        pos: e.pos,
        yaw: e.yaw,
        health: e.health,
        ai: e.ai,
      })),
      outcome: world.state.outcome,
      phase: world.state.phase,
    };
  },

  tracked: (world) => world.state.enemies.values(),

  pressed(world, player, bits) {
    let said: Interacted | null = null;
    if ((bits & Button.Interact) !== 0) {
      const target = resolveInteract(world, player);
      if (target !== null) {
        target.onInteract(player.id);
        said = { t: GameMessage.Interacted, entityId: player.id, targetId: target.id };
      }
    }
    if ((bits & Button.Lamp) !== 0) player.lamp.on = !player.lamp.on;
    return said;
  },

  correct(world, local, truth, snapshot) {
    local.health = truth.health;
    // A fresh object, never a reference to the snapshot's: the client never
    // toggles its own lamp locally, so the host's value is the only truth,
    // but the predicted player must own its own object rather than alias
    // one that belongs to a decoded snapshot.
    local.lamp = { on: truth.lamp.on, charge: truth.lamp.charge };
    local.safe = truth.safe;
    local.cause = truth.cause;
    local.stare = truth.stare;
    world.state.outcome = snapshot.outcome;
    world.state.phase = snapshot.phase;
  },

  blend(a, b, alpha) {
    const players = b.players.map((to) => {
      const from = a.players.find((p) => p.id === to.id);
      if (from === undefined) return to;
      return { ...to, pos: blendPosition(from.pos, to.pos, alpha), yaw: lerpAngle(from.yaw, to.yaw, alpha) };
    });
    const enemies = b.enemies.map((to) => {
      const from = a.enemies.find((e) => e.id === to.id);
      if (from === undefined) return to;
      return { ...to, pos: blendPosition(from.pos, to.pos, alpha), yaw: lerpAngle(from.yaw, to.yaw, alpha) };
    });
    return { tick: b.tick, lastProcessedInput: b.lastProcessedInput, players, enemies, outcome: b.outcome, phase: b.phase };
  },

  view(world, localId, view, latest) {
    const players = new Map<number, PlayerState>();
    const enemies = new Map<number, EnemyState>();

    if (view !== null) {
      for (const p of view.players) {
        if (p.id === localId) continue; // local player is predicted, not interpolated
        // Only the continuous fields come from the interpolated pair, which
        // sits INTERP_DELAY_MS behind. The discrete, host-truth fields are
        // read from the newest snapshot — the one `outcome` and `phase`
        // below are read from — because an outcome and the state that
        // decided it must come from the same snapshot: the match ends on
        // the tick the last player reaches the road, so on the first frame
        // that reads Won the pair still has that player unsafe, and an end
        // screen built from it contradicts the host. A player in the pair
        // but not in the newest snapshot keeps the pair's values.
        const truth = latest?.players.find((q) => q.id === p.id) ?? p;
        players.set(p.id, {
          id: p.id,
          pos: cloneVec3(p.pos),
          vel: cloneVec3(p.vel),
          yaw: p.yaw,
          pitch: p.pitch,
          health: truth.health,
          grounded: p.grounded,
          lastProcessedInput: 0,
          lamp: { on: truth.lamp.on, charge: truth.lamp.charge },
          safe: truth.safe,
          cause: truth.cause,
          stare: truth.stare,
          // Host-only and not in the snapshot. A client has no use for where a
          // remote player died: death is host truth and arrives as health 0.
          deathPos: null, killedBy: 0, returnIn: 0, heldFor: 0, out: false,
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
          approach: false,
          seen: false,
          emergeTo: null, stalks: false, waylay: 0,
        });
      }
    }

    const local = world.state.players.get(localId);
    if (local !== undefined) players.set(localId, local);

    return {
      tick: world.state.tick,
      players,
      enemies,
      outcome: latest?.outcome ?? Outcome.Playing,
      phase: latest?.phase ?? Phase.Climb,
      nextEntityId: world.state.nextEntityId,
      rngSeed: world.state.rngSeed,
    };
  },
};
