import { describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder.js";
import { WING_GLSL, WingPlugin, attachWing, wingAngle, WING_TIME_WRAP } from "../../src/game/wingPlugin.js";

describe("wing beat", () => {
  it("rotates the wing tip by amp·sin and leaves the body still", () => {
    expect(wingAngle(0, 0, 1, 2 * Math.PI)).toBeCloseTo(0, 9);
    expect(wingAngle(0.25, 0, 1, 2 * Math.PI)).toBeCloseTo(1, 9); // quarter period at 1 Hz
    expect(wingAngle(0.25, 0, 0, 2 * Math.PI)).toBe(0);           // glide
  });
  it("wraps time phase-continuously: every omega is 2π·n/WING_TIME_WRAP", () => {
    for (const omega of [(2 * Math.PI * 900) / WING_TIME_WRAP, (2 * Math.PI * 750) / WING_TIME_WRAP]) {
      expect(wingAngle(WING_TIME_WRAP, 0.3, 1, omega)).toBeCloseTo(wingAngle(0, 0.3, 1, omega), 6);
    }
    // The check above is an identity for any ω on the grid, so it holds however
    // the reduction is written — it pins the ω table, not the constant. An ω
    // that is NOT on the grid makes the reduction itself visible, which is what
    // pins the period to WING_TIME_WRAP and nothing else.
    const offGrid = 1;
    expect(wingAngle(WING_TIME_WRAP + 2, 0, 1, offGrid)).toBeCloseTo(wingAngle(2, 0, 1, offGrid), 9);
    expect(wingAngle(2, 0, 1, offGrid)).not.toBeCloseTo(wingAngle(1, 0, 1, offGrid), 3);
  });
  it("never spells a preprocessor keyword inside a comment", () => {
    // A `#ifdef` in a GLSL comment is parsed as a directive and silently deletes code
    // (memory: glsl-comment-directives). Every hashed line must be a real directive.
    for (const line of WING_GLSL.split("\n")) {
      if (line.includes("#")) expect(line.trim().startsWith("#")).toBe(true);
    }
    // And over EVERY string the plugin injects, not just the body: the
    // attribute block and the uniform block carry `#`-lines too, and
    // the failure mode does not care which string it is hiding in.
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const material = new PBRMaterial("m_glsl", scene);
    attachWing(material, 0.5, 1);
    const plugin = material.pluginManager?.getPlugin("Wing") as WingPlugin;
    const injected = [...Object.values(plugin.getCustomCode("vertex") ?? {}), plugin.getUniforms().vertex];
    expect(injected.length).toBe(3);
    let hashed = 0;
    for (const source of injected) {
      for (const line of source.split("\n")) {
        if (!line.includes("#")) continue;
        expect(line.trim().startsWith("#")).toBe(true);
        hashed++;
      }
    }
    // Guards the loop against passing on a plugin that injects no directives at all.
    expect(hashed).toBeGreaterThan(5);
    engine.dispose();
  });

  it("guards the beat on THIN_INSTANCES, as groundConformPlugin does", () => {
    // The unguarded form would have been safe here — nothing
    // clones or impostors a bird bucket, and an unbound `wing` attribute reads
    // (0, 0), i.e. amp 0, an exact identity — but that safety lives in
    // wildlifeMeshes.ts, and the guard is two lines.
    const body = WING_GLSL.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
    expect(body[0]).toBe("#ifdef WING");
    expect(body[1]).toBe("#ifdef THIN_INSTANCES");
    expect(body[body.length - 2]).toBe("#endif");
    expect(body[body.length - 1]).toBe("#endif");
  });

  it("refuses a second attach that asks for a different beat", () => {
    // The once-guard's premise is that every caller for a material wants the
    // same beat. If two buckets ever shared one, silently keeping the first
    // would leave a bird flapping at another bird's wingspan and rate, with no
    // symptom but the look of it.
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const material = new PBRMaterial("m_twice", scene);
    attachWing(material, 0.5, 3);
    expect(() => attachWing(material, 0.5, 3)).not.toThrow();
    expect(() => attachWing(material, 0.9, 3)).toThrow(/already beats/);
    expect(() => attachWing(material, 0.5, 4)).toThrow(/already beats/);
    const plugin = material.pluginManager?.getPlugin("Wing") as WingPlugin;
    expect(plugin.halfSpan).toBe(0.5);
    expect(plugin.omega).toBe(3);
    engine.dispose();
  });
  it("attaches once per material and declares the per-instance attribute", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const material = new PBRMaterial("m", scene);
    // A real mesh, not the material: `getAttributes` takes an AbstractMesh, and
    // handing it the material would type-check only through the `as never` and
    // then read a field Babylon's own callers assume is a mesh.
    const mesh = CreateBox("wing_probe", { size: 1 }, scene);
    attachWing(material, 0.5, 1);
    attachWing(material, 0.5, 1);
    const plugin = material.pluginManager?.getPlugin("Wing") as WingPlugin;
    expect(plugin).toBeInstanceOf(WingPlugin);
    const attributes: string[] = [];
    plugin.getAttributes(attributes, scene, mesh);
    expect(attributes).toContain("wing");
    engine.dispose();
  });
  it("hooks the object-space stage, not the world-space one", () => {
    // The rotation is in the bird's own frame, so it has to land before
    // `#include<instancesVertex>` applies the thin-instance matrix —
    // foliagePlugin.ts hooks WORLDPOS for the opposite reason. A WORLDPOS hook
    // would beat every bird's wings about the WORLD x axis instead of its own.
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const material = new PBRMaterial("m2", scene);
    attachWing(material, 0.5, 1);
    const plugin = material.pluginManager?.getPlugin("Wing") as WingPlugin;
    const vertex = plugin.getCustomCode("vertex");
    expect(vertex).not.toBeNull();
    expect(vertex!.CUSTOM_VERTEX_UPDATE_POSITION).toBe(WING_GLSL);
    expect(vertex!.CUSTOM_VERTEX_UPDATE_WORLDPOS).toBeUndefined();
    // The attribute is declared as well as requested: `getAttributes` alone
    // binds the buffer but leaves the shader with no `wing` symbol.
    expect(vertex!.CUSTOM_VERTEX_DEFINITIONS).toContain("attribute vec2 wing;");
    expect(plugin.getCustomCode("fragment")).toBeNull();
    engine.dispose();
  });
});
