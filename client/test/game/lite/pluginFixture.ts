import type { MaterialPlugin, Texture2D, Texture2DArray } from "@babylonjs/lite";

/** A texture as a plugin holds one: the tests bind and compare it by identity and never read it. */
export type TextureStandIn = Texture2D & Texture2DArray;

/** A stand-in texture named `name`. */
export function standInTexture(name: string): TextureStandIn {
  return { name } as unknown as TextureStandIn;
}

/**
 * A material's uniform buffer laid out for `plugin`'s declared fields as a
 * renderer might lay them: each at a 16-byte boundary after the one before,
 * behind 64 bytes of the material's own, so no field sits where its index in
 * the declaration would put it.
 */
export function laidOut(plugin: MaterialPlugin): { data: Float32Array; offsets: Map<string, number> } {
  const offsets = new Map<string, number>();
  let at = 64;
  for (const field of plugin.getUniforms?.().ubo ?? []) {
    offsets.set(field.name, at);
    const array = /^array<vec4<u32>,(\d+)>$/.exec(field.type);
    at += array !== null ? 16 * Number(array[1]) : field.type === "mat4x4<f32>" ? 64 : 16;
  }
  return { data: new Float32Array(at / 4).fill(-99), offsets };
}

/** The `count` floats of the field `name` in `data`. */
export function readUniform(data: Float32Array, offsets: ReadonlyMap<string, number>, name: string, count: number): number[] {
  const at = offsets.get(name);
  if (at === undefined) throw new Error(`no field ${name}`);
  return [...data.subarray(at / 4, at / 4 + count)];
}
