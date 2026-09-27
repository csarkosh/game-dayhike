import type { Interactable } from "./interact.js";
import type { EnemyState, InputCommand, PlayerState, Vec3, WorldState } from "./types.js";
import { Outcome, Phase, cloneVec3 } from "./types.js";
import type { Level } from "./level.js";
import type { BoxProvider } from "./boxSource.js";
import type { Forest } from "./forest.js";
import type { TrailGraph } from "./trail.js";
import type { CutRecord } from "./cut.js";
import { createWatcherRecord, stepWatcher, type WatcherRecord } from "./watcher.js";
import { spiralSpawn } from "./spawn.js";
import { collisionBoxes } from "./level.js";
import { activeTerrainVariant, elevationAt } from "./terrain.js";
import { buildRegister, installRegister, type Register } from "./register.js";
import { CAR_MATERIAL, KIOSK_MATERIAL, propSite, roadProp } from "./passes/trailhead.js";
import { containAtRoad } from "./containment.js";
import { createGroundField, type GroundField } from "./ground.js";
import { stepMovement, type MoveState } from "./movement.js";
import { isExpiredCorpse, stepEnemy } from "./ai.js";
import { updateDirector } from "./director.js";
import { stepHollows, updateHollows, updateLoss } from "./hollow.js";
import { stepSummit, updateSafety } from "./summit.js";
import { ENEMY_POPULATION_CAP, PLAYER_HALF, PLAYER_MAX_HEALTH, TICK_DT } from "./constants.js";

export type World = {
  state: WorldState;
  level: Level;
  /**
   * Prop collision: trunks and anything else genuinely box-shaped, or a
   * hand-authored level's whole box list. The generated ground is NOT in here —
   * see `ground` below.
   */
  boxes: BoxProvider;
  /**
   * The generated ground surface, or null for hand-authored levels, whose
   * floors are ordinary brushes. Continuous and analytic, and the same field
   * the renderer draws, so the player stands exactly where they can see they
   * stand (`ground.ts`).
   */
  ground: GroundField | null;
  /** Set for generated worlds, null for hand-authored levels like sandbox01. */
  forest: Forest | null;
  /**
   * Whether this world owns the entities no one predicts: enemies, the spawn
   * director, and deaths. The host's world does. A client's predicted
   * world does not — it holds only the local player and takes everything else
   * from snapshots, so running the director there invents a second population
   * of enemies that exist nowhere else, chase the local player, and chew its
   * predicted health between snapshots.
   */
  authoritative: boolean;
  /**
   * Ceiling on the director's target population — generated worlds set 0 while
   * enemy behaviour is broken by construction on montane ground; restoring them
   * is this one number.
   */
  maxEnemies: number;
  /**
   * Sea level for wading, from the active variant's registry entry; null for
   * hand-authored levels and variants without water. Rooms
   * below y = 0 in authored maps are unaffected because this stays null there.
   */
  waterLevel: number | null;
  /**
   * What a player can act on: registered identically on the host and on a
   * client's predicted world, both from the same seed (`app.ts`'s
   * `registerInteractables`), so nothing crosses the wire. `interact.ts`
   * resolves against this map on both sides, but only the host's resolution
   * has effect; a client resolves the same map only to drive its own prompt.
   */
  interactables: Map<number, Interactable>;
  /**
   * The poster, the box and the car for a forest world (`register.ts`); null
   * for a hand-authored level, which has no trail to lose anybody on.
   */
  register: Register | null;
  /**
   * The trail network for a forest world (`trail.ts`): the Hollow's map and
   * what `app.ts` paints signs from. Null for a hand-authored level.
   */
  trail: TrailGraph | null;
  /**
   * The cut (`cut.ts`): the guide route and the forks cut so far, host only.
   * Null until the discovery tick draws the guide, and null forever on a
   * client's predicted world. It lives here and not on `WorldState` because
   * `WorldState` is what `cloneWorldState` copies, `serializeWorldState`
   * fingerprints and the snapshot carries to every peer — and the record is
   * the host's alone, like `register` and `trail` beside it.
   */
  cut: CutRecord | null;
  /**
   * The watcher (`watcher.ts`): whether the climb's Hollow is shown, the rest
   * until it shows again and its own random stream, host only. Set for an
   * authoritative forest world that built a trail; null for a hand-authored
   * level, and null forever on a client's predicted world, as `cut` is. It
   * lives here and not on `WorldState` for the same reason `cut` does: the
   * record is the host's alone, and `WorldState` is what is cloned,
   * fingerprinted and sent. The watcher entity itself is an enemy like any
   * other and reaches every peer through the snapshot.
   */
  watcher: WatcherRecord | null;
};

