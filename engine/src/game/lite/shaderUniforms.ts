/**
 * A shader material's own uniforms on Babylon Lite, from a record of them by
 * name, as `pluginUniforms.ts` is for a plugin's: the game computes what a
 * stage of the hike's own is drawn with as such a record (`mistBanks.ts`,
 * `moteField.ts`), each name the one the stage reads, each value its
 * components in order, filled in place a frame.
 *
 * The writer hands Lite only the values that have moved since it last wrote
 * them, and says whether any went, for the renderer's count of what a frame
 * hands the GPU: a frame that moves none writes nothing, and makes no
 * garbage finding that out.
 */
import { setShaderUniform, type ShaderMaterial } from "@babylonjs/lite";

/** A record of a stage's uniforms by name: one to four floats each. */
export type ShaderUniformRecord = Readonly<Record<string, number[]>>;

const TYPES = ["f32", "vec2<f32>", "vec3<f32>", "vec4<f32>"] as const;

/** What a shader material declares for `record`: a uniform a name, its type from how many floats the value has, at the
 * record's values as they stand. */
export function shaderUniformDecls(record: ShaderUniformRecord): { name: string; type: (typeof TYPES)[number]; defaultValue: number[] }[] {
  return Object.entries(record).map(([name, value]) => {
    const type = TYPES[value.length - 1];
    if (type === undefined) throw new Error(`a uniform of ${value.length} components has no WGSL type: ${name}`);
    return { name, type, defaultValue: [...value] };
  });
}

/**
 * A writer of `record` to `material`, which declared it (`shaderUniformDecls`)
 * while it stood as it does now. Each call writes the uniforms whose values
 * differ, as the GPU holds them, from the ones last written, and returns
 * whether there was one.
 */
export function shaderUniformWriter(material: ShaderMaterial, record: ShaderUniformRecord): () => boolean {
  const names = Object.keys(record);
  const values = names.map((name) => record[name] as number[]);
  const written = values.map((value) => Float32Array.from(value));
  return () => {
    let wrote = false;
    for (let n = 0; n < names.length; n++) {
      const value = values[n] as number[];
      const last = written[n] as Float32Array;
      let moved = false;
      for (let i = 0; i < value.length; i++) {
        const v = Math.fround(value[i] as number);
        if (v !== last[i]) {
          last[i] = v;
          moved = true;
        }
      }
      if (!moved) continue;
      setShaderUniform(material, names[n] as string, value.length === 1 ? (value[0] as number) : value);
      wrote = true;
    }
    return wrote;
  };
}
