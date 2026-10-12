/**
 * The trail builder off the page's thread (`trail.ts`): one request in, one
 * trail out. The sim's generation is half a second of arithmetic the page
 * should not stall on.
 */

import { buildTrailFor, type TrailAnswer, type TrailRequest } from "./trail.js";

self.onmessage = (event: MessageEvent<TrailRequest>) => {
  const { world, seed } = event.data;
  let trail = null;
  try {
    trail = buildTrailFor(world, seed);
  } catch {
    trail = null;
  }
  const answer: TrailAnswer = { world, seed, trail };
  self.postMessage(answer);
};
