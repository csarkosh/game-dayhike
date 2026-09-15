import { DEFAULT_WEATHER, WEATHER_NAMES } from "./weather.js";
import { DEFAULT_BOB_SCALE, MAX_BOB_SCALE } from "./viewBob.js";

export type CommandKind = "view" | "world";

export type ParsedCommand = { name: string; args: string[] };

export type CommandSpec = {
  name: string;
  /**
   * `world` entries are resolved into the initial world configuration before it
   * is built; `view` entries are applied once the renderer exists.
   *
   * The distinction is what makes a restart loop unconstructable: were a script's
   * `seed` dispatched as a normal command it would rewrite `?cmd=` and
   * re-initialise, which would re-read the script and dispatch it again, forever.
   */
  kind: CommandKind;
  /** Returns null when the arguments are acceptable, else a message naming why. */
  validate(args: readonly string[]): string | null;
  /** View commands: the value this entry denotes when it appears in a script. */
  scriptValue?(args: readonly string[]): boolean | number | string;
  /** View commands: the value at which the entry is omitted from the URL. */
  defaultValue?: boolean | number | string;
};

/** Long enough for any memorable phrase, short enough to keep URLs sane. */
export const SEED_TOKEN_MAX = 64;

/**
 * Commands that once existed and may still sit in a shared `?cmd=` link.
 * `parseScript` drops them without an error: a stale entry is not a mistake
 * the person opening the link can do anything about.
 */
export const RETIRED_COMMANDS: readonly string[] = ["style"];

/** Excludes whitespace and the `;` that separates script entries. */
const SEED_TOKEN = /^[^\s;]+$/;

let terrainVariants: readonly string[] = [];

/**
 * Called by the terrain generator once it has variants to offer. Until then the
 * list is empty and `/terrain` rejects everything, which is honest: there is
 * nothing to switch to.
 */
export function registerTerrainVariants(names: readonly string[]): void {
  terrainVariants = [...names];
}

function toggleSpec(name: string, defaultValue = false): CommandSpec {
  return {
    name,
    kind: "view",
    validate(args) {
      if (args.length === 0) return null;
      if (args.length === 1 && (args[0] === "on" || args[0] === "off")) return null;
      return `${name} takes no argument, or "on" or "off"`;
    },
    // Bare means *enable*, not flip. Toggling belongs to the bar, where the
    // current state is visible to whoever is typing.
    scriptValue: (args) => args[0] !== "off",
    defaultValue,
  };
}

