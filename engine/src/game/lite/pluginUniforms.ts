/**
 * A material plugin's uniforms on Babylon Lite, from a record of them by
 * name. The game computes what a material is drawn with as such records
 * (`terrainUniforms.ts`, `wetSurface.ts`, `atmosphereParams.ts`): each name
 * the one the shader reads, each value its components in order. A plugin
 * declares one field a name, its WGSL type from how many components the
 * value has, and writes the values where Lite lays the fields out in the
 * material's uniform buffer.
 *
 * Loads nothing: the two shapes Lite's plugin interface takes are named here.
 */

/** A record of uniforms by name: one to four floats each. */
export type UniformRecord = Readonly<Record<string, ArrayLike<number>>>;

/** A field of a material's uniform buffer, as a plugin declares it: read by
 * the fragment stage unless it says which stages read it. */
export type UniformField = { readonly name: string; readonly type: string; readonly visibility?: "vertex" | "fragment" | "vertex-fragment" };

/** Where Lite put each declared field: its name to its byte offset in the buffer. */
export type UniformOffsets = ReadonlyMap<string, number>;

const WGSL_TYPES = ["f32", "vec2<f32>", "vec3<f32>", "vec4<f32>"] as const;

/** The WGSL type of a value of `components` floats. */
export function wgslType(components: number): string {
  const type = WGSL_TYPES[components - 1];
  if (type === undefined) throw new Error(`a uniform of ${components} components has no WGSL type`);
  return type;
}

/** The fields `record` is declared as, in the record's own order, read by
 * the fragment stage or, given `visibility`, by the stages it names. */
export function uniformFields(record: UniformRecord, visibility?: UniformField["visibility"]): UniformField[] {
  return Object.entries(record).map(([name, value]) => ({ name, type: wgslType(value.length), ...(visibility === undefined ? {} : { visibility }) }));
}

/**
 * Writes every value of `record` into `data`, a material's uniform buffer as
 * floats, at its field's offset. A name Lite laid out no field for is a
 * plugin that declared one thing and wrote another: it throws, naming it.
 */
export function writeUniforms(data: Float32Array, offsets: UniformOffsets, record: UniformRecord): void {
  for (const name in record) {
    const offset = offsets.get(name);
    if (offset === undefined) throw new Error(`no uniform ${name} in the material's buffer`);
    const value = record[name] as ArrayLike<number>;
    const at = offset / 4;
    for (let i = 0; i < value.length; i++) data[at + i] = value[i] as number;
  }
}
