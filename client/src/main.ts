/**
 * Day Hike's entry: its shipped files and its terrain register, then the
 * engine's shell of the page starts with Day Hike as one definition
 * (`hikePageGame.ts`).
 */
// Day Hike's shipped files register as this is imported, before anything asks for one by name.
import "./game/dayhikeAssets.js";
// Day Hike's terrain registers as this is imported, before the world is read or prepared.
import "./sim/passes/index.js";
import { HIKE_PAGE } from "./hikePageGame.js";
import { startShell } from "@csarkosh/engine/shell";

startShell(HIKE_PAGE);
