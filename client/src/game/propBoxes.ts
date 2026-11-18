/**
 * The chunk props the simulation collides with, as the boxes drawn for
 * them: which chunks' props are drawn round a place, which of a chunk's
 * props are a box here and which are another shell's to draw, and a box's
 * mesh as plain arrays. What draws them (`lite/propMeshes.ts`) keeps the
 * meshes and the materials.
 * A hand-authored level's brushes are boxes of the same kind, in the same
 * colours by their materials' names (`brushBoxes`), drawn where a world has
 * no forest.
 *
 * Loads no engine: nothing here knows what a mesh is.
 */
import type { ChunkGrid } from "../sim/chunkGrid.js";
import { CHUNK_SIZE } from "../sim/forestConstants.js";

/** Props are drawn in a square of chunks this many either side of the chunk the place is in. */
export const PROP_MESH_RADIUS_CHUNKS = 3;

/**
 * The prop materials another shell draws, each by a mesh of its own: `trunk`,
 * the forest's tree the box belongs to; `rock`, the clutter's boulder, sited
 * by the same function over the same seed; `cliff`, the rock-wall module a
 * row of boxes belongs to; `car` and `kiosk`, the trailhead's SUV and kiosk
 * standing on those two boxes; `signpost`, the fingerpost that stands on it.
 * A box drawn here as well would stand as a flat-topped grey slab round each
 * of them: a collider's square footprint and peak-height top do not follow
 * the mesh's own silhouette.
 */
export const PROP_DRAWN_ELSEWHERE: ReadonlySet<string> = new Set(["trunk", "rock", "cliff", "car", "kiosk", "signpost"]);

/** A prop material's colour (linear), by name; `default` for a name with none of its own. */
export const PROP_COLOURS: Readonly<Record<string, readonly [number, number, number]>> = {
  concrete: [0.42, 0.44, 0.47],
  wall: [0.3, 0.32, 0.38],
  platform: [0.36, 0.42, 0.5],
  step: [0.4, 0.46, 0.54],
  crate: [0.55, 0.42, 0.26],
  pillar: [0.48, 0.36, 0.36],
  // The trailhead's car and kiosk, in the crate's and the pillar's colours
  // wherever their boxes are drawn.
  car: [0.55, 0.42, 0.26],
  kiosk: [0.48, 0.36, 0.36],
  signpost: [0.45, 0.33, 0.2],
  default: [0.5, 0.5, 0.5],
};

/** The colour of the prop material named `name`. */
export function propColour(name: string): readonly [number, number, number] {
  return PROP_COLOURS[name] ?? (PROP_COLOURS.default as readonly [number, number, number]);
}

/** A prop material's roughness: one value for every name, and nothing in this world is metal. */
export const PROP_ROUGHNESS = 0.9;

/** One prop drawn as a box: its mesh's name, its material's, where its middle stands and how large it is. */
export type PropBox = { name: string; material: string; x: number; y: number; z: number; width: number; height: number; depth: number };

/** The chunk a place is in. */
export function propChunk(x: number, z: number): [number, number] {
  return [Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE)];
}

/** A chunk's key among the chunks drawn. */
export function propChunkKey(cx: number, cz: number): string {
  return `${cx},${cz}`;
}

/** The chunks whose props are drawn round the chunk (cx, cz): the square, a row of x after another. */
export function propWindow(cx: number, cz: number): [number, number][] {
  const chunks: [number, number][] = [];
  for (let i = -PROP_MESH_RADIUS_CHUNKS; i <= PROP_MESH_RADIUS_CHUNKS; i++) {
    for (let j = -PROP_MESH_RADIUS_CHUNKS; j <= PROP_MESH_RADIUS_CHUNKS; j++) chunks.push([cx + i, cz + j]);
  }
  return chunks;
}

