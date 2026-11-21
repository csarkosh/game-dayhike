/**
 * A renderer's wait for its world, as the hike's renderer answers
 * `Renderer.whenReady`: the world's being in, or the bound of whoever put a
 * cover up, whichever comes first. A world that never comes in (a model
 * that never arrives) holds the cover the bound and no longer; one whose
 * coming in fails is waited for the bound. No engine: the renderer hands in
 * what says its world is in.
 */
export function whenWorldIn(worldIn: Promise<unknown>, maxMs: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const bound = setTimeout(resolve, Math.max(0, maxMs));
    void worldIn.then(() => {
      clearTimeout(bound);
      resolve();
    });
  });
}
