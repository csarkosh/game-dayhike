import { parseLevel } from "../sim/level.js";
import { createForest } from "../sim/forest.js";
import { createWorld } from "../sim/world.js";
import {
  DEFAULT_TERRAIN_VARIANT,
  elevationAt,
  setActiveTerrainVariant,
} from "../sim/terrain.js";
import { createRenderer } from "./renderer.js";
import { seedFromToken } from "./seed.js";
import { WEATHER_PRESETS } from "./weather.js";
import sandbox01 from "../../levels/sandbox01.json" with { type: "json" };

/**
 * The seed behind the title screen. Fixed so the composition is curated: the
 * landing page shows the same ridgeline every visit, not a lottery draw.
 */
const SEED_TOKEN = "day-hike";

/** Minecraft-title-screen pan: slow enough to feel ambient, ~0.5 degrees/s. */
const PAN_RADIANS_PER_SECOND = 0.009;

/**
 * Just above the canopy, pitched down so forest fills most of the frame at
 * every yaw of the pan — the sky stays a band, not the subject.
 */
const EYE_ABOVE_GROUND = 16;
const PITCH_DOWN = 0.24;

export type LandingScene = { dispose(): void };

/**
 * The landing page's background: the game's own scenery — fixed seed, mist
 * weather, low quality tier — with the camera slowly rotating in place. The
 * blur and vignette that turn it into a backdrop are CSS on the canvas and the
 * overlay, not the renderer's business.
 *
 * Returns null when the scene cannot be built (no WebGL); the landing page
 * then simply keeps its flat background. A title screen must never be the
 * reason the game is unreachable.
 */
export function createLandingScene(canvas: HTMLCanvasElement): LandingScene | null {
  try {
    // Module state survives popstate re-renders, so a previous game's
    // `/terrain` command would otherwise leak into the curated view.
    setActiveTerrainVariant(DEFAULT_TERRAIN_VARIANT);

    const seed = seedFromToken(SEED_TOKEN);
    const level = parseLevel(sandbox01);
    const forest = createForest(seed);
    const renderer = createRenderer(canvas, level, forest, { tier: "low" });
    renderer.setWeather(WEATHER_PRESETS.mist, 0);

    // sync() needs a world state; an empty non-authoritative one is enough —
    // with a freecam set it only drives the clipmap, mist and camera.
    const world = createWorld(level, seed, false);

    const eyeX = 0;
    const eyeZ = 0;
    const eyeY = elevationAt(seed, eyeX, eyeZ) + EYE_ABOVE_GROUND;

    const start = performance.now();
    const frame = () => {
      const yaw = ((performance.now() - start) / 1000) * PAN_RADIANS_PER_SECOND;
      renderer.setFreecam({ x: eyeX, y: eyeY, z: eyeZ, yaw, pitch: PITCH_DOWN });
      renderer.sync(world.state, -1, 0);
      renderer.scene.render();
    };
    renderer.engine.runRenderLoop(frame);

    // The canvas is hidden until here (see .landing-bg): a mesh whose shader
    // is still compiling is skipped, so the opening frames draw the sky alone
    // and flash bright before the forest darkens them. `executeWhenReady`
    // waits for exactly that — materials and shaders compiled.
    let revealed = false;
    const reveal = () => {
      revealed = true;
      canvas.classList.add("ready");
    };
    renderer.scene.executeWhenReady(reveal);
    // A backdrop that never appears is worse than one that fades in early, so
    // this bounds the wait if the scene never reports ready.
    const revealFallback = setTimeout(() => {
      if (!revealed) reveal();
    }, 4000);

    const onResize = () => renderer.resize();
    window.addEventListener("resize", onResize);

    return {
      dispose() {
        clearTimeout(revealFallback);
        window.removeEventListener("resize", onResize);
        renderer.engine.stopRenderLoop(frame);
        renderer.dispose();
      },
    };
  } catch {
    return null;
  }
}
