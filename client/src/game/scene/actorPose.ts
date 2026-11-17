/**
 * An actor's pose at a time of a scene's own, with no engine: where every
 * node of its model stands when a named clip is held a number of seconds
 * in, or mixed part of the way to a second clip at its own time, read from
 * the model's file (its nodes, its skin and its clips' samplers).
 *
 * It is the pose the stage on Babylon.js gives the same model
 * (`CharacterInstance.pose`, `characterModel.ts`): a clip's keys stand at
 * sixty frames a second, a clip is as long as its last key and wraps in
 * that length, a time before a channel's first key or after its last holds
 * that key, a turn is mixed along the arc between two keys and a place or a
 * size along the line, a stepped channel holds its key until the next, and
 * two clips are mixed a channel at a time the same two ways. So a scene's
 * stage that has no node to pose reads the same joints at the same places:
 * the joint an actor is held by, the hand a prop rides in, and the bones a
 * skinned mesh is drawn with.
 *
 * Every matrix is sixteen floats as a shader reads them, in the model's
 * own frame as a loader stands it in a left-handed world: the file's frame
 * mirrored across x.
 *
 * Loads no engine.
 */

/** Frames a second a clip's keys stand at. */
const CLIP_FPS = 60;
/** Floats a node's place, turn and size take: xyz, xyzw, xyz. */
const TRS = 10;

/** One channel of a clip: a node's place (0), turn (1) or size (2) over the clip's frames. */
type Channel = { node: number; path: 0 | 1 | 2; frames: Float64Array; values: Float32Array; step: boolean };
type Clip = { to: number; channels: Channel[]; byTarget: Map<number, Channel> };

/** A skinned mesh of the model: its joints' nodes, each joint's inverse bind matrix, and the mesh's own node. */
export type ActorSkin = { readonly node: number; readonly joints: Int32Array; readonly inverseBind: Float32Array };

/** A model's nodes, clips and skins as its file has them. */
export type ActorRig = {
  readonly nodes: number;
  readonly names: readonly (string | undefined)[];
  readonly parents: Int32Array;
  /** The nodes, a parent before its children. */
  readonly order: Int32Array;
  /** Each node's place, turn and size at rest, `TRS` floats a node. */
  readonly rest: Float64Array;
  /** A node the file gives a matrix and no place, turn and size: its matrix. */
  readonly matrices: ReadonlyMap<number, Float64Array>;
  readonly clips: ReadonlyMap<string, Clip>;
  readonly skins: readonly ActorSkin[];
  /** Each skinned mesh's node's matrix at rest, undone: sixteen floats a skin. */
  readonly meshInverse: Float64Array;
};

/** A second clip mixed into a pose: its name, its time and its share (0 to 1). */
export type ActorBlend = { clip: string; seconds: number; weight: number };

/** A rig posed: every node's own place, turn and size, and its matrix in the model's frame. */
export type ActorPosed = { readonly local: Float64Array; readonly world: Float64Array };

type GltfAccessor = { bufferView?: number; byteOffset?: number; componentType: number; count: number; type: string; sparse?: unknown };
type Gltf = {
  nodes?: { name?: string; children?: number[]; translation?: number[]; rotation?: number[]; scale?: number[]; matrix?: number[]; mesh?: number; skin?: number }[];
  skins?: { joints: number[]; inverseBindMatrices?: number }[];
  animations?: { name?: string; channels: { sampler: number; target: { node?: number; path: string } }[]; samplers: { input: number; output: number; interpolation?: string }[] }[];
  accessors?: GltfAccessor[];
  bufferViews?: { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number }[];
};

const COMPONENTS: Readonly<Record<string, number>> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const FLOAT = 5126;

/** The JSON and the binary chunk of a `.glb` file. */
function chunks(file: ArrayBuffer): { json: Gltf; bin: DataView } {
  const view = new DataView(file);
  if (view.byteLength < 20 || view.getUint32(0, true) !== 0x46546c67) throw new Error("not a .glb file");
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(file, 20, jsonLength))) as Gltf;
  const binAt = 20 + jsonLength;
  if (binAt + 8 > view.byteLength) throw new Error("a .glb file with no binary chunk");
  return { json, bin: new DataView(file, binAt + 8, view.getUint32(binAt, true)) };
}

