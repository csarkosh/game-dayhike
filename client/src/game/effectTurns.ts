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
 * Only when an effect is processed changes, never whether. An effect of any
 * other name is ready in the call that made it, as it was, and a queue that
 * is disposed lets everything go.
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

/** The effects made waiting whatever they were given: Babylon's name for a PBR material's, the one
 * whose fragment module is tens of milliseconds on a phone's GPU thread. */
export const SPACED_EFFECTS: readonly string[] = ["pbr"];

/** An effect's options, as far as the spacing reads them (Babylon's `IEffectCreationOptions`). */
type WaitingOptions = { attributes?: unknown; extraInitializationsAsync?: unknown };

/**
 * Wraps `engine`'s own `createEffect`, on the instance. An effect made from
 * options (those with `attributes`, which is how Babylon tells options from
 * a list of names) waits its turn in `turns` before it is processed where
 * its name is one of `names`, or where it was given a wait of its own
 * (`extraInitializationsAsync`: a shader's import), which it waits for
 * first: it is made with a copy of the options whose wait is both. The turn
 * is asked for when the effect waits, so an effect the engine already has,
 * which it hands back, takes none. Any other effect, and one made with the
 * older list of arguments, is made with the very arguments given, ready as
 * soon as it was. Returns a function that puts the engine's own back,
 * unless something else wrapped it since.
 */
export function spaceEffects(
  engine: { createEffect: (...args: never[]) => unknown },
  turns: EffectTurns,
  names: readonly string[] = SPACED_EFFECTS,
): () => void {
  const own = engine as { createEffect: (...args: unknown[]) => unknown };
  const hadOwn = Object.hasOwn(own, "createEffect");
  const original = own.createEffect;
  const spaced = (...args: unknown[]): unknown => {
    const options = args[1] as WaitingOptions | null | undefined;
    if (options === null || options === undefined || options.attributes === undefined) return original.apply(engine, args);
    const given = typeof options.extraInitializationsAsync === "function" ? (options.extraInitializationsAsync as () => Promise<void>) : null;
    const named = typeof args[0] === "string" && names.includes(args[0]);
    if (given === null && !named) return original.apply(engine, args);
    const waiting = {
      ...options,
      extraInitializationsAsync: async (): Promise<void> => {
        if (given !== null) await given();
        await turns.wait();
      },
    };
    return original.apply(engine, [args[0], waiting, ...args.slice(2)]);
  };
  own.createEffect = spaced;
  return () => {
    if (own.createEffect !== spaced) return;
    if (hadOwn) own.createEffect = original;
    else delete (own as { createEffect?: unknown }).createEffect;
  };
}
