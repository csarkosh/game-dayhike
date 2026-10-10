import type { LakeBump, LakeFamily, LakeShape, LakeSpout } from "../../src/sim/lakeShape.js";

/**
 * Literal lakes for the tests: a straight stadium, its spine along z through
 * (cx, cz) from cz − halfLen to cz + halfLen, half-width `w` all along, with
 * no harmonics, no wobble, no bumps and no spout unless given. Its measures
 * are the stadium's own: sMax = w, the mean radius of the circle of the same
 * area πw² + 4·halfLen·w, the farthest shore point halfLen + w from the
 * centre, and a bound of halfLen + w + 47 (the steep bank's 6 m, an apron of
 * at most 31 m and the 10 m margin).
 */
export type StadiumOptions = {
  cx: number; cz: number; halfLen: number; w: number;
  level?: number; murk?: number; size?: number; headX?: number; headZ?: number; apron?: number;
  family?: LakeFamily; spout?: LakeSpout | null; bumps?: LakeBump[];
  harmA?: number[]; harmB?: number[]; noiseAmp?: number; noiseSeed?: number;
  sMax?: number; meanRadius?: number;
};

export function stadiumShape(o: StadiumOptions): LakeShape {
  const area = Math.PI * o.w * o.w + 4 * o.halfLen * o.w;
  return {
    family: o.family ?? "valley",
    px: [o.cx, o.cx], pz: [o.cz - o.halfLen, o.cz + o.halfLen], width: [o.w, o.w],
    cx: o.cx, cz: o.cz, size: o.size ?? Math.sqrt(area / Math.PI),
    harmA: o.harmA ?? new Array<number>(14).fill(0), harmB: o.harmB ?? new Array<number>(14).fill(0),
    noiseAmp: o.noiseAmp ?? 0, noiseSeed: o.noiseSeed ?? 0,
    bumps: o.bumps ?? [], spout: o.spout ?? null,
    headX: o.headX ?? 1, headZ: o.headZ ?? 0,
    apron: [o.apron ?? 20, 0, 0, 0, 0, 0, 0],
    level: o.level ?? 0, murk: o.murk ?? 0.5,
    bound: o.halfLen + o.w + 47,
    sMax: o.sMax ?? o.w, meanRadius: o.meanRadius ?? Math.sqrt(area / Math.PI), shoreMax: o.halfLen + o.w,
  };
}
