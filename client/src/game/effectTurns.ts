/**
 * One effect a page task. A frame that first draws several materials makes
 * each one's effect in its draw (`isReadyForSubMesh`), all in the frame's
 * own task: two to four PBR effects, 13 to 25 ms each on a phone, whose
 * shader modules reach the browser's GPU thread as one batch with the
 * frame's commands. That thread also presents a film's frames, between
 * batches: a batch of 97 to 120 ms dropped two or three of the intro's (a
 * Pixel 9, 2026-11-12), where the same modules a batch each (the effects
 * that wait for a shader's import already are: 20 to 80 ms) dropped none.
 * So the heavy effects (`SPACED_EFFECTS`) are made waiting, each for its
 * turn here, and the turns are a task apart: the frame that asks for four
 * draws on, with what its materials had, and the four are processed in the
 * four tasks after it.
 *
 * Only when an effect is processed changes, never whether, but for one that
 * nothing will draw: an effect disposed while it waited, or whose engine
 * was, is not processed at all (on a disposed engine that would be every
 * waiting effect at once, each translated again, its lookup gone). An
 * effect of any other name is made as it was, with the arguments given. A
 * PBR material draws with the effect it had while its new one waits, so the
 * scene's own check says ready meanwhile: what waits for a scene to be
 * ready also asks `effectsWaitingOn`.
 */

/** A queue that lets one waiter go a page task, first in, first out. */
export type EffectTurns = {
  /** Resolves in a task of its own, after every wait asked before it. */
  wait(): Promise<void>;
  /** Waiters not yet let go. */
  waiting(): number;
  /** Lets every waiter go at once, now and from now on. */
  dispose(): void;
};

/**
 * A task of the page's own for `run`: a message on a channel, which a
 * browser neither clamps to 4 ms as it does nested timers nor slows to once
 * a second in a hidden page; a timer where there is no channel.
 */
function taskTurns(): { turn(run: () => void): void; close(): void } {
  if (typeof MessageChannel === "undefined") return { turn: (run) => void setTimeout(run, 0), close: () => undefined };
  let channel: MessageChannel | null = null;
  const runs: (() => void)[] = [];
  return {
    turn(run) {
      if (channel === null) {
        channel = new MessageChannel();
        channel.port1.onmessage = () => runs.shift()?.();
      }
      runs.push(run);
      channel.port2.postMessage(0);
    },
    close() {
      channel?.port1.close();
      channel?.port2.close();
      channel = null;
      runs.length = 0;
    },
  };
}

/**
 * The queue. `turn(run)` asks for one turn: by default a task of the page's
 * own (`taskTurns`). One waiter goes a turn, and the next turn is asked for
 * only as it goes, so what a waiter does when let go (an effect's
 * processing) ends its task before the next waiter's begins.
 */
export function createEffectTurns(deps: { turn?: (run: () => void) => void } = {}): EffectTurns {
  const tasks = deps.turn === undefined ? taskTurns() : null;
  const turn = deps.turn ?? tasks!.turn;
  const waiters: (() => void)[] = [];
  let asked = false;
  let disposed = false;
  const ask = (): void => {
    if (asked || disposed || waiters.length === 0) return;
    asked = true;
    turn(() => {
      asked = false;
      if (disposed) return;
      waiters.shift()?.();
      ask();
    });
  };
  return {
    wait() {
      if (disposed) return Promise.resolve();
      return new Promise<void>((resolve) => {
        waiters.push(resolve);
        ask();
      });
    },
    waiting: () => waiters.length,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const go of waiters.splice(0)) go();
      tasks?.close();
    },
  };
}

/** The effects made waiting: Babylon's name for a PBR material's, the one whose fragment module is
 * tens of milliseconds on a phone's GPU thread. */
export const SPACED_EFFECTS: readonly string[] = ["pbr"];

/** An effect's options, as far as the spacing reads them (Babylon's `IEffectCreationOptions`). */
type WaitingOptions = { attributes?: unknown; extraInitializationsAsync?: unknown };

/** How many of an engine's effects are asked for and not yet let go, for each engine spaced. */
const waitingOn = new WeakMap<object, () => number>();

/**
 * How many of `engine`'s spaced effects were asked for and are not yet let
 * go: still waiting for their shader's import or for their turn. Nothing
 * else shows them: a material with an effect already draws with it, and
 * says it is ready, until the new one is. 0 for an engine that is not
 * spaced (WebGL2), and for anything that is not an engine.
 */
export function effectsWaitingOn(engine: unknown): number {
  return typeof engine === "object" && engine !== null ? (waitingOn.get(engine)?.() ?? 0) : 0;
}

/** A wait that never ends: what an effect nothing will draw is left on. */
const never = (): Promise<never> => new Promise<never>(() => undefined);

/**
 * Wraps `engine`'s own `createEffect`, on the instance. An effect whose name
 * is one of `names`, made from options (those with `attributes`, which is
 * how Babylon tells options from a list of names), waits its turn in `turns`
 * before it is processed, after the wait it was given where it was given
 * one (`extraInitializationsAsync`: its shader's import): it is made with a
 * copy of the options whose wait is both. The turn is asked for when the
 * effect waits, so an effect the engine already has, which it hands back,
 * takes none. When its turn comes, an effect that was disposed meanwhile,
 * or whose engine was, is left waiting for good and never processed. Any
 * other effect, and one made with the older list of arguments, is made with
 * the very arguments given. Returns a function that puts the engine's own
 * back, unless something else wrapped it since.
 */
export function spaceEffects(
  engine: { createEffect: (...args: never[]) => unknown },
  turns: EffectTurns,
  names: readonly string[] = SPACED_EFFECTS,
): () => void {
  const own = engine as { createEffect: (...args: unknown[]) => unknown; isDisposed?: boolean };
  const hadOwn = Object.hasOwn(own, "createEffect");
  const original = own.createEffect;
  // Nothing to wrap (not an engine that makes effects): left as it is.
  if (typeof original !== "function") return () => undefined;
  let pending = 0;
  waitingOn.set(engine, () => pending);
  const spaced = (...args: unknown[]): unknown => {
    const options = args[1] as WaitingOptions | null | undefined;
    if (options === null || options === undefined || options.attributes === undefined) return original.apply(engine, args);
    if (typeof args[0] !== "string" || !names.includes(args[0])) return original.apply(engine, args);
    const given = typeof options.extraInitializationsAsync === "function" ? (options.extraInitializationsAsync as () => Promise<void>) : null;
    const made: { effect?: { isDisposed?: boolean } } = {};
    const waiting = {
      ...options,
      extraInitializationsAsync: async (): Promise<void> => {
        pending++;
        try {
          if (given !== null) await given();
          await turns.wait();
        } finally {
          pending--;
        }
        if (own.isDisposed === true || made.effect?.isDisposed === true) await never();
      },
    };
    made.effect = original.apply(engine, [args[0], waiting, ...args.slice(2)]) as { isDisposed?: boolean };
    return made.effect;
  };
  own.createEffect = spaced;
  return () => {
    if (own.createEffect !== spaced) return;
    if (hadOwn) own.createEffect = original;
    else delete (own as { createEffect?: unknown }).createEffect;
  };
}
