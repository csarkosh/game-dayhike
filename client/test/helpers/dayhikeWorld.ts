// Day Hike's world for every test file: the coast with the mountain laid over it, and every
// world pass. A test that resets the module registry imports `src/sim/passes/index.js` again
// for itself, as a new thread would.
import "../../src/sim/passes/index.js";
