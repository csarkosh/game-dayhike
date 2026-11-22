/**
 * The empty game's entry: the engine's shipped files and its terrain
 * register, then the engine's shell of the page starts with the empty game
 * as one definition (`page.ts`).
 */
import "./assets.js";
import "./terrain.js";
import { startShell } from "@csarkosh/engine/shell";
import { EMPTY_PAGE } from "./page.js";

startShell(EMPTY_PAGE);
