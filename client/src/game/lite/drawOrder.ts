/**
 * Where each of the hike's meshes stands among the draws on Babylon Lite: a
 * place a material, named, so the order of the draws is the same however
 * the meshes came to stand in the scene. The opaque draws first
 * (`DRAW_ORDER`), then the see-through ones (`SEE_THROUGH_ORDER`).
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
export const DRAW_ORDER = { rings: 80, patches: 90, forest: 100, clutter: 110, blades: 120, duff: 130, cliffs: 140, props: 150, bodies: 152, cap: 154, animals: 156, waterPlants: 158, sky: 160 } as const;

/**
 * The places of the see-through draws, which follow every opaque one and the
 * sky: what is blended over the frame, tested against its depth and never
 * written to it.
 *
 * Lite sorts its blended draws every frame, farthest first by the depth of
 * each mesh's own origin in the view, and only two at the same depth by
 * their places. A mesh of the hike's see-through effects is an instance list
 * or a field round the eye, whose origin says nothing of where it is seen;
 * so each stands at the world's origin, all at one depth, and their places
 * alone order them, the same from every view. The order is the game's on
 * Babylon.js, which draws a rendering group's particles before its blended
 * meshes: the motes, then the mist banks, which order themselves farthest
 * first within their one draw (`mistBanks.ts`), then the rain, which the
 * game puts last of its group as the nearest blended volume (`rain.ts`):
 * the splashes, then the drips and the streaks, one draw whose instances
 * are in that order (`rainField.ts`).
 *
 * Then the water the tiers blend over what lies under it. The game leaves
 * a lake's surface and the sea's rings at Babylon.js's default place among
 * the blended meshes, which is past the rain's, so the rain is blended
 * first and the water over it: a streak falling in front of deep water is
 * covered by it. The sea first, its rings outermost first within its one
 * draw, then the lakes, which stand over it: no ray meets both, so either
 * order draws the same. Each surface's vertices are laid in the world's
 * own coordinates, or placed there by its vertex stage, so that it stands
 * at the origin with the rest, and its place says the same from every
 * view. The plunging lip's swept curl follows the sea, over the surface its
 * feet lie on; the game draws both without blending on the tier that has
 * the curl, each tested against the other's depth. Then the surf's spray,
 * which the game puts after the sea and every other blended mesh.
 *
 * Then a lake's insects, which the game gives the highest index of all:
 * the midges' one draw, then the dragonflies', a kind a draw. And last, on
 * the tiers with no post chain, the shade veil, which the game draws over
 * the finished frame (`shadeVeil.ts`).
 */
export const SEE_THROUGH_ORDER = { eyes: 190, motes: 200, mist: 210, splashes: 220, rain: 230, sea: 238, lip: 239, water: 240, spray: 244, midges: 250, dragonflies: 252, veil: 260 } as const; // The Hollows' eyes first: the air's veils are laid over them (`entityMeshes.ts`).

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
