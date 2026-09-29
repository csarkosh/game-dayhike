import { nextRandom } from "./types.js";

/**
 * The missing hikers' names, drawn from two fixed tables by the world seed so
 * every peer reads the same poster. Plain, period-neutral names: the poster is
 * a real trailhead's, not a horror prop.
 */
export const FIRST_NAMES: readonly string[] = [
  "Dana", "Ruth", "Owen", "Miles", "Clara", "Elias", "June", "Theo", "Nora", "Hugh",
  "Iris", "Silas", "Mara", "Reuben", "Tessa", "Abel", "Wren", "Cyrus", "Lena", "Jonah",
  "Ada", "Felix", "Greta", "Amos", "Ines", "Rafe", "Sylvie", "Boyd", "Edith", "Callum",
  "Maeve", "Ansel",
];
/**
 * The missing hiker's first name is drawn from these: the men's names of
 * FIRST_NAMES, in their order there. The hiker is one man, whose photograph
 * is on the poster and whose body is at the crest, so the name on the poster
 * is a man's. Places are named from the whole table.
 */
export const HIKER_FIRST_NAMES: readonly string[] = [
  "Owen", "Miles", "Elias", "Theo", "Hugh", "Silas", "Reuben", "Abel",
  "Cyrus", "Jonah", "Felix", "Amos", "Rafe", "Boyd", "Callum", "Ansel",
];
export const LAST_NAMES: readonly string[] = [
  "Whitcombe", "Harlan", "Petersen", "Okafor", "Lindqvist", "Marsh", "Delacroix", "Reyes",
  "Thornbury", "Kowalski", "Abernathy", "Nakamura", "Fenwick", "Oyelaran", "Castellano", "Brandt",
  "Halvorsen", "Mbeki", "Ashdown", "Ferreira", "Quennell", "Tanaka", "Voss", "Ellery",
  "Ibarra", "Rostova", "Gallagher", "Sato", "Whitlock", "Duran", "Kessler", "Pryor",
];

const NAME_SALT = 0x4e414d45;

/** `count` names, first and last, no surname repeated. Deterministic in `seed`. */
export function hikerNames(seed: number, count: number): string[] {
  const rng = { rngSeed: (seed ^ NAME_SALT) | 0 };
  const lasts = [...LAST_NAMES];
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const first = HIKER_FIRST_NAMES[Math.floor(nextRandom(rng) * HIKER_FIRST_NAMES.length)] as string;
    const at = Math.floor(nextRandom(rng) * lasts.length);
    const last = lasts.splice(at, 1)[0] as string;
    out.push(`${first} ${last}`);
  }
  return out;
}