/** An accessor of floats, a copy. */
function floats(json: Gltf, bin: DataView, index: number): Float32Array {
  const accessor = json.accessors?.[index];
  if (accessor === undefined) throw new Error(`no accessor ${index}`);
  const view = accessor.bufferView === undefined ? undefined : json.bufferViews?.[accessor.bufferView];
  if (view === undefined || accessor.componentType !== FLOAT || accessor.sparse !== undefined) throw new Error(`accessor ${index} is not a plain array of floats`);
  const components = COMPONENTS[accessor.type] ?? 1;
  const stride = view.byteStride ?? components * 4;
  const from = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const out = new Float32Array(accessor.count * components);
  for (let i = 0; i < accessor.count; i++) {
    for (let c = 0; c < components; c++) out[i * components + c] = bin.getFloat32(from + i * stride + c * 4, true);
  }
  return out;
}

const PATHS: Readonly<Record<string, 0 | 1 | 2>> = { translation: 0, rotation: 1, scale: 2 };
/** Where a path's floats stand in a node's `TRS`, and how many they are. */
const OFFSET = [0, 3, 7] as const;
const STRIDE = [3, 4, 3] as const;

/** a·b into `out` from `at`: `b` applied first. `out` may not be an operand. */
function multiply(a: ArrayLike<number>, ai: number, b: ArrayLike<number>, bi: number, out: Float64Array, at: number): void {
  for (let column = 0; column < 4; column++) {
    const b0 = b[bi + column * 4] as number, b1 = b[bi + column * 4 + 1] as number, b2 = b[bi + column * 4 + 2] as number, b3 = b[bi + column * 4 + 3] as number;
    for (let row = 0; row < 4; row++) {
      out[at + column * 4 + row] = (a[ai + row] as number) * b0 + (a[ai + 4 + row] as number) * b1 + (a[ai + 8 + row] as number) * b2 + (a[ai + 12 + row] as number) * b3;
    }
  }
}

/** The matrix of a size, a turn and a place, into `out` from `at`. */
function compose(trs: Float64Array, from: number, out: Float64Array, at: number): void {
  const x = trs[from + 3] as number, y = trs[from + 4] as number, z = trs[from + 5] as number, w = trs[from + 6] as number;
  const sx = trs[from + 7] as number, sy = trs[from + 8] as number, sz = trs[from + 9] as number;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  out[at] = (1 - (yy + zz)) * sx;
  out[at + 1] = (xy + wz) * sx;
  out[at + 2] = (xz - wy) * sx;
  out[at + 3] = 0;
  out[at + 4] = (xy - wz) * sy;
  out[at + 5] = (1 - (xx + zz)) * sy;
  out[at + 6] = (yz + wx) * sy;
  out[at + 7] = 0;
  out[at + 8] = (xz + wy) * sz;
  out[at + 9] = (yz - wx) * sz;
  out[at + 10] = (1 - (xx + yy)) * sz;
  out[at + 11] = 0;
  out[at + 12] = trs[from] as number;
  out[at + 13] = trs[from + 1] as number;
  out[at + 14] = trs[from + 2] as number;
  out[at + 15] = 1;
}

/** The inverse of a matrix whose last row is 0 0 0 1, into `out` from `at`. */
export function invertAffine(m: ArrayLike<number>, mi: number, out: Float64Array, at: number): void {
  const a = (i: number): number => m[mi + i] as number;
  const c00 = a(5) * a(10) - a(6) * a(9), c01 = a(6) * a(8) - a(4) * a(10), c02 = a(4) * a(9) - a(5) * a(8);
  const k = 1 / (a(0) * c00 + a(1) * c01 + a(2) * c02);
  const r0 = c00 * k, r1 = (a(2) * a(9) - a(1) * a(10)) * k, r2 = (a(1) * a(6) - a(2) * a(5)) * k;
  const r4 = c01 * k, r5 = (a(0) * a(10) - a(2) * a(8)) * k, r6 = (a(2) * a(4) - a(0) * a(6)) * k;
  const r8 = c02 * k, r9 = (a(1) * a(8) - a(0) * a(9)) * k, r10 = (a(0) * a(5) - a(1) * a(4)) * k;
  const tx = a(12), ty = a(13), tz = a(14);
  out[at] = r0; out[at + 1] = r1; out[at + 2] = r2; out[at + 3] = 0;
  out[at + 4] = r4; out[at + 5] = r5; out[at + 6] = r6; out[at + 7] = 0;
  out[at + 8] = r8; out[at + 9] = r9; out[at + 10] = r10; out[at + 11] = 0;
  out[at + 12] = -(r0 * tx + r4 * ty + r8 * tz);
  out[at + 13] = -(r1 * tx + r5 * ty + r9 * tz);
  out[at + 14] = -(r2 * tx + r6 * ty + r10 * tz);
  out[at + 15] = 1;
}

