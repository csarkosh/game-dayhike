// The frame-budget harness's fixed views: the places in the world every measurement is taken at,
// each the same however many times it is opened, and the links that open them. A view is a still
// of the README's (the free camera at a place), a first-person stand at a still's place, or a look
// (a command that runs a scene); a view marked `check` is measured only when asked for by name.
import { stillScript } from "../../previews/lib/still.mjs";

/** The canvas size each tier is measured at, fixed so a reading on one machine is the same pixels
 * as on another. */
export const TIER_SIZES = Object.freeze({
  medium: Object.freeze({ width: 1470, height: 956 }),
  high: Object.freeze({ width: 1512, height: 982 }),
});

/** The views to measure, each with the still it names (undefined for a look). With no `names`,
 * every view without `check`; with names, those views, check ones included. Throws before
 * anything else runs if a name is not in `views.json` or a view names a still `stills.json` lacks. */
export function resolveViews(config, stills, names = []) {
  const chosen =
    names.length === 0
      ? config.views.filter((v) => !v.check)
      : names.map((name) => {
          const view = config.views.find((v) => v.name === name);
          if (view === undefined) {
            throw new Error(`no view named ${name}; views.json has ${config.views.map((v) => v.name).join(", ")}`);
          }
          return view;
        });
  return chosen.map((view) => {
    if (view.still === undefined) return { view, still: undefined };
    const still = stills.stills.find((s) => s.name === view.still);
    if (still === undefined) throw new Error(`view ${view.name} names still ${view.still}, which stills.json does not have`);
    return { view, still };
  });
}

/** The page's `?cmd=` script for a view. */
export function viewScript(view, still) {
  if (view.look !== undefined) return `seed ${view.seed};${view.look}`;
  if (view.firstPerson) {
    const stand = `seed ${still.seed};stand ${still.x} ${still.z} ${still.yaw};escalation ${view.escalation ?? 0};unsettle 0`;
    return view.lamp ? `${stand};lamp` : stand;
  }
  return stillScript(still);
}

/** The URL that opens a view on `base`, on `tier`, telemetry off, with the GPU readout when asked,
 * and with the engine forced when asked (`?engine=webgpu`: a rig whose Chrome runs on Linux, which
 * the game's own rule would put on WebGL2; see `chooseEngine` in `engineChoice.ts`). */
export function viewUrl(base, game, tier, view, still, { gpuTime = false, engine = undefined } = {}) {
  const root = base.replace(/\/+$/, "");
  const cmd = encodeURIComponent(viewScript(view, still)).replace(/%3B/g, ";");
  return `${root}/game/${game}?cmd=${cmd}&tier=${tier}&telemetry=off${gpuTime ? "&gpuTime" : ""}${engine ? `&engine=${engine}` : ""}`;
}