export function createWorld(level: Level, seed: number, authoritative = true): World {
  return {
    level,
    boxes: collisionBoxes(level),
    ground: null,
    forest: null,
    authoritative,
    maxEnemies: ENEMY_POPULATION_CAP,
    waterLevel: null,
    interactables: new Map(),
    register: null,
    trail: null,
    cut: null,
    watcher: null,
    state: {
      tick: 0,
      players: new Map(),
      enemies: new Map(),
      outcome: Outcome.Playing,
      phase: Phase.Climb,
      nextEntityId: 1,
      rngSeed: seed | 0,
    },
  };
}

/**
 * A world whose geometry is generated rather than authored.
 *
 * The `level` it carries is a stub with no brushes: `hostSession` sends
 * `level.id` in Welcome, which is how the generator version and seed reach the
 * client, and `renderer.ts` iterates `level.brushes`, which is correctly empty.
 */
export function createForestWorld(forest: Forest, authoritative = true): World {
  const variant = activeTerrainVariant();
  const graph = variant.trailGraph?.(forest.seed);
  const world: World = {
    level: { id: forest.levelId, brushes: [], playerSpawns: [], enemySpawns: [] },
    boxes: forest.grid,
    ground: createGroundField(forest.seed),
    forest,
    authoritative,
    maxEnemies: 0,
    waterLevel: variant.waterLevel ?? null,
    interactables: new Map(),
    register: null,
    trail: graph ?? null,
    cut: null,
    watcher: graph === undefined || !authoritative ? null : createWatcherRecord(forest.seed),
    state: {
      tick: 0,
      players: new Map(),
      enemies: new Map(),
      outcome: Outcome.Playing,
      phase: Phase.Climb,
      nextEntityId: 1,
      rngSeed: forest.seed | 0,
    },
  };
  // The kiosk and the car stand where the trailhead pass put them, and the
  // poster comes from the same seed on every peer.
  const roadCenterX = variant.roadCenterX;
  if (graph !== undefined && roadCenterX !== undefined) {
    const kiosk = propSite(graph, roadCenterX, forest.seed, roadProp(KIOSK_MATERIAL));
    const car = propSite(graph, roadCenterX, forest.seed, roadProp(CAR_MATERIAL));
    installRegister(
      world,
      buildRegister({
        seed: forest.seed,
        graph,
        groundH: (x, z) => elevationAt(forest.seed, x, z),
        kiosk,
        car,
      }),
    );
  }
  return world;
}

/**
 * Where a joining player starts.
 *
 * Hand-authored levels cycle their spawn list by player count so a full lobby
 * never stacks. A forest has no list, so every peer walks the same deterministic
 * spiral out from the origin and arrives at the same answer without exchanging
 * anything.
 */
function pickSpawn(world: World): Vec3 {
  if (world.forest !== null) {
    const seed = world.forest.seed;
    const th = activeTerrainVariant().trailGraph?.(seed).trailhead;
    return spiralSpawn(world.boxes, seed, PLAYER_HALF, th === undefined ? { x: 0.5, z: 0.5 } : { x: th.x, z: th.z });
  }
  const spawns = world.level.playerSpawns;
  return spawns[world.state.players.size % spawns.length] as Vec3;
}

