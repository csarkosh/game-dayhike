/**
 * Fetches the forest's birdsong bed and hands it to the ambient graph once
 * that has a context to decode it on. Either can come first, the bytes or
 * the unlock; a bed that is missing or that the browser refuses is silence,
 * and the game runs without it.
 */
import type { AmbientAudio } from "./ambientAudio.js";
import { audioUrl } from "./assetUrls.js";

export const BIRD_BED_CLIP = "audio/ambience.forest_birds.mp3";

export type BirdBedOptions = {
  /** Injected by the tests; production fetches the hashed URL Vite serves. */
  fetchBed?: () => Promise<ArrayBuffer>;
};

/** Resolves once the bed is playing or has been given up on. */
export function loadBirdBed(
  ambient: Pick<AmbientAudio, "decode" | "onUnlock" | "setBirdBed">,
  options: BirdBedOptions = {},
): Promise<void> {
  const fetchBed = options.fetchBed ?? (async () => {
    const response = await fetch(audioUrl(BIRD_BED_CLIP));
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.arrayBuffer();
  });
  return new Promise((resolve) => {
    fetchBed().then(
      (bytes) => ambient.onUnlock(() => {
        void ambient.decode(bytes).then((buffer) => {
          if (buffer !== null) ambient.setBirdBed(buffer);
          resolve();
        });
      }),
      (e: unknown) => {
        console.warn(`birdsong bed: ${e instanceof Error ? e.message : String(e)}`);
        resolve();
      },
    );
  });
}
