// The engine's tests run under no game's identity: a neutral one is set before anything reads a
// key or a line. Day Hike's own tests run under Day Hike's (`client/test/setup/identity.ts`).
import { setGameIdentity } from "../../src/identity.js";

setGameIdentity({ title: "The Test Game", session: "round", player: "Guest", storage: "test" });
