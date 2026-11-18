/**
 * When a renderer's pipelines have settled: a frame drawn that asked the
 * device for nothing, with no pipeline asked for off the page's thread
 * still compiling.
 *
 * While a hike loads its renderer asks for its pipelines off the page's
 * thread (a mesh is left out of the frame until its pipeline is ready), and
 * a pipeline is asked for only when a frame first draws what needs it. So
 * "nothing compiling" says nothing until a frame has been drawn since the
 * last mesh joined, and a pipeline that lands is drawn with only from the
 * frame after. A world is whole once a frame is drawn that asked for
 * nothing and found nothing landed, and nothing is compiling after it.
 *
 * No engine: the renderer tells each frame it draws (`drawn`), and hands in
 * how many pipelines are compiling and a wait for them.
 */

export type DrawnFrames = {
  /** A frame was drawn: `asked` where it asked the device for a module or a pipeline, or one asked for earlier landed by it. */
  drawn(asked: boolean): void;
  /** The next frame drawn: whether it asked. */
  next(): Promise<boolean>;
};

export function createDrawnFrames(): DrawnFrames {
  let waiting: ((asked: boolean) => void)[] = [];
  return {
    drawn(asked) {
      if (waiting.length === 0) return;
      const told = waiting;
      waiting = [];
      for (const tell of told) tell(asked);
    },
    next() {
      return new Promise((resolve) => void waiting.push(resolve));
    },
  };
}

/**
 * Resolves after the first frame drawn that asked for nothing while
 * `compiling()` is none; between frames that did not, waits for `idle()`
 * (the pipelines compiling) before it looks at the next frame. It never
 * resolves while no frame is drawn: whoever waits on it bounds the wait.
 */
export async function whenDrawnSettled(frames: Pick<DrawnFrames, "next">, compiling: () => number, idle: () => Promise<void>): Promise<void> {
  for (;;) {
    const asked = await frames.next();
    if (!asked && compiling() === 0) return;
    await idle();
  }
}
