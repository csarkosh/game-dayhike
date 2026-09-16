import { describe, it, expect } from "vitest";
import "../../src/sim/passes/index.js";
import {
  DEFAULT_TERRAIN_VARIANT, activeTerrainVariant, elevationAt, setActiveTerrainVariant,
} from "../../src/sim/terrain.js";
import { forestDensityUnmasked } from "../../src/sim/vegetation.js";
import { seedFromToken } from "../../src/game/seed.js";
import {
  PAN_METRES_PER_SECOND, PAN_Z_NORTH, PAN_Z_SOUTH, landingView,
} from "../../src/game/landingPath.js";

setActiveTerrainVariant(DEFAULT_TERRAIN_VARIANT);
const seed = seedFromToken("day-hike");

/** One view per 8 m of shore, covering both ends of the stretch. */
function viewsAlongStretch() {
  const half = (PAN_Z_NORTH - PAN_Z_SOUTH) / 2;
  const legSeconds = (Math.PI * half) / PAN_METRES_PER_SECOND;
  const steps = Math.ceil((PAN_Z_NORTH - PAN_Z_SOUTH) / 8);
  const views = [];
  for (let i = 0; i <= steps; i++) {
    // From the south end (a quarter period back from the start) to the north.
    views.push(landingView(seed, -legSeconds / 2 + (legSeconds * i) / steps));
  }
  return views;
}

describe("landingView", () => {
  it("starts mid-stretch and already moving", () => {
    const a = landingView(seed, 0);
    const b = landingView(seed, 1);
    expect(a.z).toBeCloseTo((PAN_Z_SOUTH + PAN_Z_NORTH) / 2, 6);
    expect(b.z - a.z).toBeCloseTo(PAN_METRES_PER_SECOND, 2);
  });

  it("stays inside the curated stretch however long the page is open", () => {
    for (let s = 0; s < 6 * 3600; s += 37) {
      const v = landingView(seed, s);
      expect(v.z).toBeGreaterThanOrEqual(PAN_Z_SOUTH - 1e-6);
      expect(v.z).toBeLessThanOrEqual(PAN_Z_NORTH + 1e-6);
    }
  });

  it("holds the camera out over the water, clear of the ground and sea stacks", () => {
    const coast = activeTerrainVariant().coastDistance!;
    for (const v of viewsAlongStretch()) {
      expect(coast(seed, v.x, v.z)).toBeLessThan(0);
      let highest = -Infinity;
      for (let dx = -30; dx <= 30; dx += 5) {
        for (let dz = -30; dz <= 30; dz += 5) {
          highest = Math.max(highest, elevationAt(seed, v.x + dx, v.z + dz));
        }
      }
      expect(v.y - highest).toBeGreaterThan(3);
    }
  });

  it("keeps the sea out of frame, out to a 21:9 screen", () => {
    // Cast rays through the lower half of the frustum — the upper half is
    // sky — and march each to the ground. Wherever one lands, it must be dry.
    // The renderer's vertical fov is 1.4 rad; freecam pitch is positive down.
    const tanV = Math.tan(0.7);
    const tanH = tanV * (21 / 9);
    const coast = activeTerrainVariant().coastDistance!;
    for (const v of viewsAlongStretch().filter((_, i) => i % 4 === 0)) {
      const cp = Math.cos(v.pitch), sp = Math.sin(v.pitch);
      const cy = Math.cos(v.yaw), sy = Math.sin(v.yaw);
      for (let row = 0; row <= 4; row++) {
        for (let col = -6; col <= 6; col++) {
          // Camera space: +x right, +y up, +z forward.
          const cx = (col / 6) * tanH, cyUp = -(row / 4) * tanV;
          // Pitch about x (positive tilts the forward axis down)...
          const py = cyUp * cp - sp;
          const pz = cyUp * sp + cp;
          // ...then yaw about y; yaw 0 faces +Z, and right is (cos, −sin).
          const dx = pz * sy + cx * cy;
          const dz = pz * cy - cx * sy;
          if (py >= 0) continue;
          for (let t = 1; t < 4000; t += 2) {
            const x = v.x + dx * t, z = v.z + dz * t, y = v.y + py * t;
            if (Math.hypot(x - v.x, z - v.z) > 3000) break;
            if (y <= Math.max(elevationAt(seed, x, z), 0)) {
              expect(coast(seed, x, z)).toBeGreaterThan(0);
              break;
            }
          }
        }
      }
    }
  });

  it("faces inland, with forest in front of it along the whole stretch", () => {
    let forested = 0;
    const views = viewsAlongStretch();
    for (const v of views) {
      // Forward in XZ is (sin yaw, cos yaw); inland is +x on this coast.
      expect(Math.sin(v.yaw)).toBeGreaterThan(0.85);
      let density = 0;
      for (let d = 100; d <= 300; d += 20) {
        density += forestDensityUnmasked(seed, v.x + Math.sin(v.yaw) * d, v.z + Math.cos(v.yaw) * d);
      }
      if (density / 11 > 0.3) forested++;
    }
    expect(forested / views.length).toBeGreaterThan(0.8);
  });

  it("moves smoothly: no frame-to-frame jump in position or heading", () => {
    let prev = landingView(seed, 0);
    for (let s = 1 / 60; s < 900; s += 1 / 60 * 97) {
      const next = landingView(seed, s);
      const dt = 97 / 60;
      expect(Math.hypot(next.x - prev.x, next.z - prev.z) / dt).toBeLessThan(PAN_METRES_PER_SECOND * 1.6);
      expect(Math.abs(next.yaw - prev.yaw) / dt).toBeLessThan(0.02);
      prev = next;
    }
  });
});
