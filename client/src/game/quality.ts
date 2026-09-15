/**
 * The three quality tiers (low, medium, high), as data.
 *
 * Pure on purpose: the renderer must read these rather than hard-code shadow
 * resolutions, and a capability probe that takes a plain object can be tested
 * without a browser. Tiers change `game/` state only — never asset content and
 * never the simulation.
 */

export type QualityTier = "low" | "medium" | "high";

export type QualitySettings = {
  /** Babylon `engine.setHardwareScalingLevel` — above 1 renders below native. */
  hardwareScaling: number;
  /** Shadow map edge in texels. Zero means shadows are off. */
  shadowMapSize: number;
  /** Cascade count; meaningless when `shadowMapSize` is zero. `medium` uses a
   * single cascade; `high` uses Babylon's default cascade count as a
   * tuning value. */
  shadowCascades: number;
  /** Levels coarser to bias mesh LOD selection by. */
  lodBias: number;
  /** Largest mip dimension to keep. Zero means no cap. */
  textureMipCap: number;
};

/** Hardware scaling, shadow map sizes, LOD bias, and texture mip caps, by
 * tier. Cascade counts are tuning values: `medium` uses a single
 * cascade, and `high`'s count is ours to tune. `high` ran Babylon's default of 4 until
 * 2026-08-26: rasterising the old-growth giants' alpha-tested canopy into four 2048²
 * cascade maps measured ~5 ms/frame of GPU time at a deep-forest camera on production —
 * the frame missed 60 Hz vsync and juddered. Two cascades restore a locked 60 fps; the
 * first cascade widens from ~8 m to ~19 m of camera depth (still on a full 2048 map),
 * which PCF keeps acceptable. */
export const QUALITY: Record<QualityTier, QualitySettings> = {
  low: {
    hardwareScaling: 1.5,
    shadowMapSize: 0,
    shadowCascades: 0,
    lodBias: 1,
    textureMipCap: 512,
  },
  medium: {
    hardwareScaling: 1,
    shadowMapSize: 1024,
    shadowCascades: 1,
    lodBias: 0,
    textureMipCap: 1024,
  },
  high: {
    hardwareScaling: 1,
    shadowMapSize: 2048,
    shadowCascades: 2,
    lodBias: 0,
    textureMipCap: 0,
  },
};

export type Capabilities = {
  cores: number;
  memoryGb: number;
  mobile: boolean;
};

/**
 * Picks a starting tier. The player can override it; this only has to avoid
 * being embarrassing on first load.
 *
 * Mobile goes to `low` outright rather than by thresholds: a phone reporting
 * eight cores is reporting little clusters, and its thermal budget is the real
 * constraint. `low` is required to be genuinely playable, not merely
 * functional, so this is not a punishment.
 */
export function tierFor(caps: Capabilities): QualityTier {
  if (caps.mobile) return "low";
  if (caps.cores <= 4 || caps.memoryGb <= 4) return "low";
  if (caps.cores <= 8 || caps.memoryGb <= 8) return "medium";
  return "high";
}