/** The rig of the model in `file`, a `.glb`. Throws where the file cannot be read. */
export function readActorRig(file: ArrayBuffer): ActorRig {
  const { json, bin } = chunks(file);
  const listed = json.nodes ?? [];
  const nodes = listed.length;
  const parents = new Int32Array(nodes).fill(-1);
  for (const [i, node] of listed.entries()) for (const child of node.children ?? []) parents[child] = i;
  const order = new Int32Array(nodes);
  const seen = new Uint8Array(nodes);
  let cursor = 0;
  const visit = (i: number): void => {
    if (seen[i] === 1) return;
    seen[i] = 1;
    const parent = parents[i] as number;
    if (parent >= 0) visit(parent);
    order[cursor++] = i;
  };
  for (let i = 0; i < nodes; i++) visit(i);
  const rest = new Float64Array(nodes * TRS);
  const matrices = new Map<number, Float64Array>();
  for (const [i, node] of listed.entries()) {
    const t = node.translation ?? [0, 0, 0], r = node.rotation ?? [0, 0, 0, 1], s = node.scale ?? [1, 1, 1];
    rest.set([t[0] as number, t[1] as number, t[2] as number, r[0] as number, r[1] as number, r[2] as number, r[3] as number, s[0] as number, s[1] as number, s[2] as number], i * TRS);
    if (node.matrix !== undefined) matrices.set(i, Float64Array.from(node.matrix));
  }

  const clips = new Map<string, Clip>();
  for (const [a, animation] of (json.animations ?? []).entries()) {
    const inputs = new Map<number, Float32Array>();
    const input = (index: number): Float32Array => {
      let made = inputs.get(index);
      if (made === undefined) inputs.set(index, (made = floats(json, bin, index)));
      return made;
    };
    const read: { node: number; path: 0 | 1 | 2; times: Float32Array; values: Float32Array; step: boolean }[] = [];
    let to = 0;
    for (const channel of animation.channels) {
      const path = PATHS[channel.target.path];
      const sampler = animation.samplers[channel.sampler];
      if (path === undefined || channel.target.node === undefined || sampler === undefined) continue;
      const interpolation = sampler.interpolation ?? "LINEAR";
      if (interpolation !== "LINEAR" && interpolation !== "STEP") throw new Error(`clip ${animation.name ?? a}: ${interpolation} keys are not read`);
      const times = input(sampler.input);
      if (times.length === 0) continue;
      to = Math.max(to, (times[times.length - 1] as number) * CLIP_FPS);
      read.push({ node: channel.target.node, path, times, values: floats(json, bin, sampler.output), step: interpolation === "STEP" });
    }
    // Every channel's keys reach from the clip's first frame to its last: one that starts later or ends sooner holds its own end.
    const channels: Channel[] = read.map(({ node, path, times, values, step }) => {
      const stride = STRIDE[path];
      const first = (times[0] as number) * CLIP_FPS, last = (times[times.length - 1] as number) * CLIP_FPS;
      const before = first > 0 ? 1 : 0, after = last < to ? 1 : 0;
      const frames = new Float64Array(times.length + before + after);
      const keyed = new Float32Array(frames.length * stride);
      if (before === 1) keyed.set(values.subarray(0, stride), 0);
      for (let k = 0; k < times.length; k++) frames[before + k] = (times[k] as number) * CLIP_FPS;
      keyed.set(values.subarray(0, times.length * stride), before * stride);
      if (after === 1) {
        frames[frames.length - 1] = to;
        keyed.set(values.subarray((times.length - 1) * stride, times.length * stride), (frames.length - 1) * stride);
      }
      return { node, path, frames, values: keyed, step };
    });
    const byTarget = new Map<number, Channel>();
    for (const channel of channels) byTarget.set(channel.node * 3 + channel.path, channel);
    clips.set(animation.name ?? `animation${a}`, { to, channels, byTarget });
  }

  const skins: ActorSkin[] = [];
  for (const [i, node] of listed.entries()) {
    const skin = node.skin === undefined ? undefined : json.skins?.[node.skin];
    if (skin === undefined || node.mesh === undefined) continue;
    const inverseBind = skin.inverseBindMatrices === undefined ? new Float32Array(skin.joints.length * 16) : floats(json, bin, skin.inverseBindMatrices);
    if (skin.inverseBindMatrices === undefined) for (let j = 0; j < skin.joints.length; j++) inverseBind[j * 16] = inverseBind[j * 16 + 5] = inverseBind[j * 16 + 10] = inverseBind[j * 16 + 15] = 1;
    skins.push({ node: i, joints: Int32Array.from(skin.joints), inverseBind });
  }
  const rig: ActorRig = { nodes, names: listed.map((node) => node.name), parents, order, rest, matrices, clips, skins, meshInverse: new Float64Array(skins.length * 16) };
  // Each skinned mesh's own node at rest, undone: a skin's bones are told in its mesh's frame.
  const atRest = createActorPosed(rig);
  atRest.local.set(rest);
  standNodes(rig, atRest);
  for (const [s, skin] of skins.entries()) invertAffine(atRest.world, skin.node * 16, rig.meshInverse, s * 16);
  return rig;
}

