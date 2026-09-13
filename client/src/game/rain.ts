import { Scene } from "@babylonjs/core/scene.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { Color4 } from "@babylonjs/core/Maths/math.color.js";
// Non-.pure path, load-bearing (Babylon 9 split — see lighting.ts).
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem.js";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture.js";
import { Texture } from "@babylonjs/core/Materials/Textures/texture.js";
import { Engine } from "@babylonjs/core/Engines/engine.js";

import { rainEmitRateUnder, RAIN_CAPACITY, type WeatherParams } from "./weather.js";
import type { QualityTier } from "./quality.js";

/** Emitter box half-width, metres, centred on the camera. */
export const RAIN_BOX_HALF = 15;
/** How far above the camera the emitter rides. */
export const RAIN_EMITTER_LIFT = 15;
/** Fall speed in m/s; direction1/2 spread adds slight wind drift. */
export const RAIN_FALL_SPEED = 11;
/** Seconds a streak lives — tuned to fall from the emitter to past ground level. */
export const RAIN_LIFETIME = 2.2;

export const RAIN_TEX_W = 4;
export const RAIN_TEX_H = 16;

/** A thin vertical streak: white, alpha peaking mid-column and fading at the ends. */
export function rainStreakMap(): Uint8Array {
  const data = new Uint8Array(RAIN_TEX_W * RAIN_TEX_H * 4);
  for (let y = 0; y < RAIN_TEX_H; y++) {
    const t = (y + 0.5) / RAIN_TEX_H;
    const vertical = Math.sin(Math.PI * t); // 0 at the ends, 1 in the middle
    for (let x = 0; x < RAIN_TEX_W; x++) {
      const nx = ((x + 0.5) / RAIN_TEX_W) * 2 - 1;
      const across = 1 - nx * nx;
      const i = (y * RAIN_TEX_W + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = Math.round(200 * vertical * across);
    }
  }
  return data;
}

export type Rain = {
  update(camPos: { x: number; y: number; z: number }, w: WeatherParams): void;
  dispose(): void;
  system: ParticleSystem;
};

/**
 * One CPU particle system of falling streaks in a camera-following box.
 * `rain 0` stops it entirely, so clear weather costs nothing per frame beyond
 * one emitter-position write. No terrain collision, no splashes.
 */
export function createRain(scene: Scene, tier: QualityTier): Rain {
  const system = new ParticleSystem("rain", RAIN_CAPACITY[tier], scene);
  const tex = RawTexture.CreateRGBATexture(
    rainStreakMap(), RAIN_TEX_W, RAIN_TEX_H, scene, true, false,
    Texture.TRILINEAR_SAMPLINGMODE, Engine.TEXTURETYPE_UNSIGNED_BYTE,
  );
  tex.hasAlpha = true;
  system.particleTexture = tex;

  const emitter = new Vector3(0, RAIN_EMITTER_LIFT, 0);
  system.emitter = emitter;
  system.minEmitBox = new Vector3(-RAIN_BOX_HALF, 0, -RAIN_BOX_HALF);
  system.maxEmitBox = new Vector3(RAIN_BOX_HALF, 0, RAIN_BOX_HALF);
  // Direction carries the speed; emit power is a plain multiplier of 1.
  system.direction1 = new Vector3(-0.5, -RAIN_FALL_SPEED, -0.2);
  system.direction2 = new Vector3(0.5, -RAIN_FALL_SPEED, 0.2);
  system.minEmitPower = 1;
  system.maxEmitPower = 1;
  system.minLifeTime = RAIN_LIFETIME * 0.9;
  system.maxLifeTime = RAIN_LIFETIME * 1.1;
  system.minScaleX = 0.02;
  system.maxScaleX = 0.04;
  system.minScaleY = 0.5;
  system.maxScaleY = 0.9;
  system.color1 = new Color4(0.75, 0.8, 0.85, 0.35);
  system.color2 = new Color4(0.75, 0.8, 0.85, 0.2);
  system.colorDead = new Color4(0.75, 0.8, 0.85, 0);
  system.blendMode = ParticleSystem.BLENDMODE_STANDARD;
  system.emitRate = 0;

  // Tracked independently of `system.isStarted()`, which is a one-way latch
  // in Babylon: `stop()` sets an internal `_stopped` flag but `isStarted()`
  // keeps returning true until every live particle ages out (up to
  // RAIN_LIFETIME * 1.1 seconds later). Gating `start()` on `isStarted()`
  // therefore misses a rain→clear→rain flip inside that drain window — the
  // guard sees `isStarted() === true` and never calls `start()` again, so
  // emission silently stays off even though `emitRate` is back above zero.
  // `start()` itself resets `_stopped` even mid-drain, so it is always safe
  // to call once our own `emitting` flag says we last told it to stop.
  let emitting = false;

  return {
    system,
    update(camPos, w) {
      emitter.set(camPos.x, camPos.y + RAIN_EMITTER_LIFT, camPos.z);
      const rate = rainEmitRateUnder(w, tier);
      system.emitRate = rate;
      if (rate > 0 && !emitting) {
        system.start();
        emitting = true;
      } else if (rate === 0 && emitting) {
        system.stop();
        emitting = false;
      }
    },
    dispose() {
      // `system.dispose()` disposes `particleTexture` by default (its first
      // parameter defaults to true) — a second manual `tex.dispose()` here
      // would be a redundant double-dispose.
      system.dispose();
    },
  };
}
