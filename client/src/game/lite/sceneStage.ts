/**
 * A scene's frame applied to what draws it on Babylon Lite: the renderer's
 * free camera, the actors, the scene's car with its handset, the caption
 * and the black. It decides nothing: every number comes from the frame, as
 * on Babylon.js (`scene/sceneStage.ts`), and the actors and the car are the
 * renderer's own to stand (`sceneryMeshes.ts`). What is missing (an actor
 * never asked for, a hand no actor has) is said once and skipped, so the
 * scene plays with whatever has arrived.
 *
 * Loads no engine: it names the renderer's scenery by its types alone.
 */
import type { FreecamView } from "../rendererTypes.js";
import type { CaptionPanel } from "../scene/captions.js";
import type { Frame } from "../scene/timeline.js";
import type { LiteActor, LiteCar } from "./sceneryMeshes.js";

/** The joint the handset rides in while the car's pose says a hand holds it. */
export const HAND_JOINT = "hand_r";

export type LiteStageDeps = {
  setFreecam(view: FreecamView): void;
  setDepthOfField(on: boolean): void;
  /** The actor of that id, or null for one the scene has not. */
  actor(id: string): LiteActor | null;
  /** The scene's car as it stands, or null until it lands. */
  car(): LiteCar | null;
  /** Whose hand the handset rides in; absent or null, it stays in its cradle. */
  hand?: () => LiteActor | null;
  captions: CaptionPanel;
  black(amount: number): void;
  warn(line: string): void;
};

const warnedActors = new WeakMap<LiteStageDeps, Set<string>>();
const warnedHand = new WeakSet<LiteStageDeps>();
const handScratch = new Float64Array(16);

export function stageLiteFrame(frame: Frame, deps: LiteStageDeps): void {
  const c = frame.camera;
  deps.setFreecam({ x: c.x, y: c.y, z: c.z, yaw: c.yaw, pitch: c.pitch, fov: c.fov, roll: c.roll });
  deps.setDepthOfField(c.dof);
  for (const a of frame.actors) {
    const actor = deps.actor(a.id);
    if (actor === null) {
      let warned = warnedActors.get(deps);
      if (warned === undefined) warnedActors.set(deps, (warned = new Set()));
      if (!warned.has(a.id)) {
        warned.add(a.id);
        deps.warn(`scene: no model for actor ${a.id}; not drawn`);
      }
      continue;
    }
    actor.stage(a);
  }
  const car = frame.car === null ? null : deps.car();
  if (frame.car !== null && car !== null) {
    // The handset rides in the hand as the actor was posed this frame: the actors are staged first.
    let hand: Float64Array | null = null;
    if (frame.car.handset === "hand" && deps.hand !== undefined) {
      hand = deps.hand()?.joint(HAND_JOINT, handScratch) ?? null;
      if (hand === null && !warnedHand.has(deps)) {
        warnedHand.add(deps);
        deps.warn("scene: no hand for the handset; it stays in its cradle");
      }
    }
    car.stage(frame.car, hand);
  }
  deps.captions.set(frame.caption);
  deps.black(frame.black);
}
