/**
 * Applies one frame's description to what draws it: the renderer's free
 * camera, the actors' instances, the car's model, the caption and the
 * black. It decides nothing: every number comes from the frame. What is
 * missing (an actor's model, a car part) is said once and skipped, so the
 * scene plays with whatever has arrived.
 */
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import type { CharacterInstance } from "../characterModel.js";
import type { FreecamView } from "../renderer.js";
import type { PlacedModel } from "../staticModel.js";
import type { CaptionPanel } from "./captions.js";
import type { Frame } from "./timeline.js";

/** The car: the node the whole model moves by, and its named parts where
 * the model has them (`wheel_fl`, `wheel_fr`, `wheel_rl`, `wheel_rr`, `door_driver`). */
export type CarModel = { root: TransformNode; wheels: readonly TransformNode[]; door: TransformNode | null };

export type StageDeps = {
  setFreecam(view: FreecamView): void;
  setDepthOfField(on: boolean): void;
  actor(id: string): CharacterInstance | null;
  car: CarModel | null;
  captions: CaptionPanel;
  black(amount: number): void;
  warn(line: string): void;
};

const WHEEL_NAMES = ["wheel_fl", "wheel_fr", "wheel_rl", "wheel_rr"];
const DOOR_NAME = "door_driver";
/** How far the driver's door swings when fully open (rad), outward. */
const DOOR_SWING = Math.PI / 1.5;

/** The car's parts by name under a placed model; none found, the whole model is the stand-in. */
export function carModelOf(placed: PlacedModel): CarModel {
  const under = placed.node.getChildTransformNodes(false);
  const byName = (name: string): TransformNode | null => under.find((n) => n.name === name || n.name.endsWith(`_${name}`)) ?? null;
  const wheels = WHEEL_NAMES.map(byName).filter((n): n is TransformNode => n !== null);
  return { root: placed.node, wheels, door: byName(DOOR_NAME) };
}

const warnedActors = new WeakMap<StageDeps, Set<string>>();

export function stageFrame(frame: Frame, deps: StageDeps): void {
  const c = frame.camera;
  deps.setFreecam({ x: c.x, y: c.y, z: c.z, yaw: c.yaw, pitch: c.pitch, fov: c.fov, roll: c.roll });
  deps.setDepthOfField(c.dof);
  for (const a of frame.actors) {
    const instance = deps.actor(a.id);
    if (instance === null) {
      let warned = warnedActors.get(deps);
      if (warned === undefined) warnedActors.set(deps, (warned = new Set()));
      if (!warned.has(a.id)) {
        warned.add(a.id);
        deps.warn(`scene: no model for actor ${a.id}; not drawn`);
      }
      continue;
    }
    instance.root.setEnabled(a.visible);
    if (!a.visible) continue;
    instance.root.position.set(a.x, a.y, a.z);
    instance.root.rotation.y = a.yaw;
    instance.pose(a.clip, a.clipTime);
  }
  if (frame.car !== null && deps.car !== null) {
    const car = frame.car;
    deps.car.root.position.set(car.x, car.y, car.z);
    deps.car.root.rotation.y = car.yaw;
    for (const wheel of deps.car.wheels) wheel.rotation.x = car.wheelSpin;
    if (deps.car.door !== null) deps.car.door.rotation.y = -car.doorOpen * DOOR_SWING;
  }
  deps.captions.set(frame.caption);
  deps.black(frame.black);
}
