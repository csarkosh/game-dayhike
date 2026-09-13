import type { Vec3 } from "./types.js";

export type Aabb = { min: Vec3; max: Vec3 };
export type Brush = { box: Aabb; material: string };

export type Level = {
  id: string;
  brushes: Brush[];
  playerSpawns: Vec3[];
  enemySpawns: Vec3[];
};

function asVec3(value: unknown, what: string): Vec3 {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new Error(`${what} must be three numbers, got ${JSON.stringify(value)}`);
  }
  const [x, y, z] = value;
  if (typeof x !== "number" || typeof y !== "number" || typeof z !== "number") {
    throw new Error(`${what} must be three numbers, got ${JSON.stringify(value)}`);
  }
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    throw new Error(`${what} must be finite, got ${JSON.stringify(value)}`);
  }
  return { x, y, z };
}

function asVec3List(value: unknown, what: string): Vec3[] {
  if (!Array.isArray(value)) throw new Error(`${what} must be an array`);
  return value.map((entry, i) => asVec3(entry, `${what}[${i}]`));
}

export function parseLevel(raw: unknown): Level {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("level must be an object");
  }
  const obj = raw as Record<string, unknown>;

  if (typeof obj.id !== "string" || obj.id.length === 0) {
    throw new Error("level id must be a non-empty string");
  }
  if (!Array.isArray(obj.brushes) || obj.brushes.length === 0) {
    throw new Error("level must have at least one brush");
  }

  const brushes: Brush[] = obj.brushes.map((entry, i) => {
    if (typeof entry !== "object" || entry === null) {
      throw new Error(`brushes[${i}] must be an object`);
    }
    const b = entry as Record<string, unknown>;
    const min = asVec3(b.min, `brushes[${i}].min`);
    const max = asVec3(b.max, `brushes[${i}].max`);
    if (min.x >= max.x || min.y >= max.y || min.z >= max.z) {
      throw new Error(`brushes[${i}] min must be strictly less than max on every axis`);
    }
    const material = typeof b.material === "string" ? b.material : "default";
    return { box: { min, max }, material };
  });

  const playerSpawns = asVec3List(obj.playerSpawns, "playerSpawns");
  if (playerSpawns.length === 0) {
    throw new Error("level must define at least one entry in playerSpawns");
  }
  const enemySpawns = asVec3List(obj.enemySpawns, "enemySpawns");

  return { id: obj.id, brushes, playerSpawns, enemySpawns };
}

export function collisionBoxes(level: Level): Aabb[] {
  return level.brushes.map((b) => b.box);
}
