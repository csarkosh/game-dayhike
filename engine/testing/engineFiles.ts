import { fileURLToPath } from "node:url";

/**
 * The engine's catalog of its own shipped files (`assets/catalog.json`), read from the package it
 * sits in, so a game's tests name it without a path into the engine's folder.
 */
export { default as engineCatalog } from "../assets/catalog.json" with { type: "json" };

/**
 * The file-system path of one of the engine's shipped files, by its path within the package
 * (`"assets/models/tree.alder.glb"`, `"public/libs/ktx2/zstddec.wasm"`). It is resolved from this
 * module's own location, so it is right whether the engine is the folder beside the game or an
 * installed package. A path that leaves the package (`..`) throws.
 */
export function engineFile(path: string): string {
  if (path.split(/[\\/]/).includes("..")) throw new Error(`"${path}" leaves the engine's package.`);
  return fileURLToPath(new URL("../" + path, import.meta.url));
}