/** The boxes drawn for the chunk (cx, cz) of `grid`: every prop but those another shell draws, in the chunk's order. */
export function chunkPropBoxes(grid: ChunkGrid, cx: number, cz: number): PropBox[] {
  const boxes: PropBox[] = [];
  for (const [i, p] of grid.chunkAt(cx, cz).props.entries()) {
    if (PROP_DRAWN_ELSEWHERE.has(p.material)) continue;
    const width = p.box.max.x - p.box.min.x;
    const height = p.box.max.y - p.box.min.y;
    const depth = p.box.max.z - p.box.min.z;
    boxes.push({
      name: `prop_${cx}_${cz}_${i}_${p.material}`, material: p.material,
      x: p.box.min.x + width / 2, y: p.box.min.y + height / 2, z: p.box.min.z + depth / 2,
      width, height, depth,
    });
  }
  return boxes;
}

/** The six faces of a box: each its outward normal and the two axes its corners are laid along. */
const FACES: readonly (readonly [readonly [number, number, number], readonly [number, number, number], readonly [number, number, number]])[] = [
  [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
  [[0, 1, 0], [0, 0, 1], [1, 0, 0]],
  [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
  [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
  [[0, 0, -1], [0, 1, 0], [1, 0, 0]],
];

/**
 * A box as a mesh's arrays, standing where the prop stands: four vertices a
 * face with the face's normal, two triangles a face, each wound as
 * Babylon.js winds the boxes it builds (the turn from its first edge to its
 * second runs against the face's normal), so the face seen from outside is
 * the front.
 */
export function propBoxGeometry(box: PropBox): { positions: Float32Array; normals: Float32Array; indices: Uint32Array } {
  const positions = new Float32Array(72);
  const normals = new Float32Array(72);
  const indices = new Uint32Array(36);
  const half = [box.width / 2, box.height / 2, box.depth / 2];
  const centre = [box.x, box.y, box.z];
  FACES.forEach(([n, u, v], f) => {
    // The corners round the face: -u-v, +u-v, +u+v, -u+v.
    [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([su, sv], k) => {
      const at = (f * 4 + k) * 3;
      for (let a = 0; a < 3; a++) {
        positions[at + a] = (centre[a] as number) + (half[a] as number) * ((n[a] as number) + (su as number) * (u[a] as number) + (sv as number) * (v[a] as number));
        normals[at + a] = n[a] as number;
      }
    });
    indices.set([f * 4, f * 4 + 2, f * 4 + 1, f * 4, f * 4 + 3, f * 4 + 2], f * 6);
  });
  return { positions, normals, indices };
}

/** A hand-authored level's brushes as the boxes drawn for them, in the level's order: each its box's size, standing at its middle. */
export function brushBoxes(brushes: readonly { box: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } }; material: string }[]): PropBox[] {
  return brushes.map((brush, i) => {
    const width = brush.box.max.x - brush.box.min.x;
    const height = brush.box.max.y - brush.box.min.y;
    const depth = brush.box.max.z - brush.box.min.z;
    return {
      name: `brush_${i}`, material: brush.material,
      x: brush.box.min.x + width / 2, y: brush.box.min.y + height / 2, z: brush.box.min.z + depth / 2,
      width, height, depth,
    };
  });
}

/** Several boxes as one mesh's arrays (`propBoxGeometry`, a box after another). */
export function propBoxesGeometry(boxes: readonly PropBox[]): { positions: Float32Array; normals: Float32Array; indices: Uint32Array } {
  const positions = new Float32Array(boxes.length * 72);
  const normals = new Float32Array(boxes.length * 72);
  const indices = new Uint32Array(boxes.length * 36);
  for (const [b, box] of boxes.entries()) {
    const one = propBoxGeometry(box);
    positions.set(one.positions, b * 72);
    normals.set(one.normals, b * 72);
    for (let i = 0; i < 36; i++) indices[b * 36 + i] = (one.indices[i] as number) + b * 24;
  }
  return { positions, normals, indices };
}