export function spawnPlayer(world: World): PlayerState {
  const id = world.state.nextEntityId++;
  const spawn = pickSpawn(world);
  const player: PlayerState = {
    id,
    pos: cloneVec3(spawn),
    vel: { x: 0, y: 0, z: 0 },
    yaw: 0,
    pitch: 0,
    health: PLAYER_MAX_HEALTH,
    grounded: false,
    lastProcessedInput: 0,
    lamp: { on: false, charge: 1 },
    stare: 0,
    safe: false,
    deathPos: null,
  };
  world.state.players.set(id, player);
  return player;
}

export function removePlayer(world: World, id: number): void {
  world.state.players.delete(id);
}

export function tickWorld(world: World, inputs: Map<number, InputCommand>): void {
  world.state.tick++;

  for (const player of world.state.players.values()) {
    const cmd = inputs.get(player.id);

    if (isDead(player)) {
      // Dead players do not move. This runs on both sides, unlike marking the
      // death itself, so a client predicting its own corpse agrees with the
      // host about where it is lying. Yaw and pitch still track the mouse:
      // freezing the camera reads as a hang, and view angles carry no
      // authority anyway.
      player.vel = { x: 0, y: 0, z: 0 };
      if (cmd !== undefined) {
        player.yaw = cmd.yaw;
        player.pitch = cmd.pitch;
        player.lastProcessedInput = cmd.seq;
      }
      continue;
    }

    if (cmd === undefined) {
      // No input this tick: still integrate gravity so the player does not
      // hang in mid-air while their packets are late.
      applyMove(world, player, {
        seq: player.lastProcessedInput,
        moveX: 0,
        moveZ: 0,
        yaw: player.yaw,
        pitch: player.pitch,
        buttons: 0,
      });
      continue;
    }
    player.yaw = cmd.yaw;
    player.pitch = cmd.pitch;
    applyMove(world, player, cmd);
    player.lastProcessedInput = cmd.seq;
  }

  if (!world.authoritative) return;

  // Safety first, from the positions this tick just settled: the Hollows read
  // it as they move and as they pick their prey, so a player who crossed onto
  // the corridor this tick is out of reach on the same tick (summit.ts).
  updateSafety(world);

  if (world.trail !== null) {
    // The climb's watcher shows and hides before the Hollows move, so the
    // one it spawns is turned to the lead this same tick and the one it
    // hides is gone before the look pass (watcher.ts). Only while the match
    // is still on the climb: the flip removes it and the chase never shows it.
    if (world.watcher !== null && world.state.phase === Phase.Climb && world.state.outcome === Outcome.Playing) {
      stepWatcher(world, TICK_DT);
    }
    // A forest runs the Hollows it has — the watcher alone until the body is
    // found — and never the director: nothing spawns on a mountain but what
    // walked out of the woods (hollow.ts).
    stepHollows(world, TICK_DT);
    updateHollows(world);
  } else {
    for (const enemy of world.state.enemies.values()) stepEnemy(enemy, world, TICK_DT);
    for (const [id, enemy] of world.state.enemies) if (isExpiredCorpse(enemy)) world.state.enemies.delete(id);
    updateDirector(world);
  }
  updateDeaths(world);
  updateLoss(world);
  // The find and the end last: both are judged on everything the tick has
  // settled, the deaths above included (summit.ts).
  stepSummit(world);
}

export function isDead(player: PlayerState): boolean {
  return player.health <= 0;
}

/**
 * Host-only, and deliberately so: a client that predicted its own death and
 * had it revoked by the next snapshot would be far worse than a 100 ms delay
 * before the screen changes, so this never runs during reconciliation replay.
 *
 * Death is permanent. On the tick a player's health first reads 0 the spot
 * is recorded; `deathPos` staying set is what stops this running twice, and
 * nothing anywhere restores health.
 */
function updateDeaths(world: World): void {
  for (const player of world.state.players.values()) {
    if (player.health > 0 || player.deathPos !== null) continue;
    player.vel = { x: 0, y: 0, z: 0 };
    player.deathPos = cloneVec3(player.pos);
  }
}

