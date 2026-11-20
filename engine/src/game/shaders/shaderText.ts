/**
 * How the game reads its WGSL, which is kept in files named `*.wgsl` under
 * `game/shaders/` and imported where it is used (`import source from
 * "../shaders/wet/lights.wgsl?raw"`). The files hold the text the GPU is
 * handed and nothing else; a place a value is written in at run time is a
 * slot, `${name}`, which the module that imports the file fills. `$` is not
 * a WGSL character, so a slot cannot be taken for shader text.
 *
 * Engine-free: this module imports nothing.
 */

/** The text of a file imported with `?raw`: without its one final newline, which a source file ends with and the shader text does not. */
export function wgsl(raw: string): string {
  return raw.endsWith("\n") ? raw.slice(0, -1) : raw;
}

const SLOT = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/**
 * `text` with every slot `${name}` replaced by `slots[name]`, a number as a
 * template literal would write it. A value may be filled text itself (a file
 * included in another). Throws, saying which side
 * is wrong, for a slot with no value, a value with no slot, and any `${` left
 * in the result (a slot written in a way that is not one, or a value that
 * carries an unfilled slot of its own).
 */
export function fill(text: string, slots: Readonly<Record<string, string | number>>): string {
  const used = new Set<string>();
  const filled = text.replace(SLOT, (_, name: string) => {
    const value = slots[name];
    if (value === undefined) throw new Error(`the shader text has a slot \${${name}} that the module gives no value`);
    used.add(name);
    return String(value);
  });
  for (const name of Object.keys(slots)) {
    if (!used.has(name)) throw new Error(`the module gives a value for \${${name}}, which the shader text does not have`);
  }
  const left = filled.indexOf("${");
  if (left >= 0) throw new Error(`the filled shader text still has "\${" at ${left}: ${filled.slice(left, left + 40)}`);
  return filled;
}
