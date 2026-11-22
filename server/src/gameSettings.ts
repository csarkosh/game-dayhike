/**
 * Which game this server serves: the few facts about it the server needs,
 * read at start from a file of the game's (`server/game.json`), so the code
 * itself names no game.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type GameSettings = {
  /** The id this game's numbers carry on the shared admin host (the `app` of the index card). */
  app: string;
  /** The BigQuery dataset read where `TELEMETRY_DATASET` names none. */
  telemetryDataset: string;
  /** The log bucket the saved queries name in their table, `<project>.global.<bucket>._AllLogs`. */
  telemetryBucket: string;
  /**
   * The origins a browser may reach the server from, where `ALLOWED_ORIGINS`
   * names none. They are the origins the browser build is actually served from.
   * Firebase provisions the two default hostnames alongside the custom domain
   * and all three serve the same bundle, so a player who reaches the game by
   * any of them must be able to signal. `localhost:5173` is Vite: in
   * development the page and the socket share that origin because Vite
   * proxies `/ws` through to this server, so what arrives here is the dev
   * server's origin rather than `localhost:8080`. The desktop shell
   * (`desktop/main.cjs`) loads the site itself, so its origin is the first
   * entry. `game.csarko.sh` now serves only the redirect page, so nothing new
   * opens a socket from it; it stays listed for web tabs still holding the old
   * bundle at the old origin and can go at a later server deploy. The admin
   * page (`client/src/admin/`) is served from the shared admin host (csarko.sh's
   * `admin/`) and reads this server's `/admin/*` routes cross-origin, so its
   * origin (`https://admin.csarko.sh`) has to be listed for the routes' CORS
   * check (`admin.ts` reads this same list); the bearer token it sends makes
   * the browser preflight each request. The last, `http://localhost:8788`, is
   * that shell's local preview, so the page can be worked on against
   * production. Neither opens a socket.
   */
  allowedOrigins: readonly string[];
};

/** What a bucket or dataset name may hold: it goes into a regular expression and into SQL identifiers. */
const NAME = /^[A-Za-z0-9_-]+$/;

function isOrigin(value: string): boolean {
  try {
    return new URL(value).origin === value;
  } catch {
    return false;
  }
}

/** The settings from the file's text; any failure throws, naming `from` and the field. */
export function parseGameSettings(text: string, from: string): GameSettings {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new Error(`${from}: not JSON (${error instanceof Error ? error.message : String(error)})`);
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error(`${from}: not an object`);
  const object = raw as Record<string, unknown>;
  const text_ = (field: string): string => {
    const value = object[field];
    if (typeof value !== "string" || value === "") throw new Error(`${from}: "${field}" must be a non-empty string`);
    return value;
  };
  const app = text_("app");
  const telemetryDataset = text_("telemetryDataset");
  const telemetryBucket = text_("telemetryBucket");
  for (const [field, value] of [["telemetryDataset", telemetryDataset], ["telemetryBucket", telemetryBucket]] as const) {
    if (!NAME.test(value)) throw new Error(`${from}: "${field}" may hold only letters, digits, "_" and "-": "${value}"`);
  }
  const origins = object.allowedOrigins;
  if (!Array.isArray(origins) || origins.length === 0) throw new Error(`${from}: "allowedOrigins" must be a non-empty array`);
  for (const origin of origins) {
    if (typeof origin !== "string" || !isOrigin(origin)) throw new Error(`${from}: "allowedOrigins" holds a value that is not an origin: ${JSON.stringify(origin)}`);
  }
  return { app, telemetryDataset, telemetryBucket, allowedOrigins: origins as string[] };
}

/**
 * The settings file: `GAME_SETTINGS`'s path when set, else `game.json` one
 * level above this module, which is `server/game.json` whether it runs from
 * `server/src/` or from the image's `server/dist/`.
 */
export function loadGameSettings(path?: string): GameSettings {
  const file = path ?? (process.env.GAME_SETTINGS || join(dirname(fileURLToPath(import.meta.url)), "..", "game.json"));
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    throw new Error(`game settings file not readable: ${file} (${error instanceof Error ? error.message : String(error)})`);
  }
  return parseGameSettings(text, file);
}
