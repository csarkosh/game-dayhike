import type { Scene } from "@babylonjs/core/scene.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { Color4 } from "@babylonjs/core/Maths/math.color.js";
// Non-.pure path, load-bearing (Babylon 9 split — see lighting.ts).
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem.js";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture.js";
import { Texture } from "@babylonjs/core/Materials/Textures/texture.js";
import { Engine } from "@babylonjs/core/Engines/engine.js";

import type { Rgb } from "./colour.js";
import type { QualityTier } from "./quality.js";
import type { WeatherParams } from "./weather.js";
import { MOTE_CAPACITY, motesUnder, type MoteSpecies } from "./motesParams.js";
import type { WindRecord } from "./windParams.js";

/** Emitter box half-width, metres, centred on the camera. */
export const MOTE_BOX_HALF = 10;
export const MOTE_TEX_SIZE = 16;
/** Additive alpha per mote: faint alone, bright where many overlap in lit air. */
const MOTE_ALPHA = 0.18;

/** A soft disc: alpha 1 at the centre falling to 0 at the rim. */
export function moteDiscMap(size: number = MOTE_TEX_SIZE): Uint8Array {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size - 0.5;
      const dy = (y + 0.5) / size - 0.5;
      const r = Math.min(1, Math.hypot(dx, dy) * 2);
      const a = 1 - r * r * (3 - 2 * r);
      const i = (y * size + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = Math.round(255 * a);
    }
  }
  return data;
}

export type Motes = {
  update(camPos: { x: number; y: number; z: number }, w: WeatherParams, hour: number, air: Rgb, wind: WindRecord): void;
  dispose(): void;
  readonly systems: readonly ParticleSystem[];
};

const SPECIES: readonly MoteSpecies[] = ["pollen", "midge", "frost"];

/**
 * Three CPU particle systems, one per species, sharing a capacity budget and
 * a soft-disc sprite, additive so motes vanish over dark ground and shine in
 * lit air. Null on low: the tier has no capacity, and creating an idle system
 * would still cost a draw.
 */
export function createMotes(scene: Scene, tier: QualityTier): Motes | null {
  const capacity = MOTE_CAPACITY[tier];
  if (capacity === 0) return null;
  const tex = RawTexture.CreateRGBATexture(
    moteDiscMap(), MOTE_TEX_SIZE, MOTE_TEX_SIZE, scene, true, false,
    Texture.TRILINEAR_SAMPLINGMODE, Engine.TEXTURETYPE_UNSIGNED_BYTE,
  );
  tex.hasAlpha = true;
  const emitter = new Vector3(0, 0, 0);
  const systems: ParticleSystem[] = [];
  const emitting: boolean[] = [];
  for (const name of SPECIES) {
    const system = new ParticleSystem(`motes_${name}`, Math.ceil(capacity / 3), scene);
    system.particleTexture = tex;
    system.emitter = emitter;
    system.minEmitBox = new Vector3(-MOTE_BOX_HALF, -MOTE_BOX_HALF * 0.5, -MOTE_BOX_HALF);
    system.maxEmitBox = new Vector3(MOTE_BOX_HALF, MOTE_BOX_HALF * 0.5, MOTE_BOX_HALF);
    system.minEmitPower = 1;
    system.maxEmitPower = 1;
    system.blendMode = ParticleSystem.BLENDMODE_ADD;
    system.emitRate = 0;
    systems.push(system);
    emitting.push(false);
  }

  return {
    systems,
    update(camPos, w, hour, air, wind) {
      emitter.set(camPos.x, camPos.y, camPos.z);
      const r = motesUnder(w, hour, air, tier, wind);
      const colour = new Color4(r.colour.r, r.colour.g, r.colour.b, MOTE_ALPHA);
      SPECIES.forEach((name, i) => {
        const s = r.species[name];
        const system = systems[i] as ParticleSystem;
        system.emitRate = s.rate;
        system.minSize = s.minSize;
        system.maxSize = s.maxSize;
        system.minLifeTime = s.minLife;
        system.maxLifeTime = s.maxLife;
        system.direction1 = new Vector3(r.drift.x - s.jitter, s.rise - s.jitter * 0.5, r.drift.z - s.jitter);
        system.direction2 = new Vector3(r.drift.x + s.jitter, s.rise + s.jitter * 0.5, r.drift.z + s.jitter);
        system.color1 = colour;
        system.color2 = colour;
        system.colorDead = new Color4(r.colour.r, r.colour.g, r.colour.b, 0);
        // The rain.ts start/stop latch: isStarted() stays true through the
        // drain, so track what we last asked for.
        if (s.rate > 0 && !emitting[i]) {
          system.start();
          emitting[i] = true;
        } else if (s.rate === 0 && emitting[i]) {
          system.stop();
          emitting[i] = false;
        }
      });
    },
    dispose() {
      // Only the first system disposes the shared texture; the rest keep it.
      systems.forEach((s, i) => s.dispose(i === 0));
    },
  };
}
