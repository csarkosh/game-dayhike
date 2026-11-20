/**
 * The sea's edge on the cove, stepped with no engine
 * (`docs/rendering/2026-10-08-sea-edge-design.md`): the cove as the swash,
 * the breaker and the shaders read it, the swash's table and the breaker's
 * tracker on the swell the sea draws, and the frame's phases of that swell.
 * Everything here moves on the sea's shared seconds. Whoever draws the sea
 * steps it once a frame; the sea's sheet, the wet ground and the surf's
 * sound all read the same table and tracker.
 */
import { COVE_FACE_GRADE, COVE_TOE_DEPTH, coveFor } from "../sim/olympic.js";
import { LipTracker } from "./oceanBreaker.js";
import { SWELL_COMPONENTS } from "./oceanSwell.js";
import { coastProfilesFor } from "./oceanTables.js";
import { swellPhases, type OceanField } from "./oceanWaves.js";
import { SwashTable, type SwashCove } from "./swashTable.js";

/** The cove `seed`'s sea runs up: its centre and half-width along z, the face's toe and grade, and the coastline's x. */
export function swashCoveFor(seed: number): SwashCove {
  const profiles = coastProfilesFor(seed);
  const coveOf = coveFor(seed);
  return {
    z0: coveOf.z0,
    halfWidth: coveOf.halfWidth,
    toeD: -COVE_TOE_DEPTH / COVE_FACE_GRADE,
    faceGrade: COVE_FACE_GRADE,
    coastX: (z) => profiles.coastlineX(z),
  };
}

export type SeaEdgeStep = {
  /** The cove as the swash, the breaker and the shaders read it. */
  readonly cove: SwashCove;
  /** The swash's run-up a metre of shore, refilled by `step`. */
  readonly table: SwashTable;
  /** The plunging crests and this frame's plunges. */
  readonly tracker: LipTracker;
  /** Whether the table holds its first fill: until then the sea draws no
   * sheet, the wet ground keeps its still line and the surf is silent. */
  readonly filled: boolean;
  /**
   * A frame at the shared `seconds`, under the onshore weight the sea's
   * wind has this frame (`OceanNumbers.windDir[3]`).
   */
  step(seconds: number, onshoreWeight: number): void;
};

/** The edge of world `seed`'s sea on the swell `field`. */
export function createSeaEdgeStep(seed: number, field: OceanField): SeaEdgeStep {
  const cove = swashCoveFor(seed);
  const table = new SwashTable(field, cove);
  const tracker = new LipTracker(field, cove);
  // The frame's phases of the sea's swell: made once, refilled.
  const phases = new Float32Array(SWELL_COMPONENTS);
  let filled = false;
  return {
    cove,
    table,
    tracker,
    get filled() {
      return filled;
    },
    step(seconds, onshoreWeight) {
      swellPhases(field, seconds, phases);
      table.update(seconds, phases);
      tracker.update(seconds, phases, onshoreWeight);
      filled = true;
    },
  };
}
