/**
 * Which game this page runs, as the engine's own modules need to know it:
 * the words a player reads in the engine's lines, and the prefix of what
 * the page keeps in the browser. Set once, by the shell as it starts
 * (`startShell`) or by a test's setup, and read where a key or a line is
 * made. Nothing in `sim/` reads it.
 */
export type GameIdentity = {
  /** The game's name, as a player reads it. */
  title: string;
  /** What the game calls one session of play, as a noun in a sentence. */
  session: string;
  /** What a player with no name is called, and what a name made for a new visitor starts with. */
  player: string;
  /** What every key the page keeps in the browser's storage begins with. */
  storage: string;
};

let current: GameIdentity | null = null;

export function setGameIdentity(identity: GameIdentity): void {
  current = identity;
}

export function gameIdentity(): GameIdentity {
  if (current === null) throw new Error("no game's identity is set: the shell sets it as it starts, and a test in its setup");
  return current;
}
