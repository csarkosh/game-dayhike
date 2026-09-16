import type { EnemyState, Vec3 } from "./types.js";
import { AiState, distanceSquared, nextRandom } from "./types.js";
import type { BoxProvider } from "./boxSource.js";
import { raycastScene } from "./collision.js";
import type { GroundField } from "./ground.js";
import { stepMovement } from "./movement.js";
import type { World } from "./world.js";
import {
  ENEMY_ATTACK_COOLDOWN,
  ENEMY_ATTACK_RANGE,
  ENEMY_CORPSE_SECONDS,
  ENEMY_DAMAGE,
  ENEMY_DETECT_RANGE,
  ENEMY_HALF,
  ENEMY_SPEED,
  EPSILON,
  WALK_SPEED,
  PLAYER_EYE_OFFSET,
} from "./constants.js";

/** Wish length that produces exactly ENEMY_SPEED inside stepMovement. */
/** Enemies send no Sprint bit, so their wish is scaled against the walk. */
const ENEMY_WISH = ENEMY_SPEED / WALK_SPEED;

/** How long a chaser may fail to close before it tries going around. */
export const STUCK_SECONDS = 1.5;
/** How long it strafes once it does. Roughly two metres at ENEMY_SPEED. */
export const UNSTICK_SECONDS = 0.7;
/**
 * Squared-distance improvement that counts as progress. Squared, so this is
 * coarser far away than near — which is the right way round: an enemy 30 m out
 * inching sideways is not making progress worth crediting.
 */
export const STUCK_EPSILON = 0.01;

export function hasLineOfSight(
  from: Vec3,
  to: Vec3,
  boxes: BoxProvider,
  ground: GroundField | null = null,
): boolean {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (dist < EPSILON) return true;
  const dir: Vec3 = { x: dx / dist, y: dy / dist, z: dz / dist };
  return raycastScene(from, dir, dist, boxes, ground) === null;
}

export function acquireTarget(enemy: EnemyState, world: World): number {
  const eye: Vec3 = { x: enemy.pos.x, y: enemy.pos.y + PLAYER_EYE_OFFSET, z: enemy.pos.z };
  const rangeSq = ENEMY_DETECT_RANGE * ENEMY_DETECT_RANGE;

  let bestId = 0;
  let bestDistSq = Infinity;
  // Map iteration is insertion-ordered, so ties resolve identically on
  // every machine. That matters: this runs inside the deterministic sim.
  for (const player of world.state.players.values()) {
    if (player.health <= 0) continue;
    const distSq = distanceSquared(enemy.pos, player.pos);
    if (distSq > rangeSq || distSq >= bestDistSq) continue;
    const head: Vec3 = { x: player.pos.x, y: player.pos.y + PLAYER_EYE_OFFSET, z: player.pos.z };
    if (!hasLineOfSight(eye, head, world.boxes, world.ground)) continue;
    bestId = player.id;
    bestDistSq = distSq;
  }
  return bestId;
}

function faceToward(enemy: EnemyState, target: Vec3): void {
  const dx = target.x - enemy.pos.x;
  const dz = target.z - enemy.pos.z;
  if (Math.abs(dx) < EPSILON && Math.abs(dz) < EPSILON) return;
  // yaw 0 faces +Z and increases toward +X, matching wishDirection.
  enemy.yaw = Math.atan2(dx, dz);
}

/**
 * Runs one movement step with a synthesized input command, so enemies inherit
 * wall sliding and step-up rather than getting a second movement implementation
 * that could disagree with the first.
 *
 * `grounded: true` is passed unconditionally instead of being tracked on
 * EnemyState. It only selects friction and acceleration — the real grounded
 * flag is recomputed inside stepMovement from the vertical sweep — and it is
 * what makes a wish of 0 bring an enemy to a stop rather than leaving it
 * coasting. Tracking it would add a field to the determinism fingerprint for
 * no behaviour anyone can see.
 */
function move(enemy: EnemyState, world: World, dt: number, wish: number): void {
  const result = stepMovement(
    { pos: enemy.pos, vel: enemy.vel, grounded: true },
    { seq: 0, moveX: 0, moveZ: wish, yaw: enemy.yaw, pitch: 0, buttons: 0 },
    dt,
    world.boxes,
    ENEMY_HALF,
    world.waterLevel,
    world.ground,
  );
  enemy.pos = result.pos;
  enemy.vel = result.vel;
}

