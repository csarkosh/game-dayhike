/**
 * A scene as data, and one frame of it from a time. A scene is a pure
 * function of time: given `t`, `evaluate` says where the camera, the actors
 * and the car are, which clip each actor is in and at what time, and which
 * caption is up. Nothing here advances on its own, which is what makes a
 * frame-exact recording, a test in Node and a seek all the same call.
 */

/** The camera: metres, radians; `fov` vertical, `roll` about the view axis,
 * `dof` whether depth of field is on. Yaw 0 faces +z, positive pitch looks down. */
export type CameraPose = { x: number; y: number; z: number; yaw: number; pitch: number; fov: number; roll: number; dof: boolean };
/** An actor: where it stands, which clip it is in and how far into it; a
 * second clip it is mixed toward (its share, 0 to 1); and a joint the stage
 * places at a point, moving the whole actor (a seated ranger by his chest). */
export type ActorPose = {
  id: string; x: number; y: number; z: number; yaw: number; clip: string; clipTime: number; visible: boolean;
  blend?: { clip: string; clipTime: number; weight: number };
  anchor?: { joint: string; x: number; y: number; z: number };
};
/** The car: its pose, the wheels' spin (radians), how open the driver's door is (0 to 1),
 * the front wheels' turn and the steering wheel's (radians, positive toward +x), and where
 * the handset is. */
export type CarPose = {
  x: number; y: number; z: number; yaw: number;
  wheelSpin: number; doorOpen: number; wheelTurn: number; steer: number;
  handset: "cradle" | "hand";
};
/** One caption, shown while `from <= t < to`; a `\n` in the text is its second line. */
export type Caption = { from: number; to: number; text: string; radio: boolean };

export type Frame = { t: number; camera: CameraPose; actors: ActorPose[]; car: CarPose | null; caption: Caption | null; black: number };

export type Scene = {
  duration: number;
  camera: (t: number) => CameraPose;
  actors: ((t: number) => ActorPose)[];
  car: ((t: number) => CarPose) | null;
  captions: readonly Caption[];
  /** How black the frame is, 0 (the picture) to 1 (black): the fade in, the fade out. */
  black: (t: number) => number;
};

export function clampTime(scene: Pick<Scene, "duration">, t: number): number {
  return Math.min(scene.duration, Math.max(0, t));
}

/** The caption up at `t`: the last whose `from` is not past `t` and whose `to` is. */
export function captionAt(captions: readonly Caption[], t: number): Caption | null {
  for (const c of captions) if (c.from <= t && t < c.to) return c;
  return null;
}

export function evaluate(scene: Scene, at: number): Frame {
  const t = clampTime(scene, at);
  return {
    t,
    camera: scene.camera(t),
    actors: scene.actors.map((a) => a(t)),
    car: scene.car === null ? null : scene.car(t),
    caption: captionAt(scene.captions, t),
    black: Math.min(1, Math.max(0, scene.black(t))),
  };
}
