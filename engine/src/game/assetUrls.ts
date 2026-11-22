/**
 * Where each shipped file is served from, as the game that ships it says. The engine's own
 * modules ask for a model, a texture or a clip by its catalog `output` ("models/<id>.glb") and
 * never know what the build renamed it to, or which folder it came from: a game registers its
 * files' addresses and its catalog once, as its page starts (`registerAssets`), and everything
 * resolves through that. Day Hike's are in `dayhikeAssets.ts`; the engine's own are in
 * `engineAssets.ts`, which a game merges with its own (`mergeAssets`).
 */

/** A catalog as the engine reads it: each shipped file's id, its `output` and its size where the export wrote one. */
export type AssetCatalog = { assets?: { id?: unknown; output?: unknown; bytes?: number }[] };

/** A game's shipped files: the address of each by its catalog `output`, and the catalog that describes them. */
export type AssetAddresses = {
  models: Readonly<Record<string, string>>;
  textures: Readonly<Record<string, string>>;
  audio: Readonly<Record<string, string>>;
  catalog: AssetCatalog;
};

/**
 * Several parts of a game's shipped files as one: the address maps joined (on a null prototype, so no
 * inherited name answers), and the catalog's sections joined section by section, each part's entries
 * after the last's, in the order the parts are given. A name two parts both hold is an error, naming it:
 * one file would otherwise silently stand in for the other.
 */
export function mergeAssets(...parts: AssetAddresses[]): AssetAddresses {
  const join = (pick: (part: AssetAddresses) => Readonly<Record<string, string>>): Record<string, string> => {
    const map: Record<string, string> = Object.create(null) as Record<string, string>;
    for (const part of parts) {
      for (const [name, url] of Object.entries(pick(part))) {
        if (name in map) throw new Error(`"${name}" is in two of the shipped files being merged: a name is one file's`);
        map[name] = url;
      }
    }
    return map;
  };
  const catalog: Record<string, unknown[]> = {};
  for (const part of parts) {
    for (const [section, entries] of Object.entries(part.catalog as Record<string, unknown>)) {
      if (Array.isArray(entries)) (catalog[section] ??= []).push(...entries);
    }
  }
  return { models: join((p) => p.models), textures: join((p) => p.textures), audio: join((p) => p.audio), catalog: catalog as AssetCatalog };
}

let registered: AssetAddresses | null = null;
let outputsByUrl: Map<string, string> | null = null;

/** Takes a game's shipped files as the ones every lookup below answers from. Once, before anything is loaded. */
export function registerAssets(addresses: AssetAddresses): void {
  registered = addresses;
  outputsByUrl = null;
}

function held(): AssetAddresses {
  if (registered === null) {
    throw new Error("no assets are registered: a game registers its shipped files (`registerAssets`) before anything asks for one");
  }
  return registered;
}

function modelOutputs(): Map<string, string> {
  outputsByUrl ??= new Map(Object.entries(held().models).map(([output, url]) => [url, output]));
  return outputsByUrl;
}

/** The registered catalog, for a module that reads more of an entry than its address. */
export function assetCatalog(): AssetCatalog {
  return held().catalog;
}

/**
 * Bytes of a shipped asset by its catalog `output`, where the export wrote
 * them (`bytes` on the entry); undefined for an entry without them. The
 * loading bar weighs the download by these before the first byte lands.
 */
export function assetBytes(output: string): number | undefined {
  const entry = (held().catalog.assets ?? []).find((a) => a.output === output);
  return entry?.bytes;
}

/** The same bytes for the model served at `url` (`modelUrl`'s answer); undefined for a URL that is no shipped model's. */
export function modelBytes(url: string): number | undefined {
  const output = modelOutputs().get(url);
  return output === undefined ? undefined : assetBytes(output);
}

export function modelUrl(output: string): string {
  const url = Object.hasOwn(held().models, output) ? held().models[output] : undefined;
  if (url === undefined) {
    throw new Error(
      `unknown model "${output}". It must exist both as a shipped file at ` +
        `assets/${output} of the game that registered its files and as an \`output\` in that game's catalog.json.`,
    );
  }
  return url;
}

/**
 * The same resolution for a bark texture ("textures/bark.<set>.<size>.ktx2",
 * `barkOutputs` in `barkParams.ts`) or the moss map (`MOSS_OUTPUT` in
 * `mossParams.ts`), with the same throw: a set the build does not ship is a
 * startup error, not a trunk left in its file's bark with a 404 in the
 * console.
 */
export function textureUrl(output: string): string {
  const url = Object.hasOwn(held().textures, output) ? held().textures[output] : undefined;
  if (url === undefined) {
    throw new Error(
      `unknown texture "${output}". It must exist both as a shipped file at ` +
        `assets/${output} of the game that registered its files and as a \`textures\` entry in that game's catalog.json.`,
    );
  }
  return url;
}

/**
 * The same resolution for a wildlife call clip ("audio/<id>.mp3").
 *
 * Throws the same way for the same reason — but here the throw is also the
 * ordinary path while recordings are still landing: no clip is
 * committed until it is ready, and the
 * game must run, silently, in the meantime. `wildlifeAudio.ts` therefore catches
 * it per clip. Anything else calling this wants the same guarantee `modelUrl`
 * gives: a typo is a startup error, not a 404 the browser swallows.
 */
export function audioUrl(output: string): string {
  const url = Object.hasOwn(held().audio, output) ? held().audio[output] : undefined;
  if (url === undefined) {
    throw new Error(
      `unknown audio clip "${output}". It must exist both as a shipped file at ` +
        `assets/${output} of the game that registered its files and as an \`audio\` entry in that game's catalog.json.`,
    );
  }
  return url;
}
