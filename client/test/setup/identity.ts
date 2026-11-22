// Day Hike's tests run as Day Hike's page does, with its identity set before
// anything reads a key or a line.
import { setGameIdentity } from "@csarkosh/engine/identity";
import { HIKE_IDENTITY } from "../../src/hikeIdentity.js";

setGameIdentity(HIKE_IDENTITY);