/**
 * Applies one input as a movement step for a single player, outside the normal
 * world tick. The host uses this to drain a backlog without advancing everyone
 * else. Safe because movement is a pure chain: the same commands applied in the
 * same order from the same state land in the same place, no matter how they are
 * grouped into ticks — which is exactly what lets the client replay them
 * one-per-tick and still agree.
 */
export function applyPlayerInput(world: World, playerId: number, cmd: InputCommand): void {
  const player = world.state.players.get(playerId);
  if (player === undefined) return;
  player.yaw = cmd.yaw;
  player.pitch = cmd.pitch;
  if (!isDead(player)) applyMove(world, player, cmd);
  player.lastProcessedInput = cmd.seq;
}

function applyMove(world: World, player: PlayerState, cmd: InputCommand): void {
  const before: MoveState = { pos: player.pos, vel: player.vel, grounded: player.grounded };
  const after = stepMovement(
    before,
    cmd,
    TICK_DT,
    world.boxes,
    PLAYER_HALF,
    world.waterLevel,
    world.ground,
  );
  // The wall at the road (containment.ts): a forest world with a road keeps
  // every hull off the pavement. After the step, on the settled position, so
  // the box sweep and the ground have already had their say.
  if (world.forest !== null) {
    const roadCenterX = activeTerrainVariant().roadCenterX;
    if (roadCenterX !== undefined) {
      containAtRoad(after.pos, after.vel, roadCenterX(world.forest.seed, after.pos.z));
    }
  }
  player.pos = after.pos;
  player.vel = after.vel;
  player.grounded = after.grounded;
}

export function cloneWorldState(state: WorldState): WorldState {
  const players = new Map<number, PlayerState>();
  for (const [id, p] of state.players) {
    players.set(id, {
      ...p,
      pos: cloneVec3(p.pos),
      vel: cloneVec3(p.vel),
      lamp: { ...p.lamp },
      deathPos: p.deathPos === null ? null : cloneVec3(p.deathPos),
    });
  }
  const enemies = new Map<number, EnemyState>();
  for (const [id, e] of state.enemies) {
    enemies.set(id, {
      ...e,
      pos: cloneVec3(e.pos),
      vel: cloneVec3(e.vel),
      route: [...e.route],
      emergeTo: e.emergeTo === null ? null : cloneVec3(e.emergeTo),
    });
  }
  return {
    tick: state.tick,
    players,
    enemies,
    outcome: state.outcome,
    phase: state.phase,
    nextEntityId: state.nextEntityId,
    rngSeed: state.rngSeed,
  };
}

/**
 * Canonical text fingerprint of world state. Used by the determinism tests.
 * Deliberately not a hash: when it differs you can diff the two strings and
 * see exactly which entity and which field drifted.
 */
export function serializeWorldState(state: WorldState): string {
  const parts: string[] = [`t:${state.tick}`, `n:${state.nextEntityId}`, `r:${state.rngSeed}`, `o:${state.outcome}`, `ph:${state.phase}`];

  for (const [id, p] of [...state.players.entries()].sort((a, b) => a[0] - b[0])) {
    parts.push(
      `P${id}:${p.pos.x},${p.pos.y},${p.pos.z},${p.vel.x},${p.vel.y},${p.vel.z},` +
        `${p.yaw},${p.pitch},${p.health},${p.grounded ? 1 : 0},${p.lastProcessedInput}` +
        `,${p.lamp.on ? 1 : 0},${Math.round(p.lamp.charge * 127)},${p.safe ? 1 : 0},${p.stare}`,
    );
  }
  for (const [id, e] of [...state.enemies.entries()].sort((a, b) => a[0] - b[0])) {
    parts.push(
      `E${id}:${e.pos.x},${e.pos.y},${e.pos.z},${e.vel.x},${e.vel.y},${e.vel.z},` +
        `${e.yaw},${e.health},${e.ai},${e.targetId},${e.stateTimer}`,
    );
  }
  return parts.join("|");
}
