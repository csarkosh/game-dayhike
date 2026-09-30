/**
 * The title page's backdrop: one still frame of the film, or nothing. No
 * renderer, no model, no ground map and no shader map load before Play; the
 * page is the still, the roster and its buttons, so a first visit is light
 * and the big download waits for the decision to play.
 */
export function landingBackdrop(still: string | null): HTMLImageElement | null {
  if (still === null) return null;
  const img = document.createElement("img");
  img.className = "landing-bg ready";
  img.setAttribute("src", still);
  img.setAttribute("alt", "");
  img.setAttribute("decoding", "async");
  return img;
}
