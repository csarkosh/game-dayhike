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
import { MOTE_ALPHA, MOTE_EMIT_BOX, MOTE_SPECIES, MOTE_TEX_SIZE, moteCapacity, moteDiscMap, moteVelocities, motesUnder } from "./motesParams.js";
import type { WindRecord } from "./windParams.js";

export { MOTE_BOX_HALF, MOTE_TEX_SIZE, moteDiscMap } from "./motesParams.js";

export type Motes = {
  update(camPos: { x: number; y: number; z: number }, w: WeatherParams, hour: number, air: Rgb, wind: WindRecord): void;
  dispose(): void;
  readonly systems: readonly ParticleSystem[];
};

/**
 * Two CPU particle systems, the pollen's and the frost's, each a third of the
 * tier's capacity as before (500 on high, 200 on medium), so the two spend
 * two thirds of MOTE_CAPACITY: the third the dusk's midges held is not spent.
 * They share a soft-disc sprite, additive so motes vanish over dark ground
 * and shine in lit air. Null on low: the tier has no capacity, and creating
 * an idle system would still cost a draw.
 */
export function createMotes(scene: Scene, tier: QualityTier): Motes | null {
  const capacity = moteCapacity(tier);
  if (capacity === 0) return null;
  const tex = RawTexture.CreateRGBATexture(
    moteDiscMap(), MOTE_TEX_SIZE, MOTE_TEX_SIZE, scene, true, false,
    Texture.TRILINEAR_SAMPLINGMODE, Engine.TEXTURETYPE_UNSIGNED_BYTE,
  );
  tex.hasAlpha = true;
  const emitter = new Vector3(0, 0, 0);
  const systems: ParticleSystem[] = [];
  const emitting: boolean[] = [];
  for (const name of MOTE_SPECIES) {
    const system = new ParticleSystem(`motes_${name}`, capacity, scene);
    system.particleTexture = tex;
    system.emitter = emitter;
    system.minEmitBox = new Vector3(...MOTE_EMIT_BOX.min);
    system.maxEmitBox = new Vector3(...MOTE_EMIT_BOX.max);
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
      MOTE_SPECIES.forEach((name, i) => {
        const s = r.species[name];
        const system = systems[i] as ParticleSystem;
        system.emitRate = s.rate;
        system.minSize = s.minSize;
        system.maxSize = s.maxSize;
        system.minLifeTime = s.minLife;
        system.maxLifeTime = s.maxLife;
        const born = moteVelocities(r, name);
        system.direction1 = new Vector3(...born.min);
        system.direction2 = new Vector3(...born.max);
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
