import type { EnemyState, Vec3 } from "./types.js";
import { AiState, cloneVec3, distanceSquared, nextRandom } from "./types.js";
import type { World } from "./world.js";
import { groundSpawn, ringSample } from "./spawn.js";
import {
  ENEMY_HALF,
  ENEMY_MAX_HEALTH,
  ENEMY_MIN_SPAWN_DISTANCE,
} from "./constants.js";

/**
 * Outer radius of the spawn ring. ENEMY_MIN_SPAWN_DISTANCE is 25 and
 * ENEMY_DETECT_RANGE is 30, so enemies appear just outside their own detection
 * radius and walk in rather than materializing in view.
 */
const SPAWN_RING_OUTER = 35;

const SPAWN_ATTEMPTS = 4;

/**
 * The rifle is gone and nothing can answer an enemy, so the population is
 * zero until this director is replaced by the Hollow — one entity that walks
 * toward progress. The population constants stay declared in `constants.ts`
 * for that replacement; `spawnEnemy` stays for the AI tests.
 */
export function targetPopulation(playerCount: number): number {
  void playerCount;
  return 0;
}

export function spawnEnemy(world: World, at: Vec3): EnemyState {
  const enemy: EnemyState = {
    id: world.state.nextEntityId++,
    pos: cloneVec3(at),
    vel: { x: 0, y: 0, z: 0 },
    yaw: 0,
    health: ENEMY_MAX_HEALTH,
    ai: AiState.Idle,
    targetId: 0,
    stateTimer: 0,
    attackCooldown: 0,
    lastDistSq: Infinity,
    stuckTimer: 0,
    unstickTimer: 0,
  };
  world.state.enemies.set(enemy.id, enemy);
  return enemy;
}

function farEnoughFromPlayers(world: World, point: Vec3): boolean {
  const minSq = ENEMY_MIN_SPAWN_DISTANCE * ENEMY_MIN_SPAWN_DISTANCE;
  for (const player of world.state.players.values()) {
    if (distanceSquared(player.pos, point) < minSq) return false;
  }
  return true;
}

export function updateDirector(world: World): void {
  const playerCount = world.state.players.size;
  if (playerCount === 0) return;

  let alive = 0;
  for (const enemy of world.state.enemies.values()) {
    if (enemy.ai !== AiState.Dead) alive++;
  }

  const target = Math.min(targetPopulation(playerCount), world.maxEnemies);
  if (alive >= target) return;

  // A few attempts per tick, not a loop until success: a player standing in
  // the middle of every spawn point must not hang the simulation.
  if (world.forest !== null) {
    const players = [...world.state.players.values()];
    for (let attempt = 0; attempt < SPAWN_ATTEMPTS; attempt++) {
      const index = Math.floor(nextRandom(world.state) * players.length) % players.length;
      const anchor = players[index];
      if (anchor === undefined) return;

      const candidate = ringSample(
        world.state,
        anchor.pos,
        ENEMY_MIN_SPAWN_DISTANCE,
        SPAWN_RING_OUTER,
      );
      if (candidate === null) continue;

      const placed = groundSpawn(
        world.boxes,
        world.forest.seed,
        candidate.x,
        candidate.z,
        ENEMY_HALF,
      );
      if (placed === null) continue;
      // The ring is measured from one player; this rejects points that are close
      // to a different one.
      if (!farEnoughFromPlayers(world, placed)) continue;

      spawnEnemy(world, placed);
      return;
    }
    return;
  }

  const spawns = world.level.enemySpawns;
  if (spawns.length === 0) return;

  for (let attempt = 0; attempt < SPAWN_ATTEMPTS; attempt++) {
    const index = Math.floor(nextRandom(world.state) * spawns.length) % spawns.length;
    const point = spawns[index] as Vec3;
    if (farEnoughFromPlayers(world, point)) {
      spawnEnemy(world, point);
      return;
    }
  }
}
