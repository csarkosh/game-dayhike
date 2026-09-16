import { parseLevel } from "../sim/level.js";
import { createForest } from "../sim/forest.js";
import { createWorld } from "../sim/world.js";
import { DEFAULT_TERRAIN_VARIANT, setActiveTerrainVariant } from "../sim/terrain.js";
import { landingView } from "./landingPath.js";
import { createRenderer } from "./renderer.js";
import { seedFromToken } from "./seed.js";
import type { WeatherParams } from "./weather.js";
import sandbox01 from "../../levels/sandbox01.json" with { type: "json" };

/**
 * The seed behind the title screen. Fixed so the composition is curated: the
 * landing page shows the same ridgeline every visit, not a lottery draw.
 */
const SEED_TOKEN = "day-hike";

/** Dusk: the sun is just down, the sky a soft slate blue warming toward the
 * horizon. Later it goes blue-black, and much later the whole backdrop goes
 * black under the page's own dimming; at 21 nothing reads at all. */
const HOUR = 17.5;

/**
 * Half the `mist` preset's fog with nearly its cloud, and a trace of dread.
 * The two carry the look between them: at full mist the trees wash out to
 * the fog's colour (white, or lime green under thinner cloud), while at half
 * they keep their own dark colour and the mist settles low among the trunks.
 * Cloud 0.85 keeps the dusk light off the fog, which turns it green at 0.6.
 * Dread 0.15 sits below the first plateau (see `stepped` in `weather.ts`), so
 * it only drains a little colour.
 */
const WEATHER: WeatherParams = { cloudCover: 0.85, mist: 0.5, rain: 0, wetness: 0.5, dread: 0.15 };

export type LandingScene = { dispose(): void };

/**
 * The landing page's background: the game's own scenery — fixed seed, misty
 * dusk, low quality tier — with the camera panning slowly along the
 * shore, looking inland at the forest (see `landingPath.ts`). The
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
    renderer.setWeather(WEATHER, 0);
    renderer.setHour(HOUR);

    // sync() needs a world state; an empty non-authoritative one is enough —
    // with a freecam set it only drives the streaming, atmosphere and camera.
    const world = createWorld(level, seed, false);

    const start = performance.now();
    const frame = () => {
      renderer.setFreecam(landingView(seed, (performance.now() - start) / 1000));
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
