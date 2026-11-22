/**
 * Day Hike's own credits: the repository's CREDITS.md, imported at build time, as the Credits
 * screen and the page for those turned away show it.
 */
import credits from "../../../CREDITS.md?raw";
import { creditsModel, creditsRows, type CreditEntry } from "@csarkosh/engine/game/credits";

export function creditsEntries(): CreditEntry[] {
  return creditsRows(creditsModel(credits));
}
