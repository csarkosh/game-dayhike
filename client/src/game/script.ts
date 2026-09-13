import { findCommand, parseCommandLine, validateCommand, type ParsedCommand } from "./commands.js";

export type ScriptEntry = ParsedCommand;

/**
 * Parses the `?cmd=` value: a semicolon-delimited list of commands.
 *
 * An invalid entry does not abort the rest. The valid entries are returned and
 * the failures are reported separately, because silently dropping one would
 * leave you believing a command took effect when it did not.
 */
export function parseScript(raw: string): { entries: ScriptEntry[]; errors: string[] } {
  const entries: ScriptEntry[] = [];
  const errors: string[] = [];
  for (const chunk of raw.split(";")) {
    const parsed = parseCommandLine(chunk);
    // An empty chunk from `;;` or a trailing `;` carries no command and is not
    // a mistake worth reporting.
    if (parsed === null) continue;
    const error = validateCommand(parsed);
    if (error !== null) errors.push(error);
    else entries.push(parsed);
  }
  return { entries, errors };
}

export function serialiseScript(entries: readonly ScriptEntry[]): string {
  return entries.map((e) => [e.name, ...e.args].join(" ")).join(";");
}

/**
 * World entries are resolved into the world configuration before it is built;
 * view entries are applied once the renderer exists.
 */
export function splitEntries(entries: readonly ScriptEntry[]): {
  world: ScriptEntry[];
  view: ScriptEntry[];
} {
  const world: ScriptEntry[] = [];
  const view: ScriptEntry[] = [];
  for (const e of entries) {
    (findCommand(e.name)?.kind === "world" ? world : view).push(e);
  }
  return { world, view };
}

/**
 * The entry of this name that decides the outcome, or undefined if absent.
 *
 * The *last* one, not the first: entries apply in listed order and a later entry
 * wins, so `seed a;seed b` must build `b`. Taking the first would build `a` while
 * the write-back — which keeps one entry per name — left the URL reading `b`, so
 * the address bar and the screen would disagree, which is the failure this whole
 * design exists to prevent.
 */
export function lastEntry(
  entries: readonly ScriptEntry[],
  name: string,
): ScriptEntry | undefined {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry?.name === name) return entry;
  }
  return undefined;
}

/**
 * Sets one entry, returning a new list.
 *
 * Replaces rather than appends, so a name never appears twice and a later
 * re-parse cannot disagree with itself. An entry whose value equals the
 * command's default is removed instead, which is what stops the URL growing a
 * term for every toggle that happens to be off.
 */
export function setEntry(
  entries: readonly ScriptEntry[],
  name: string,
  args: readonly string[],
): ScriptEntry[] {
  const spec = findCommand(name);
  // Check if we should omit this entry (value equals default)
  if (spec?.scriptValue && spec.defaultValue !== undefined) {
    if (spec.scriptValue(args) === spec.defaultValue) {
      return entries.filter((e) => e.name !== name);
    }
  }
  // Find the index of an existing entry with this name
  const existingIndex = entries.findIndex((e) => e.name === name);
  const next = [...entries];
  const newEntry = { name, args: [...args] };
  if (existingIndex >= 0) {
    // Replace in place
    next[existingIndex] = newEntry;
  } else {
    // Append if not found
    next.push(newEntry);
  }
  return next;
}
