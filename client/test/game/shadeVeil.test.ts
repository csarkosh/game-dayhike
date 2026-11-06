import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { Constants } from "@babylonjs/core/Engines/constants.js";
import { Effect } from "@babylonjs/core/Materials/effect.js";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture.js";
import { Texture } from "@babylonjs/core/Materials/Textures/texture.js";
import { createShadeVeil, type ShadeVeil } from "../../src/game/shadeVeil.js";
import { SHADE_BLUR, SHADE_DARK, SHADE_MONSTER_DARK } from "../../src/game/post.js";

const REST = { x: 0, y: 0, reach: 0, time: 0 };

let engine: NullEngine;
let scene: Scene;
let veil: ShadeVeil;

beforeEach(() => {
  engine = new NullEngine();
  scene = new Scene(engine);
  new FreeCamera("cam", new Vector3(0, 2, 0), scene);
  veil = createShadeVeil(scene);
});
afterEach(() => {
  veil.dispose();
  scene.dispose();
  engine.dispose();
  vi.restoreAllMocks();
});

function mask(): RawTexture {
  return RawTexture.CreateRGBATexture(new Uint8Array([255, 0, 0, 255]), 1, 1, scene, false, false, Texture.NEAREST_SAMPLINGMODE);
}

describe("the shade veil", () => {
  it("draws nothing with no figure in the mask and the stare at rest", () => {
    veil.setShades(null, false);
    veil.setStare(REST);
    scene.render();
    expect(veil.drewLastFrame).toBe(false);
    veil.setShades(mask(), false);
    scene.render();
    expect(veil.drewLastFrame).toBe(false);
  });

  it("draws once a figure is in the mask, and for a stare alone", () => {
    veil.setShades(mask(), true);
    veil.setStare(REST);
    scene.render();
    expect(veil.drewLastFrame).toBe(true);
    veil.setShades(null, false);
    veil.setStare({ x: 0.1, y: 0, reach: 0.5, time: 3 });
    scene.render();
    expect(veil.drewLastFrame).toBe(true);
  });

  it("binds the grade's shade shape, the monster's darkness and the stare, and a texture for the mask always", () => {
    const float4 = vi.spyOn(Effect.prototype, "setFloat4");
    const float = vi.spyOn(Effect.prototype, "setFloat");
    const texture = vi.spyOn(Effect.prototype, "setTexture");
    const m = mask();
    veil.setShades(m, true);
    veil.setStare({ x: 0.1, y: -0.2, reach: 0.5, time: 3 });
    scene.render();
    const aspect = engine.getRenderWidth() / engine.getRenderHeight();
    expect(float4).toHaveBeenCalledWith("shadeShape", SHADE_BLUR, SHADE_DARK, aspect, 1);
    expect(float4).toHaveBeenCalledWith("stareShade", 0.1, -0.2, 0.5, 3);
    expect(float).toHaveBeenCalledWith("shadeMonster", SHADE_MONSTER_DARK);
    expect(texture).toHaveBeenCalledWith("shadeSampler", m);
    // A stare alone: the taps are gated off (w of 0) and a black texel stands in for the mask.
    veil.setShades(null, false);
    scene.render();
    expect(float4).toHaveBeenLastCalledWith("stareShade", 0.1, -0.2, 0.5, 3);
    expect(float4).toHaveBeenCalledWith("shadeShape", SHADE_BLUR, SHADE_DARK, aspect, 0);
    const last = texture.mock.calls[texture.mock.calls.length - 1];
    expect(last?.[0]).toBe("shadeSampler");
    expect(last?.[1]).not.toBe(m);
    expect(last?.[1]).not.toBeNull();
  });

  it("multiplies into the frame: the alpha mode is ALPHA_MULTIPLY for the draw and what it was after", () => {
    engine.setAlphaMode(Constants.ALPHA_COMBINE);
    const alpha = vi.spyOn(engine, "setAlphaMode");
    veil.setShades(mask(), true);
    scene.render();
    const modes = alpha.mock.calls.map((c) => c[0]);
    expect(modes).toContain(Constants.ALPHA_MULTIPLY);
    expect(modes.indexOf(Constants.ALPHA_MULTIPLY)).toBeLessThan(modes.lastIndexOf(Constants.ALPHA_COMBINE));
    expect(engine.getAlphaMode()).toBe(Constants.ALPHA_COMBINE);
  });

  it("stops drawing once disposed", () => {
    veil.setShades(mask(), true);
    scene.render();
    expect(veil.drewLastFrame).toBe(true);
    veil.dispose();
    scene.render();
    expect(veil.drewLastFrame).toBe(false);
  });
});
