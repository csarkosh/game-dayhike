/**
 * FNV-1a over a token, giving the 32-bit seed the world is generated from.
 *
 * Shared by two callers that must agree: the room id, which is the default
 * token, and an explicit `seed` entry in the `?cmd=` script. Hashing rather than
 * parsing is what lets a seed be a memorable word — `epic-panda-fun` survives
 * being read back to yourself after twenty minutes of flying where `1547823`
 * does not — and it keeps the level id a fixed size whatever the token's length.
 */
export function seedFromToken(token: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < token.length; i++) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash | 0;
}
