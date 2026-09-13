import { describe, it, expect, afterEach } from "vitest";
import "../../src/sim/montane.js";
import {
  activeTerrainVariantName,
  DEFAULT_TERRAIN_VARIANT,
  registerTerrainVariant,
  setActiveTerrainVariant,
  terrainVariant,
  terrainVariantNames,
} from "../../src/sim/terrain.js";

afterEach(() => {
  // Registry state is module-global; leave it how other test files expect it.
  if (terrainVariantNames().includes(DEFAULT_TERRAIN_VARIANT)) {
    setActiveTerrainVariant(DEFAULT_TERRAIN_VARIANT);
  }
});

describe("terrain variant registry", () => {
  it("lists the registered variants", () => {
    const names = terrainVariantNames();
    expect(names).toContain("plain");
    expect(names).toContain("ridged");
    expect(new Set(names).size).toBe(names.length);
  });

  it("refuses a duplicate name", () => {
    expect(() =>
      registerTerrainVariant({ name: "plain", tunables: { X: 1 }, sample: () => ({ h: 0, dx: 0, dz: 0 }) }),
    ).toThrow(/already registered/);
  });

  it("refuses activating an unknown variant", () => {
    expect(() => setActiveTerrainVariant("no-such-variant")).toThrow(/unknown/);
  });

  it("switches the active variant", () => {
    setActiveTerrainVariant("plain");
    expect(activeTerrainVariantName()).toBe("plain");
  });

  it("declares tunables on every variant", () => {
    for (const name of terrainVariantNames()) {
      const v = terrainVariant(name);
      expect(Object.keys(v?.tunables ?? {}).length).toBeGreaterThan(5);
      for (const value of Object.values(v?.tunables ?? {})) expect(Number.isFinite(value)).toBe(true);
    }
  });
});
