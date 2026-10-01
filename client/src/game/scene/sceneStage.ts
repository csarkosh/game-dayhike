/**
 * Applies one frame's description to what draws it: the renderer's free
 * camera, the actors' instances, the car's model, the caption and the
 * black. It decides nothing: every number comes from the frame. What is
 * missing (an actor's model, a car part) is said once and skipped, so the
 * scene plays with whatever has arrived.
 */
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import type { Node } from "@babylonjs/core/node.js";
import type { CharacterInstance } from "../characterModel.js";
import type { FreecamView } from "../renderer.js";
import type { PlacedModel } from "../staticModel.js";
import type { CaptionPanel } from "./captions.js";
import { coiledCord } from "./cord.js";
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
  /** Where the model rests the handset in its cradle, under the cradle. */
  handsetRest: { position: Vector3; rotation: Quaternion; scaling: Vector3 } | null;
};

export type StageDeps = {
  setFreecam(view: FreecamView): void;
  setDepthOfField(on: boolean): void;
  actor(id: string): CharacterInstance | null;
  car: CarModel | null;
  /** The hand the handset rides in while the car's pose says so; absent or null, it stays in its cradle. */
  hand?: () => TransformNode | null;
  /** Where the handset's coiled cord is drawn, along the path the stage gives it each frame. */
  cord?: { lay(path: { x: number; y: number; z: number }[]): void };
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
/** The handset in the hand: its offset (m) and turn in the hand joint's own frame, the fingers
 * along +y and the palm toward +z, measured on the talk clip's fist: the microphone's middle in
 * the fist and 0.025 m toward the index finger, so its grille end stands clear of it, and turned a
 * quarter about its length so the grille faces the mouth (`docs/gameplay/2026-09-30-intro-film-staging.md`). */
const GRIP = { position: new Vector3(0.025, 0.075, 0.03), rotation: Quaternion.RotationAxis(new Vector3(1, 0, 0), Math.PI / 2) };
/**
 * The car's parts by name under a placed model, each one missing said once;
 * none found, the whole model is the stand-in. A node the loader made
 * carries a rotation quaternion, under which Babylon ignores the Euler
 * `rotation` the stage writes (`characterModel.ts` says why), so each
 * part's quaternion is folded into its Euler angles and cleared.
 */
export function carModelOf(placed: PlacedModel, warn: (line: string) => void): CarModel {
  const under = placed.node.getChildTransformNodes(false);
  const turns = new Map<TransformNode, Quaternion>();
  const byName = (name: string): TransformNode | null => {
    const node = under.find((n) => n.name === name || n.name.endsWith(`_${name}`)) ?? null;
    if (node === null) warn(`scene: no part ${name} on the car; not moved`);
    if (node !== null) turns.set(node, node.rotationQuaternion?.clone() ?? Quaternion.FromEulerVector(node.rotation));
    if (node !== null && node.rotationQuaternion !== null) {
      node.rotation = node.rotationQuaternion.toEulerAngles();
      node.rotationQuaternion = null;
    }
    return node;
  };
  const wheels = WHEEL_NAMES.map((name) => ({ node: byName(name), front: name.startsWith("wheel_f") }))
    .filter((w): w is { node: TransformNode; front: boolean } => w.node !== null);
  const handset = byName("handset");
  const handsetRest = handset === null ? null : { position: handset.position.clone(), rotation: turns.get(handset)!, scaling: handset.scaling.clone() };
  return { root: placed.node, wheels, door: byName(DOOR_NAME), steering: byName("wheel_steering"), handset, cradle: byName("cradle"), handsetRest };
}

/** How much of the sky's reflected light the radio and its handset take, the rest of it roof: the
 * environment lights a part as if all the sky were open around it, and these plain dark parts,
 * unlike the cab's own textures, carry no darkness of their own. Set by eye on the insert. */
export const CAB_SKY = 0.3;

/** The radio's and the handset's materials under `CAB_SKY` of the sky's reflection. */
export function dimCabParts(car: CarModel): void {
  for (const part of [car.cradle, car.handset]) {
    if (part === null) continue;
    for (const mesh of part.getChildMeshes(false)) {
      const material = mesh.material;
      if (material instanceof PBRMaterial) material.environmentIntensity = CAB_SKY;
    }
  }
}

/** A node's world matrix now: its ancestors' first, so a pose set this frame is in it. */
export function worldOf(node: TransformNode): Matrix {
  const chain: TransformNode[] = [];
  for (let n: Node | null = node; n !== null; n = n.parent) if (n instanceof TransformNode) chain.unshift(n);
  for (const n of chain) n.computeWorldMatrix(true);
  return node.getWorldMatrix();
}

/** The handset in the hand (the grip in the joint's frame, its size taken out but not its
 * mirror, which a glTF skeleton under Babylon's handedness root has), eased there from its
 * place in the cradle by `grip`, written as a pose under the cradle it stays a child of; or
 * back in the cradle. */
function stageHandset(car: CarModel, hand: TransformNode | null, grip: number): void {
  const { handset, cradle, handsetRest: rest } = car;
  if (handset === null || cradle === null || rest === null) return;
  if (hand === null) {
    handset.position.copyFrom(rest.position);
    handset.rotationQuaternion = rest.rotation.clone();
    handset.scaling.copyFrom(rest.scaling);
    return;
  }
  // A decomposed rotation would fold the mirror into the grip, turning it about an axis.
  const handWorld = worldOf(hand);
  const m = handWorld.m;
  const unit = 1 / Math.hypot(m[0]!, m[1]!, m[2]!);
  const world = Matrix.Compose(Vector3.One(), GRIP.rotation, GRIP.position).multiply(Matrix.Scaling(unit, unit, unit)).multiply(handWorld);
  const local = world.multiply(worldOf(cradle).clone().invert());
  const scaling = new Vector3();
  const rotation = new Quaternion();
  const position = new Vector3();
  local.decompose(scaling, rotation, position);
  // Part of the way from its place in the cradle to the grip, by the pose's grip.
  handset.scaling.copyFrom(scaling);
  handset.rotationQuaternion = Quaternion.Slerp(rest.rotation, rotation, grip);
  handset.position = Vector3.Lerp(rest.position, position, grip);
}

/** The cord's socket on the radio's faceplate and its plug at the microphone's foot, each in its
 * part's own frame, measured on the model; and the cord: 0.6 m, sagging 0.04 m at most, 20 coils
 * of 6 mm. */
const CORD_SOCKET = new Vector3(-0.0645, -0.012, 0.025);
const CORD_PLUG = new Vector3(-0.0645, 0, 0);
const CORD = { length: 0.6, maxSag: 0.04, radius: 0.006, turns: 20, points: 201 };

const warnedActors = new WeakMap<StageDeps, Set<string>>();
const warnedJoints = new WeakMap<StageDeps, Set<string>>();
const warnedHand = new WeakSet<StageDeps>();

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
      // The part's own frame, under the loader's mirrored root, reverses a turn about y.
      wheel.node.rotation.y = wheel.front ? -car.wheelTurn : 0;
    }
    if (deps.car.steering !== null) deps.car.steering.rotationQuaternion = Quaternion.RotationAxis(STEERING_COLUMN, car.steer);
    if (deps.car.door !== null) deps.car.door.rotation.y = -car.doorOpen * DOOR_SWING;
    const hand = car.handset === "hand" && deps.hand !== undefined ? deps.hand() : null;
    if (car.handset === "hand" && deps.hand !== undefined && hand === null && !warnedHand.has(deps)) {
      warnedHand.add(deps);
      deps.warn("scene: no hand for the handset; it stays in its cradle");
    }
    stageHandset(deps.car, hand, car.grip ?? 1);
    const { cradle, handset } = deps.car;
    if (deps.cord !== undefined && cradle !== null && handset !== null) {
      const from = Vector3.TransformCoordinates(CORD_SOCKET, worldOf(cradle));
      const to = Vector3.TransformCoordinates(CORD_PLUG, worldOf(handset));
      deps.cord.lay(coiledCord(from, to, CORD));
    }
  }
  deps.captions.set(frame.caption);
  deps.black(frame.black);
}
