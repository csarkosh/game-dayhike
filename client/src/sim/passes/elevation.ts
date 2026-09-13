import { CELLS_PER_CHUNK, cellCenter, quantize, registerPass } from "../chunk.js";
import { activeTerrainVariant } from "../terrain.js";
import { HEIGHT_QUANTUM, TERRAIN_CELL } from "../forestConstants.js";

/**
 * Pass 1. Samples the active terrain variant's continuous field at each cell
 * centre and stores it quantized. Needs no RNG stream: the field is already a
 * pure function of world coordinates.
 *
 * `tunables` is a getter, deliberately: it must reflect the variant that is
 * active at digest time, not at registration time — `/terrain` swaps variants
 * long after this module was imported. This is how "the variant name and every
 * pipeline constant fold into the level id" is honoured: the
 * registry digest reads these values, and `forest.ts` keys its cache on the
 * active variant's name.
 */
registerPass({
  id: 1,
  name: "elevation",
  get tunables() {
    return { ...activeTerrainVariant().tunables, HEIGHT_QUANTUM, TERRAIN_CELL };
  },
  run(chunk, worldSeed) {
    const variant = activeTerrainVariant();
    for (let iz = 0; iz < CELLS_PER_CHUNK; iz++) {
      for (let ix = 0; ix < CELLS_PER_CHUNK; ix++) {
        const { x, z } = cellCenter(chunk, ix, iz);
        chunk.columns[iz * CELLS_PER_CHUNK + ix] = quantize(variant.sample(worldSeed, x, z).h);
      }
    }
  },
});
