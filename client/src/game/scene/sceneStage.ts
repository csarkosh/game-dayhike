/**
 * Applies one frame's description to what draws it: the renderer's free
 * camera, the actors' instances, the car's model, the caption and the
 * black. It decides nothing: every number comes from the frame. What is
 * missing (an actor's model, a car part) is said once and skipped, so the
 * scene plays with whatever has arrived.
 */
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import type { Node } from "@babylonjs/core/node.js";
import type { CharacterInstance } from "../characterModel.js";
import type { FreecamView } from "../renderer.js";
import type { PlacedModel } from "../staticModel.js";
import type { CaptionPanel } from "./captions.js";
import type { ActorPose, Frame } from "./timeline.js";

/** The car: the node the whole model moves by, and its named parts where the
 * model has them. The parts keep the model's own frame (the car drives +x in
 * it, its wheels' axles along z), which a whole-model turn does not change. */
export type CarModel = {
  root: TransformNode;
  wheels: readonly { node: TransformNode; front: boolean }[];
  door: TransformNode | null;
  steering: TransformNode | null;
  handset: TransformNode | null;
  cradle: TransformNode | null;
};

export type StageDeps = {
  setFreecam(view: FreecamView): void;
  setDepthOfField(on: boolean): void;
  actor(id: string): CharacterInstance | null;
  car: CarModel | null;
  /** The hand the handset rides in while the car's pose says so; absent or null, it stays in its cradle. */
  hand?: () => TransformNode | null;
  captions: CaptionPanel;
  black(amount: number): void;
  warn(line: string): void;
};

const WHEEL_NAMES = ["wheel_fl", "wheel_fr", "wheel_rl", "wheel_rr"];
const DOOR_NAME = "door_driver";
/** How far the driver's door swings when fully open (rad), outward. */
const DOOR_SWING = Math.PI / 1.5;
/** The steering wheel's column in the part's own frame: the wheel's thinnest direction, measured on the model. */
const STEERING_COLUMN = new Vector3(0.871, -0.491, 0).normalize();
/** The handset in the hand: its offset (m) and turn in the hand's frame. Set at the look (`docs/gameplay/2026-09-30-intro-film-staging.md`). */
export const GRIP = { position: new Vector3(0, 0.08, 0.03), rotation: Quaternion.Identity() };
/** The handset's place in its cradle, as the model has it. */
const IN_CRADLE = [0, 0.048, 0] as const;

/**
 * The car's parts by name under a placed model; none found, the whole
 * model is the stand-in. A node the loader made carries a rotation
 * quaternion, under which Babylon ignores the Euler `rotation` the stage
 * writes (`characterModel.ts` says why), so each part's quaternion is
 * folded into its Euler angles and cleared.
 */
export function carModelOf(placed: PlacedModel): CarModel {
  const under = placed.node.getChildTransformNodes(false);
  const byName = (name: string): TransformNode | null => {
    const node = under.find((n) => n.name === name || n.name.endsWith(`_${name}`)) ?? null;
    if (node !== null && node.rotationQuaternion !== null) {
      node.rotation = node.rotationQuaternion.toEulerAngles();
      node.rotationQuaternion = null;
    }
    return node;
  };
  const wheels = WHEEL_NAMES.map((name) => ({ node: byName(name), front: name.startsWith("wheel_f") }))
    .filter((w): w is { node: TransformNode; front: boolean } => w.node !== null);
  return { root: placed.node, wheels, door: byName(DOOR_NAME), steering: byName("wheel_steering"), handset: byName("handset"), cradle: byName("cradle") };
}

/** A node's world matrix now: its ancestors' first, so a pose set this frame is in it. */
export function worldOf(node: TransformNode): Matrix {
  const chain: TransformNode[] = [];
  for (let n: Node | null = node; n !== null; n = n.parent) if (n instanceof TransformNode) chain.unshift(n);
  for (const n of chain) n.computeWorldMatrix(true);
  return node.getWorldMatrix();
}

/** The handset in the hand (the hand's pose, its scale taken out, then the grip), written
 * as a pose under the cradle it stays a child of; or back in the cradle. */
function stageHandset(car: CarModel, hand: TransformNode | null): void {
  const { handset, cradle } = car;
  if (handset === null || cradle === null) return;
  if (hand === null) {
    handset.position.set(...IN_CRADLE);
    handset.rotationQuaternion = Quaternion.Identity();
    handset.scaling.setAll(1);
    return;
  }
  const handRotation = new Quaternion();
  const handPosition = new Vector3();
  worldOf(hand).decompose(undefined, handRotation, handPosition);
  const world = Matrix.Compose(Vector3.One(), GRIP.rotation, GRIP.position).multiply(Matrix.Compose(Vector3.One(), handRotation, handPosition));
  const local = world.multiply(worldOf(cradle).clone().invert());
  const scaling = new Vector3();
  const rotation = new Quaternion();
  const position = new Vector3();
  local.decompose(scaling, rotation, position);
  handset.scaling.copyFrom(scaling);
  handset.rotationQuaternion = rotation;
  handset.position.copyFrom(position);
}

const warnedActors = new WeakMap<StageDeps, Set<string>>();
const warnedJoints = new WeakMap<StageDeps, Set<string>>();

/** Moves the actor so its joint, as posed this frame, is at the anchor. */
function placeByJoint(instance: CharacterInstance, id: string, anchor: NonNullable<ActorPose["anchor"]>, deps: StageDeps): void {
  const joint = instance.joint(anchor.joint);
  if (joint === null) {
    let warned = warnedJoints.get(deps);
    if (warned === undefined) warnedJoints.set(deps, (warned = new Set()));
    if (!warned.has(anchor.joint)) {
      warned.add(anchor.joint);
      deps.warn(`scene: no joint ${anchor.joint} on ${id}; placed at its base`);
    }
    return;
  }
  const at = worldOf(joint).getTranslation();
  instance.root.position.addInPlaceFromFloats(anchor.x - at.x, anchor.y - at.y, anchor.z - at.z);
}

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
    instance.pose(a.clip, a.clipTime, a.blend === undefined ? undefined : { clip: a.blend.clip, seconds: a.blend.clipTime, weight: a.blend.weight });
    if (a.anchor !== undefined) placeByJoint(instance, a.id, a.anchor, deps);
  }
  if (frame.car !== null && deps.car !== null) {
    const car = frame.car;
    deps.car.root.position.set(car.x, car.y, car.z);
    deps.car.root.rotation.y = car.yaw;
    for (const wheel of deps.car.wheels) {
      wheel.node.rotation.z = -car.wheelSpin;
      wheel.node.rotation.y = wheel.front ? car.wheelTurn : 0;
    }
    if (deps.car.steering !== null) deps.car.steering.rotationQuaternion = Quaternion.RotationAxis(STEERING_COLUMN, car.steer);
    if (deps.car.door !== null) deps.car.door.rotation.y = -car.doorOpen * DOOR_SWING;
    stageHandset(deps.car, car.handset === "hand" ? (deps.hand?.() ?? null) : null);
  }
  deps.captions.set(frame.caption);
  deps.black(frame.black);
}
