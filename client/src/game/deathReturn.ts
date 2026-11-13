/**
 * A screen's own death and return (docs/gameplay/2026-09-16-the-summit.md
 * §2). A player who dies in the chase comes back on the crest a few seconds
 * later (sim/returns.ts), and their screen learns it the only way it learns
 * anything of the host's: its own player's health reads nothing, then reads
 * something again. This is that reading, kept apart from what app.ts does
 * about it (the death's staging down, and everything undone on the way up).
 */
import { DeathCause } from "../sim/types.js";

/** Milliseconds the dark takes to lift, and the sound to come back, on a return. */
export const RETURN_LIFT_MS = 1200;

export type DeathReturn = {
  /** Fed the local player's health each frame (undefined where the player has no record this frame): "died" on the frame it first reads nothing, "returned" on the frame it reads something again, else null. */
  step(health: number | undefined): "died" | "returned" | null;
  /** Whether the screen is under its death now. */
  dead(): boolean;
  /** How many times this screen has come back. */
  returns(): number;
};

export function createDeathReturn(): DeathReturn {
  let dead = false;
  let returns = 0;
  return {
    step(health) {
      if (health === undefined) return null;
      if (!dead && health <= 0) {
        dead = true;
        return "died";
      }
      if (dead && health > 0) {
        dead = false;
        returns += 1;
        return "returned";
      }
      return null;
    },
    dead: () => dead,
    returns: () => returns,
  };
}

/** A cause's name, as the telemetry carries it. */
const CAUSE_NAMES: Readonly<Record<DeathCause, string>> = {
  [DeathCause.None]: "none",
  [DeathCause.Caught]: "caught",
  [DeathCause.OffTrail]: "offTrail",
  [DeathCause.Still]: "still",
  [DeathCause.Into]: "into",
  [DeathCause.Looked]: "looked",
  [DeathCause.Lunge]: "lunge",
};
export function causeName(cause: DeathCause): string {
  return CAUSE_NAMES[cause] ?? "none";
}
