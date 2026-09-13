import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { loadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader.js";
import { registerBuiltInLoaders } from "@babylonjs/loaders/dynamic.js";

import catalog from "../../assets/catalog.json" with { type: "json" };

registerBuiltInLoaders();

/** Kinds whose models the game streams by LOD root name (clutter, forest and wildlife fields). */
const LOD_KINDS = new Set(["prop", "environment"]);

/**
 * Every model the catalog lists loads headlessly, has geometry, exposes every clip its catalog entry
 * names, and — for LOD-streamed kinds — has `LOD0` and `LOD1` roots. Enemies never spawn in normal
 * play today, so this is the only place their clips are exercised end to end.
 */
describe("every catalog model", () => {
  for (const entry of catalog.assets as { id: string; kind: string; output: string; animations?: Record<string, string> }[]) {
    it(`${entry.id} loads with its clips and LOD roots`, async () => {
      const bytes = readFileSync(new URL(`../../assets/${entry.output}`, import.meta.url));
      const engine = new NullEngine();
      try {
        const scene = new Scene(engine);
        const container = await loadAssetContainerAsync(new Uint8Array(bytes), scene, { pluginExtension: ".glb" });
        expect(container.meshes.some((m) => m.getTotalVertices() > 0)).toBe(true);
        const groups = container.animationGroups.map((g) => g.name);
        for (const clip of Object.values(entry.animations ?? {})) expect(groups).toContain(clip);
        if (LOD_KINDS.has(entry.kind)) {
          const names = [...container.transformNodes, ...container.meshes].map((n) => n.name);
          expect(names).toContain("LOD0");
          expect(names).toContain("LOD1");
        }
      } finally {
        engine.dispose();
      }
    });
  }
});