/** A pose's arrays for `rig`, at rest until it is posed. */
export function createActorPosed(rig: ActorRig): ActorPosed {
  const posed: ActorPosed = { local: rig.rest.slice(), world: new Float64Array(rig.nodes * 16) };
  standNodes(rig, posed);
  return posed;
}

const localScratch = new Float64Array(16);

/** Every node's matrix in the model's frame from the nodes' own places, turns and sizes. */
function standNodes(rig: ActorRig, posed: ActorPosed): void {
  const { world, local } = posed;
  for (let k = 0; k < rig.nodes; k++) {
    const i = rig.order[k] as number;
    const given = rig.matrices.get(i);
    if (given !== undefined) localScratch.set(given);
    else compose(local, i * TRS, localScratch, 0);
    const parent = rig.parents[i] as number;
    if (parent >= 0) {
      multiply(world, parent * 16, localScratch, 0, world, i * 16);
    } else {
      // The file's frame mirrored across x, as a loader stands it in a left-handed world.
      for (let e = 0; e < 16; e++) world[i * 16 + e] = e % 4 === 0 ? -(localScratch[e] as number) : (localScratch[e] as number);
    }
  }
}

/** The frame of `clip` that `seconds` into it falls on: a clip wraps in its own length. */
function frameOf(clip: Clip, seconds: number): number {
  const span = clip.to;
  return span > 0 ? (((seconds * CLIP_FPS) % span) + span) % span : 0;
}

const valueA = new Float64Array(4);
const valueB = new Float64Array(4);

/** `stride` floats mixed `amount` of the way from `a` to `b` into `out` from `at`: a turn along its arc, anything else along the line. */
function mix(a: ArrayLike<number>, ai: number, b: ArrayLike<number>, bi: number, amount: number, stride: number, out: Float64Array, at: number): void {
  if (stride !== 4) {
    for (let c = 0; c < stride; c++) out[at + c] = (a[ai + c] as number) + ((b[bi + c] as number) - (a[ai + c] as number)) * amount;
    return;
  }
  const ax = a[ai] as number, ay = a[ai + 1] as number, az = a[ai + 2] as number, aw = a[ai + 3] as number;
  const bx = b[bi] as number, by = b[bi + 1] as number, bz = b[bi + 2] as number, bw = b[bi + 3] as number;
  let dot = ax * bx + ay * by + az * bz + aw * bw;
  let flipped = false;
  if (dot < 0) {
    flipped = true;
    dot = -dot;
  }
  let ka: number, kb: number;
  if (dot > 0.999999) {
    ka = 1 - amount;
    kb = flipped ? -amount : amount;
  } else {
    const angle = Math.acos(dot);
    const k = 1 / Math.sin(angle);
    ka = Math.sin((1 - amount) * angle) * k;
    kb = flipped ? -Math.sin(amount * angle) * k : Math.sin(amount * angle) * k;
  }
  out[at] = ka * ax + kb * bx;
  out[at + 1] = ka * ay + kb * by;
  out[at + 2] = ka * az + kb * bz;
  out[at + 3] = ka * aw + kb * bw;
}

