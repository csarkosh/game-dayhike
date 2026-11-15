/**
 * Where each of the hike's meshes stands among the opaque draws on Babylon
 * Lite: a place a material, named, so the order of the draws is the same
 * however the meshes came to stand in the scene.
 *
 * Lite draws the opaque meshes of one place (`Mesh.renderOrder`; its own for
 * an opaque mesh is 100) grouped by pipeline, the pipelines in the order it
 * first compared them, which follows the moment each mesh joined the scene:
 * a model that landed a frame sooner, a set of patches shown as a job. Its
 * depth test passes at an equal depth, so where two surfaces lie at one
 * depth the later draw is the one seen: the trunk of a tree drawn at two
 * levels of detail across their hand-off, two patches along the edge they
 * share. Left to that order, the same view came out a few pixels apart from
 * one page to the next.
 *
 * So every shell places its materials: the terrain first, as it always
 * stood, then each shell in the order below, and within a shell its
 * materials in the order its code makes them, which no load's timing
 * changes. A mesh takes its material's place. The sky's dome is drawn last
 * of all: it lies behind everything, so where something nearer has drawn,
 * the depth test passes its pixels over.
 *
 * Loads nothing.
 */

/** Each shell's first place. A shell's own run on from it by less than one. */
export const DRAW_ORDER = { rings: 80, patches: 90, forest: 100, clutter: 110, blades: 120, duff: 130, cliffs: 140, props: 150, sky: 160 } as const;

/** The places a shell has past its first. */
export const DRAW_PLACES = 1024;

export type DrawOrders = {
  /** Gives `material` the place after the last one taken. */
  take(material: object): void;
  /** Gives `material` the shell's `n`th place, whenever it is made: for one made when something lands. */
  put(material: object, n: number): void;
  /** The place of `material`; undefined for one never placed, which Lite places itself. */
  of(material: object): number | undefined;
};

/** A shell's places, from `first` on. */
export function createDrawOrders(first: number): DrawOrders {
  const places = new Map<object, number>();
  let taken = 0;
  const at = (n: number): number => {
    if (n < 0 || n >= DRAW_PLACES) throw new Error(`a shell has ${DRAW_PLACES} places among the draws: ${n} is not one`);
    return first + n / DRAW_PLACES;
  };
  return {
    take(material) {
      places.set(material, at(taken++));
    },
    put(material, n) {
      places.set(material, at(n));
    },
    of: (material) => places.get(material),
  };
}
