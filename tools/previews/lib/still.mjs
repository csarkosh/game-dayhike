// The pure parts of the README stills: the link that puts the free camera at a still's place
// under the conditions the game opens with, and the PNG stripped of what a still must not carry.

/** The page's `?cmd=` script for a still: its world, the camera at its place, and the day held
 * where the game starts it (`escalation 0`, `unsettle 0`). No `time` or `weather`: the hour and
 * the sky are the game's own defaults, so a still follows the game when those change. */
export function stillScript(still) {
  return `seed ${still.seed};freecam ${still.x} ${still.z} ${still.yaw};escalation 0;unsettle 0`;
}

/** The URL that opens a still's view on `base` (the dev server or the live site, with the game's
 * path under it), on `tier` so every still is the same quality, with `telemetry=off` so a shoot
 * never reaches the admin page's matches as a party that never said goodbye. */
export function stillUrl(base, config, still) {
  const root = base.replace(/\/+$/, "");
  const cmd = encodeURIComponent(stillScript(still)).replace(/%3B/g, ";");
  return `${root}/game/${config.game}?cmd=${cmd}&tier=${config.tier}&telemetry=off`;
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** The chunks a still keeps: the image and nothing about where or how it was made. */
const KEEP = new Set(["IHDR", "PLTE", "IDAT", "IEND"]);

/** The PNG with every ancillary chunk dropped (`tEXt`, `eXIf`, `tIME`, colour profiles and
 * the rest), the way the pre-push leak scan wants a committed image. */
export function stripPng(bytes) {
  if (bytes.length < 8 || !bytes.subarray(0, 8).equals(SIGNATURE)) throw new Error("not a PNG");
  const parts = [bytes.subarray(0, 8)];
  let at = 8;
  while (at + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(at);
    const type = bytes.toString("latin1", at + 4, at + 8);
    const end = at + 12 + length;
    if (end > bytes.length) throw new Error(`truncated ${type} chunk`);
    if (KEEP.has(type)) parts.push(bytes.subarray(at, end));
    at = end;
  }
  return Buffer.concat(parts);
}