/** A channel's value at `frame`, into `out` from `at`. */
function evaluate(channel: Channel, frame: number, out: Float64Array, at: number): void {
  const { frames, values } = channel;
  const stride = STRIDE[channel.path];
  const n = frames.length;
  let key = frame < (frames[0] as number) ? -1 : 0;
  while (key + 1 <= n - 1 && frame >= (frames[key + 1] as number)) key++;
  const held = key < 0 ? 0 : key + 1 > n - 1 ? n - 1 : -1;
  if (held >= 0) {
    for (let c = 0; c < stride; c++) out[at + c] = values[held * stride + c] as number;
    return;
  }
  const end = key + 1;
  if (channel.step) {
    const from = (frames[end] as number) > frame ? key : end;
    for (let c = 0; c < stride; c++) out[at + c] = values[from * stride + c] as number;
    return;
  }
  const gradient = (frame - (frames[key] as number)) / ((frames[end] as number) - (frames[key] as number));
  mix(values, key * stride, values, end * stride, gradient, stride, out, at);
}

/**
 * Poses `rig` into `posed`: `clip` held `seconds` in, mixed `blend.weight`
 * of the way to `blend.clip` at its own time where a blend is given with
 * any weight. False, with `posed` left as it was, for a clip the model
 * lacks; a blend's clip it lacks is left out.
 */
export function poseActor(rig: ActorRig, clip: string, seconds: number, blend: ActorBlend | undefined, posed: ActorPosed): boolean {
  const main = rig.clips.get(clip);
  if (main === undefined) return false;
  const other = blend === undefined || blend.weight <= 0 ? undefined : rig.clips.get(blend.clip);
  const { local } = posed;
  const frame = frameOf(main, seconds);
  if (other === undefined || other === main) {
    for (const channel of main.channels) evaluate(channel, frame, local, channel.node * TRS + OFFSET[channel.path]);
  } else {
    const theirs = frameOf(other, (blend as ActorBlend).seconds);
    const weight = Math.min(1, (blend as ActorBlend).weight);
    for (const channel of main.channels) {
      const at = channel.node * TRS + OFFSET[channel.path];
      const partner = other.byTarget.get(channel.node * 3 + channel.path);
      if (partner === undefined) {
        evaluate(channel, frame, local, at);
        continue;
      }
      evaluate(channel, frame, valueA, 0);
      evaluate(partner, theirs, valueB, 0);
      mix(valueA, 0, valueB, 0, weight, STRIDE[channel.path], local, at);
    }
  }
  standNodes(rig, posed);
  return true;
}

/** The node of `rig` named `name`, or -1. */
export function actorNode(rig: ActorRig, name: string): number {
  return rig.names.indexOf(name);
}

/** The clips `rig` holds, by name. */
export function actorClips(rig: ActorRig): string[] {
  return [...rig.clips.keys()];
}

/**
 * Where an actor's root stands so that its node `joint`, as `posed`, is at
 * `anchor`: the actor faces `yaw` about the vertical (0 toward +z, a
 * quarter turn toward +x), and the joint's place in the model's frame,
 * turned so, is taken from the anchor.
 */
export function rootForJoint(posed: ActorPosed, joint: number, yaw: number, anchor: { x: number; y: number; z: number }, out: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  const jx = posed.world[joint * 16 + 12] as number, jy = posed.world[joint * 16 + 13] as number, jz = posed.world[joint * 16 + 14] as number;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  out.x = anchor.x - (jx * c + jz * s);
  out.y = anchor.y - jy;
  out.z = anchor.z - (-jx * s + jz * c);
  return out;
}

const boneScratch = new Float64Array(32);

/**
 * The bones of skin `skin` of `rig` as `posed`, sixteen floats a joint into
 * `out`: each joint's matrix in its mesh's own frame, over its inverse bind
 * matrix. What a skinned mesh's vertices are carried by.
 */
export function actorBones(rig: ActorRig, skin: number, posed: ActorPosed, out: Float32Array): void {
  const { joints, inverseBind } = rig.skins[skin] as ActorSkin;
  for (let j = 0; j < joints.length; j++) {
    multiply(rig.meshInverse, skin * 16, posed.world, (joints[j] as number) * 16, boneScratch, 0);
    multiply(boneScratch, 0, inverseBind, j * 16, boneScratch, 16);
    for (let e = 0; e < 16; e++) out[j * 16 + e] = boneScratch[16 + e] as number;
  }
}