export function stepEnemy(enemy: EnemyState, world: World, dt: number): void {
  enemy.stateTimer += dt;
  if (enemy.attackCooldown > 0) enemy.attackCooldown = Math.max(0, enemy.attackCooldown - dt);

  if (enemy.health <= 0 && enemy.ai !== AiState.Dead) {
    enemy.ai = AiState.Dead;
    enemy.stateTimer = 0;
    enemy.targetId = 0;
  }

  switch (enemy.ai) {
    case AiState.Idle: {
      const target = acquireTarget(enemy, world);
      if (target !== 0) {
        enemy.ai = AiState.Chase;
        enemy.targetId = target;
        enemy.stateTimer = 0;
        return;
      }
      // Wander: pick a new heading every few seconds, drift slowly.
      if (enemy.stateTimer > 3) {
        enemy.stateTimer = 0;
        enemy.yaw = nextRandom(world.state) * Math.PI * 2;
      }
      move(enemy, world, dt, 0);
      return;
    }

    case AiState.Chase: {
      const target = world.state.players.get(enemy.targetId);
      if (target === undefined || target.health <= 0) {
        enemy.ai = AiState.Idle;
        enemy.targetId = 0;
        enemy.stateTimer = 0;
        return;
      }
      const distSq = distanceSquared(enemy.pos, target.pos);
      if (distSq > ENEMY_DETECT_RANGE * ENEMY_DETECT_RANGE * 2.25) {
        // Gave up: the 1.5x range hysteresis stops enemies flickering between
        // states right at the detection boundary.
        enemy.ai = AiState.Idle;
        enemy.targetId = 0;
        enemy.stateTimer = 0;
        return;
      }
      faceToward(enemy, target.pos);
      if (distSq <= ENEMY_ATTACK_RANGE * ENEMY_ATTACK_RANGE) {
        enemy.ai = AiState.Attack;
        enemy.stateTimer = 0;
        return;
      }

      // Stuck detection. Straight-line chase worked in a forest because trees
      // were sparse and convex, but ground the chaser cannot climb pins it
      // indefinitely — the old plateau cliffs were a 3 m drop against a
      // STEP_HEIGHT of 0.5, and montane ground is worse, which is why generated
      // worlds set `maxEnemies` to 0 for now. Rather than trying to
      // prove the generator emits no such geometry, notice the lack of progress
      // and go around.
      if (distSq < enemy.lastDistSq - STUCK_EPSILON) {
        enemy.stuckTimer = 0;
      } else {
        enemy.stuckTimer += dt;
      }
      enemy.lastDistSq = distSq;

      // Refreshed every tick while still stuck, which is the whole trick. An
      // earlier version alternated 1.5 s of straight-line chase with 0.7 s of
      // strafing, and the straight-line phase slid the enemy back along the
      // obstacle and undid the strafe: 5 s of effort produced 0.43 m of lateral
      // progress. Holding the strafe until progress resumes turns that into
      // wall-following, which actually gets around.
      if (enemy.stuckTimer > STUCK_SECONDS) enemy.unstickTimer = UNSTICK_SECONDS;

      if (enemy.unstickTimer > 0) {
        // Decays once the stuck condition clears, giving a short commitment tail so
        // the enemy does not immediately flip back and re-wedge itself.
        enemy.unstickTimer = Math.max(0, enemy.unstickTimer - dt);
        // Turn a quarter circle, move, turn back, so `yaw` still faces the target
        // and the model does not spin on the spot. Odd and even ids go opposite
        // ways, so a group splits around an obstacle instead of queueing behind
        // each other. Math.PI is an exactly specified constant, not a computed
        // function, so this adds no engine-dependent call.
        const side = (enemy.id & 1) === 0 ? 1 : -1;
        enemy.yaw += (side * Math.PI) / 2;
        move(enemy, world, dt, ENEMY_WISH);
        enemy.yaw -= (side * Math.PI) / 2;
        return;
      }

      move(enemy, world, dt, ENEMY_WISH);
      return;
    }

    case AiState.Attack: {
      const target = world.state.players.get(enemy.targetId);
      if (target === undefined || target.health <= 0) {
        enemy.ai = AiState.Idle;
        enemy.targetId = 0;
        enemy.stateTimer = 0;
        return;
      }
      faceToward(enemy, target.pos);
      const distSq = distanceSquared(enemy.pos, target.pos);
      if (distSq > ENEMY_ATTACK_RANGE * ENEMY_ATTACK_RANGE * 1.44) {
        enemy.ai = AiState.Chase;
        enemy.stateTimer = 0;
        return;
      }
      if (enemy.attackCooldown === 0) {
        target.health = Math.max(0, target.health - ENEMY_DAMAGE);
        enemy.attackCooldown = ENEMY_ATTACK_COOLDOWN;
      }
      move(enemy, world, dt, 0);
      return;
    }

    case AiState.Dead:
      // Corpses are removed by the world tick once the timer expires.
      return;
  }
}

export function isExpiredCorpse(enemy: EnemyState): boolean {
  return enemy.ai === AiState.Dead && enemy.stateTimer >= ENEMY_CORPSE_SECONDS;
}
