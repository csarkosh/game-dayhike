import { describe, expect, it } from "vitest";
import type { UniformBuffer } from "@babylonjs/core/Materials/uniformBuffer.js";
import { pluginsInStates } from "./helpers/pluginText.js";

// WebGPU validates every binding a pipeline declares on every draw, where
// WebGL2 lets a declared sampler go unset. So a plugin must bind every sampler
// it lists, in every state it is drawn in.
describe("the plugins' samplers", () => {
  it("binds every sampler a plugin declares, in every state it is bound in", () => {
    const built = pluginsInStates();
    try {
      const missing: string[] = [];
      for (const { name, plugin, states, scene, engine, subMesh } of built.cases) {
        for (const [index, enter] of states.entries()) {
          enter();
          const declared: string[] = [];
          plugin.getSamplers(declared);
          const bound = new Set<string>();
          const ubo = new Proxy(
            {},
            { get: (_t, key) => (key === "setTexture" ? (n: string) => void bound.add(n) : () => undefined) },
          ) as unknown as UniformBuffer;
          plugin.bindForSubMesh(ubo, scene, engine, subMesh);
          for (const sampler of declared) if (!bound.has(sampler)) missing.push(`${name}, state ${index}: ${sampler}`);
        }
      }
      expect(missing).toEqual([]);
    } finally {
      built.dispose();
    }
  });

  it("walks the states the check is about", () => {
    const built = pluginsInStates();
    try {
      const byName = new Map(built.cases.map((c) => [c.name, c.states.length]));
      // The atmosphere before its first update and after; the terrain plain,
      // and with its road, trail and features on.
      expect(byName.get("atmosphere")).toBe(2);
      expect(byName.get("terrain")).toBe(2);
      // Nine plugins; the foliage once per profile (nine).
      expect(built.cases.length).toBe(17);
    } finally {
      built.dispose();
    }
  });
});
