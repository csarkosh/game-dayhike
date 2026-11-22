/**
 * The credits the Credits screen and the page for those turned away show: Day Hike's own, the
 * repository's CREDITS.md imported at build time, and the engine's (`ENGINE_CREDITS`, the
 * `CREDITS.md` of the package), the works the engine ships. The two lists are merged in the order of
 * their ids, a stable sort by plain comparison of the ids, which is the order the one list had when
 * the works stood in a single file; then the display pass (`creditsRows`) runs over the whole.
 */
import credits from "../../../CREDITS.md?raw";
import { creditsModel, creditsRows, type CreditEntry } from "@csarkosh/engine/game/credits";
import { ENGINE_CREDITS } from "@csarkosh/engine/game/engineCredits";

export function creditsEntries(): CreditEntry[] {
  const merged = [...creditsModel(credits), ...creditsModel(ENGINE_CREDITS)];
  return creditsRows(merged.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)));
}