const SPECS: readonly CommandSpec[] = [
  toggleSpec("freecam"),
  toggleSpec("wireframe"),
  // On by default: the URL records only `skin off`.
  toggleSpec("skin", true),
  {
    name: "time",
    kind: "view",
    validate(args) {
      if (args.length !== 1) return "time takes one argument, an hour in [0, 24)";
      const h = Number(args[0]);
      if (!Number.isFinite(h) || h < 0 || h >= 24) return `"${args[0]}" is not an hour in [0, 24)`;
      return null;
    },
    scriptValue: (args) => Number(args[0]),
    defaultValue: 12,
  },
  {
    name: "weather",
    kind: "view",
    validate(args) {
      // Bare reports the current state; app.ts answers it without dispatching.
      if (args.length === 0) return null;
      if (args.length === 1 && (WEATHER_NAMES as readonly string[]).includes(args[0] as string)) {
        return null;
      }
      return `weather takes no argument, or one of ${WEATHER_NAMES.join(", ")}`;
    },
    scriptValue: (args) => args[0] ?? DEFAULT_WEATHER,
    defaultValue: DEFAULT_WEATHER,
  },
  {
    name: "volume",
    kind: "view",
    validate(args) {
      if (args.length !== 1) return "volume takes one argument, a level in [0, 1]";
      const v = Number(args[0]);
      if (!Number.isFinite(v) || v < 0 || v > 1) return `"${args[0]}" is not a level in [0, 1]`;
      return null;
    },
    // Deliberately no `scriptValue`/`defaultValue`: /volume is "Not
    // persisted", so it must never be treated as URL-representable. app.ts
    // reads `args[0]` directly in its `applyView` volume branch instead, and
    // skips `persist()` for this command entirely.
  },
  {
    name: "bob",
    kind: "view",
    validate(args) {
      if (args.length === 0) return null;
      if (args.length > 1) return "bob takes one argument, a scale or \"off\"";
      if (args[0] === "off") return null;
      const v = Number(args[0]);
      if (!Number.isFinite(v) || v < 0 || v > MAX_BOB_SCALE) {
        return `"${args[0]}" is not a scale in [0, ${MAX_BOB_SCALE}] or "off"`;
      }
      return null;
    },
    // Bare `/bob` restores the tuned amplitude rather than toggling, matching
    // the toggle commands: the bar shows the current state to whoever is typing.
    scriptValue: (args) =>
      args.length === 0 ? DEFAULT_BOB_SCALE : args[0] === "off" ? 0 : Number(args[0]),
    defaultValue: DEFAULT_BOB_SCALE,
  },
  {
    name: "seed",
    kind: "world",
    validate(args) {
      if (args.length !== 1) return "seed takes one argument, a token such as epic-panda-fun";
      const token = args[0] as string;
      if (!SEED_TOKEN.test(token)) return "a seed token cannot contain whitespace or ;";
      if (token.length > SEED_TOKEN_MAX) return `a seed token is at most ${SEED_TOKEN_MAX} characters`;
      return null;
    },
  },
  {
    name: "terrain",
    kind: "world",
    validate(args) {
      if (args.length !== 1) return "terrain takes one argument, a variant name";
      if (terrainVariants.length === 0) return "no terrain variants are registered";
      if (!terrainVariants.includes(args[0] as string)) {
        return `unknown variant "${args[0]}" — valid: ${terrainVariants.join(", ")}`;
      }
      return null;
    },
  },
  {
    name: "debug",
    kind: "world",
    // Bare only: on a forest world it registers the trailhead pad marker
    // (app.ts) so Interact can be proven end to end in the browser, and both
    // sessions log the Interacted event.
    validate(args) {
      return args.length === 0 ? null : "debug takes no argument";
    },
  },
];

export function findCommand(name: string): CommandSpec | undefined {
  return SPECS.find((s) => s.name === name);
}

/**
 * Splits a typed line or a script entry into a name and arguments.
 *
 * Returns null for input carrying no command — a bare `/` or whitespace — which
 * is not an error. It simply closes the bar.
 */
export function parseCommandLine(line: string): ParsedCommand | null {
  const trimmed = line.trim().replace(/^\//, "").trim();
  if (trimmed.length === 0) return null;
  const parts = trimmed.split(/\s+/);
  return { name: parts[0] as string, args: parts.slice(1) };
}

/** Null when the command exists and its arguments are acceptable. */
export function validateCommand(p: ParsedCommand): string | null {
  const spec = findCommand(p.name);
  if (!spec) return `unknown command "${p.name}"`;
  return spec.validate(p.args);
}

/**
 * Rewrites the arguments of a command *typed into the bar* into the declarative
 * spelling a script uses, given whether that toggle is currently on.
 *
 * A bare typed toggle flips. Toggle semantics live exactly here, in the
 * bar, where the current state is visible to whoever is typing; without this,
 * typing `/wireframe` twice leaves wireframe on. `on` and `off` are absolute and
 * pass through, as does every non-toggle command.
 *
 * Script entries deliberately do *not* come through here, which is why the
 * result is expressed in the script's dialect — bare for on, `off` for off. A
 * bare script entry means enable, never flip, and that is what makes re-applying
 * a script idempotent: the property that lets view state survive the
 * re-initialisation a typed `/seed` triggers.
 */
export function resolveTypedArgs(
  name: string,
  args: readonly string[],
  isOn: boolean,
): string[] {
  const spec = findCommand(name);
  // A boolean default is what distinguishes a toggle from `/time <hour>`.
  if (typeof spec?.defaultValue === "boolean" && args.length === 0) {
    return isOn ? ["off"] : [];
  }
  return [...args];
}
