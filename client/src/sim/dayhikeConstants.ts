/**
 * Day Hike's own numbers for its players and its enemies. What the engine's simulation reads
 * (the tick, movement, the network's pacing) is the engine's (`constants.ts`).
 */
import type { Vec3 } from "@csarkosh/engine/sim/core";

export const ENEMY_HALF: Vec3 = { x: 0.4, y: 0.9, z: 0.4 };
export const PLAYER_MAX_HEALTH = 100;
export const ENEMY_MAX_HEALTH = 40;
export const ENEMY_DETECT_RANGE = 30;
export const ENEMY_ATTACK_RANGE = 2.0;
export const ENEMY_SPEED = 3.2;
export const ENEMY_DAMAGE = 8;
export const ENEMY_ATTACK_COOLDOWN = 1.2;
export const ENEMY_CORPSE_SECONDS = 4;
export const ENEMY_BASE_POPULATION = 12;
export const ENEMY_PER_EXTRA_PLAYER = 6;
export const ENEMY_POPULATION_CAP = 30;
export const ENEMY_MIN_SPAWN_DISTANCE = 25;
