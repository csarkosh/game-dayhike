/**
 * The shade veil: how the material path (the tiers with no post chain, Low
 * on every phone) draws the haunt's shades and the stare, which the grade
 * pass draws on the post tiers. One full-screen quad after the scene,
 * multiplied into the frame, whose fragment shader
 * (shaders/shadeVeil.fragment.fx) is the grade's shade block and stare block
 * verbatim (shadeVeilParams.ts, shadeVeilShader.test.ts): the figure in the
 * mask read back through the same blur, the same blotched going, the same
 * crawling darkness on an open centre off the Hollow.
 *
 * It costs nothing while there is nothing to draw: with no figure in the
 * mask and the stare at rest the quad is skipped, so a day's frame on Low is
 * what it was. The renderer hands it what it hands the post: the mask and
 * whether any figure is in it (shadeSilhouette.ts), and the stare's shade
 * (stareLens.ts `stareShadeUnder`).
 */
import type { Scene } from "@babylonjs/core/scene.js";
import type { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture.js";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture.js";
import { Texture } from "@babylonjs/core/Materials/Textures/texture.js";
import { EffectRenderer, EffectWrapper } from "@babylonjs/core/Materials/effectRenderer.js";
import { Constants } from "@babylonjs/core/Engines/constants.js";
import "@babylonjs/core/Shaders/postprocess.vertex.js";
import type { StareShade } from "./stareLens.js";
import { SHADE_BLUR, SHADE_DARK, SHADE_MONSTER_DARK } from "./post.js";
import shadeVeilFragment from "./shaders/shadeVeil.fragment.fx?raw";

export type ShadeVeil = {
  /** The mask and whether any figure is in it this frame (shadeSilhouette.ts). */
  setShades(mask: BaseTexture | null, any: boolean): void;
  /** The stare's darkness this frame (`stareShadeUnder`); a reach of 0 draws none. */
  setStare(stare: StareShade): void;
  /** Whether the last frame drew the quad: for the tests. */
  readonly drewLastFrame: boolean;
  dispose(): void;
};

const REST: StareShade = { x: 0, y: 0, reach: 0, time: 0 };

export function createShadeVeil(scene: Scene): ShadeVeil {
  const engine = scene.getEngine();
  const renderer = new EffectRenderer(engine);
  const wrapper = new EffectWrapper({
    engine,
    name: "shadeVeil",
    fragmentShader: shadeVeilFragment,
    useShaderStore: false,
    uniformNames: ["shadeShape", "shadeMonster", "stareShade"],
    samplerNames: ["shadeSampler"],
  });
  /** A black texel for the mask's sampler while no mask is bound: the taps read it under a gate of 0. */
  const black = RawTexture.CreateRGBATexture(new Uint8Array([0, 0, 0, 255]), 1, 1, scene, false, false, Texture.NEAREST_SAMPLINGMODE);
  let mask: BaseTexture | null = null;
  let any = false;
  let stare: StareShade = REST;
  let drew = false;

  wrapper.onApplyObservable.add(() => {
    const effect = wrapper.effect;
    const shown = mask !== null && any;
    effect.setFloat4("shadeShape", SHADE_BLUR, SHADE_DARK, engine.getRenderWidth() / engine.getRenderHeight(), shown ? 1 : 0);
    effect.setFloat("shadeMonster", SHADE_MONSTER_DARK);
    effect.setFloat4("stareShade", stare.x, stare.y, stare.reach, stare.time);
    effect.setTexture("shadeSampler", shown ? mask : black);
  });

  const observer = scene.onAfterRenderObservable.add(() => {
    if (!((mask !== null && any) || stare.reach > 0) || !wrapper.isReady()) {
      drew = false;
      return;
    }
    const mode = engine.getAlphaMode();
    engine.setAlphaMode(Constants.ALPHA_MULTIPLY);
    renderer.render(wrapper);
    engine.setAlphaMode(mode);
    drew = true;
  });

  return {
    setShades(next, anyNow) {
      mask = next;
      any = anyNow;
    },
    setStare(next) {
      stare = next;
    },
    get drewLastFrame() {
      return drew;
    },
    dispose() {
      scene.onAfterRenderObservable.remove(observer);
      drew = false;
      wrapper.dispose();
      renderer.dispose();
      black.dispose();
    },
  };
}
