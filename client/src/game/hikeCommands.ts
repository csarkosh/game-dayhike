import { GAME_MODES } from "./gameMode.js";
import { registerCommands, type CommandSpec } from "./commands.js";

/** Day Hike's own console commands, found after the engine's. */
export const HIKE_COMMANDS: readonly CommandSpec[] = [
  {
    name: "mode",
    kind: "world",
    // `mode game|explore|freecam` (gameMode.ts): the world's, so every peer
    // runs the same one; resolved as `seed` is, and written into the
    // address so an invite carries it. Absent, the saved choice stands.
    validate(args) {
      if (args.length === 1 && (GAME_MODES as readonly string[]).includes(args[0] as string)) return null;
      return `mode takes one of ${GAME_MODES.join(", ")}`;
    },
  },
  {
    name: "end",
    kind: "view",
    // `end won` or `end died`: plays this player's ending on the spot (the
    // end scene, endScene.ts, from where they stand; the death, ending.ts),
    // for looking at it and for recording its shader stages. Not persisted:
    // no `scriptValue`, so it never rides the URL into a match.
    validate(args) {
      return args.length === 1 && (args[0] === "won" || args[0] === "died") ? null : "end takes won or died";
    },
  },
  {
    name: "summit",
    kind: "view",
    // Bare: the host's player stands at the body and the next tick is the
    // find, so the summit scene (cutscene.ts) plays for a look. Not
    // persisted: no `scriptValue`.
    validate(args) {
      return args.length === 0 ? null : "summit takes no argument";
    },
  },
  {
    name: "escape",
    kind: "view",
    // Bare: the host's player stands on the pad short of the car and the
    // next tick is the win, so the end scene (endScene.ts) plays for a
    // look as a real win plays it. Not persisted: no `scriptValue`.
    validate(args) {
      return args.length === 0 ? null : "escape takes no argument";
    },
  },
  {
    name: "stand",
    kind: "view",
    // `stand x z` or `stand x z yaw`: the host's own player stands on the
    // ground at (x, z) in world metres, facing `yaw` radians (0 north, +Z;
    // π/2 east, +X), to play from there: a link to a place, as `freecam`'s
    // place is for a look. Host truth, so a client is told whose it is to
    // call. Not persisted: no `scriptValue`; from the URL it is called once
    // the world is in, as the looks are (2026-10-13).
    validate(args) {
      if (args.length !== 2 && args.length !== 3) return "stand takes a place: x z, or x z yaw";
      for (const a of args) if (!Number.isFinite(Number(a))) return `"${a}" is not a number`;
      return null;
    },
  },
  {
    name: "escalation",
    kind: "view",
    // `escalation <world>` holds the world's escalation (escalation.ts: the
    // hour's fall to night and the weather's turn with the party's climb)
    // at a value in [0, 1] for a look, so a player stood far up the trail
    // (`stand`) can see the ground by day; bare `escalation` lets the climb
    // set it again. The lens, the chase and the telemetry's acts keep the
    // climb's truth. Not persisted: no `scriptValue` (2026-10-13).
    validate(args) {
      if (args.length === 0) return null;
      if (args.length > 1) return "escalation takes no argument, or a value in [0, 1]";
      const v = Number(args[0]);
      if (!Number.isFinite(v) || v < 0 || v > 1) return `"${args[0]}" is not a value in [0, 1]`;
      return null;
    },
  },
  {
    name: "mist",
    kind: "view",
    // `mist <density>` holds the near mist (nearMist.ts) at a density in
    // [0, 1] whatever the night, for looking at it; bare `mist` lets the
    // night set it again and reports the density drawn. Not persisted: no
    // `scriptValue`, so it never rides the URL into a match.
    validate(args) {
      if (args.length === 0) return null;
      if (args.length > 1) return "mist takes no argument, or a density in [0, 1]";
      const v = Number(args[0]);
      if (!Number.isFinite(v) || v < 0 || v > 1) return `"${args[0]}" is not a density in [0, 1]`;
      return null;
    },
  },
  {
    name: "way",
    kind: "view",
    // `way on` holds the way down's light (wayLight.ts) whole whatever the
    // match is doing, `way off` holds it out, for looking at it and for
    // measuring what it costs; bare `way` lets the chase set it again. Not
    // persisted: no `scriptValue`, so it never rides the URL into a match.
    validate(args) {
      if (args.length === 0) return null;
      if (args.length > 1 || (args[0] !== "on" && args[0] !== "off")) return 'way takes no argument, or "on" or "off"';
      return null;
    },
  },
  {
    name: "crowd",
    kind: "view",
    // `crowd on` holds this screen's crowd (crowdField.ts) at its tier's most
    // wherever the match is, `crowd off` holds it at none, `crowd <count>` at
    // that many, for looking at it and for measuring what it costs; bare
    // `crowd` lets the chase set it again. Not persisted: no `scriptValue`.
    validate(args) {
      if (args.length === 0) return null;
      if (args.length === 1 && (args[0] === "on" || args[0] === "off")) return null;
      const n = Number(args[0]);
      if (args.length > 1 || !Number.isInteger(n) || n < 0 || n > 60) return 'crowd takes no argument, "on", "off", or a count from 0 to 60';
      return null;
    },
  },
  {
    name: "lamp",
    kind: "view",
    // The lamp is the host's player's, for a link's look at the night: `lamp`
    // or `lamp on` lights it, `lamp off` puts it out. Not persisted: no
    // `scriptValue`, so it never rides the URL into a match (`toggleSpec`
    // would give it one).
    validate(args) {
      if (args.length === 0) return null;
      if (args.length > 1 || (args[0] !== "on" && args[0] !== "off")) return 'lamp takes no argument, or "on" or "off"';
      return null;
    },
  },
];

registerCommands(HIKE_COMMANDS);
