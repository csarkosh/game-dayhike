import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture.js";
import { loadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader.js";
import { registerBuiltInLoaders } from "@babylonjs/loaders/dynamic.js";
import {
  clipNameFor,
  createCharacterPool,
  pickClip,
  resolveCharacterAssets,
  variantForId,
  attachSkinToContainer,
  type CharacterAsset,
  type CharacterLoader,
  type ClipKind,
} from "../../src/game/characterModel.js";
import { modelUrl } from "../../src/game/assetUrls.js";
import catalog from "../../assets/catalog.json" with { type: "json" };

describe("pickClip", () => {
  it("matches exact names", () => {
    expect(pickClip(["Idle", "Walk", "Attack", "Death"], "walk")).toBe("Walk");
  });

  it("is case insensitive", () => {
    expect(pickClip(["IDLE", "WALKING"], "idle")).toBe("IDLE");
  });

  it("matches common synonyms for walking", () => {
    expect(pickClip(["Armature|Run_Forward", "Armature|Idle"], "walk")).toBe("Armature|Run_Forward");
  });

  it("matches common synonyms for death", () => {
    expect(pickClip(["Idle", "Die_01"], "death")).toBe("Die_01");
    expect(pickClip(["Idle", "CharacterArmature|Death"], "death")).toBe("CharacterArmature|Death");
  });

  it("matches prefixed exporter names", () => {
    expect(pickClip(["CharacterArmature|Attack_01", "CharacterArmature|Idle"], "attack")).toBe(
      "CharacterArmature|Attack_01",
    );
  });

  it("returns null when nothing matches", () => {
    expect(pickClip(["Dance", "Wave"], "attack")).toBeNull();
  });

  it("returns null for an empty list", () => {
    expect(pickClip([], "idle")).toBeNull();
  });

  it("prefers a more specific match over a substring collision", () => {
    // "Death" contains no walk synonym; "Walk" must not be found in it.
    expect(pickClip(["Death"], "walk")).toBeNull();
  });
});

describe("resolveCharacterAssets", () => {
  const identityUrl = (output: string): string => `/served/${output}`;
  const mixed = {
    assets: [
      {
        id: "ranger.one",
        kind: "character",
        output: "models/ranger.one.glb",
        animations: { idle: "idle", walk: "walk", attack: "attack", death: "death" },
      },
      { id: "crate", kind: "prop", output: "models/crate.glb" },
      {
        id: "ranger.two",
        kind: "character",
        output: "models/ranger.two.glb",
        animations: { idle: "Stand", walk: "Stroll" },
      },
    ],
  };

  it("returns every character entry, in catalog order", () => {
    expect(resolveCharacterAssets(mixed, identityUrl).map((a) => a.id)).toEqual(["ranger.one", "ranger.two"]);
  });

  it("resolves each URL from that entry's own output path", () => {
    expect(resolveCharacterAssets(mixed, identityUrl).map((a) => a.url)).toEqual([
      "/served/models/ranger.one.glb",
      "/served/models/ranger.two.glb",
    ]);
    expect(resolveCharacterAssets(mixed, identityUrl).map((a) => a.output)).toEqual([
      "models/ranger.one.glb",
      "models/ranger.two.glb",
    ]);
  });

  it("carries each entry's own clip names and omits roles it did not map", () => {
    const [one, two] = resolveCharacterAssets(mixed, identityUrl) as [CharacterAsset, CharacterAsset];
    expect(one.clips.walk).toBe("walk");
    expect(two.clips.walk).toBe("Stroll");
    expect(two.clips.attack).toBeUndefined();
  });

  it("returns an empty array rather than throwing on a malformed catalog", () => {
    expect(resolveCharacterAssets(null)).toEqual([]);
    expect(resolveCharacterAssets({})).toEqual([]);
    expect(resolveCharacterAssets({ assets: [] })).toEqual([]);
    expect(resolveCharacterAssets({ assets: "nope" })).toEqual([]);
    expect(resolveCharacterAssets({ assets: [null] })).toEqual([]);
  });

  it("returns an empty array when no entry is a character asset", () => {
    expect(
      resolveCharacterAssets({ assets: [{ id: "crate", kind: "prop", output: "models/c.glb" }] }, identityUrl),
    ).toEqual([]);
  });

  it("skips a character entry missing an id or an output path", () => {
    // The catalog schema requires both, so this is defence against a
    // hand-edited catalog rather than an expected shape.
    expect(resolveCharacterAssets({ assets: [{ kind: "character" }] })).toEqual([]);
    expect(resolveCharacterAssets({ assets: [{ kind: "character", output: "models/x.glb" }] })).toEqual([]);
    expect(resolveCharacterAssets({ assets: [{ id: "x", kind: "character" }] })).toEqual([]);
  });

  it("resolves the shipped catalog to the five rangers and the Hollow, through the real modelUrl", () => {
    const found = resolveCharacterAssets(catalog);
    expect(found.map((a) => a.id)).toEqual([
      "ranger.nathan", "ranger.eric", "ranger.sophia", "ranger.carla", "ranger.claudia", "hollow.antlered",
    ]);
    for (const asset of found) {
      expect(asset.url).toBe(modelUrl(asset.output));
      expect(asset.clips).toEqual({ idle: "idle", walk: "walk", attack: "attack", death: "death" });
    }
  });
});

describe("variantForId", () => {
  const list = ["a", "b", "c"];

  it("gives the same id the same entry every time", () => {
    // The host and every client build views independently; a random draw
    // would show two players different models for the same entity.
    expect(variantForId(list, 7)).toBe(variantForId(list, 7));
  });

  it("spreads sequential ids across every entry", () => {
    expect([0, 1, 2, 3, 4, 5].map((id) => variantForId(list, id))).toEqual(["a", "b", "c", "a", "b", "c"]);
  });

  it("returns null for an empty list and the only entry of a single one", () => {
    expect(variantForId([], 3)).toBeNull();
    expect(variantForId(["only"], 99)).toBe("only");
  });

  it("does not throw on a negative or fractional id", () => {
    expect(variantForId(list, -4)).toBe("b");
    expect(variantForId(list, 2.9)).toBe("c");
  });
});

describe("clipNameFor", () => {
  const asset = { clips: { walk: "Stroll" } as Partial<Record<ClipKind, string>> };

  it("prefers the catalog's declared name, present in every shipped file", () => {
    expect(clipNameFor(asset, ["Stroll", "Walk_B"], "walk")).toBe("Stroll");
  });

  it("falls back to synonym matching when the declared name is not in the file", () => {
    // Covers a model file whose clips were renamed in a later version,
    // without the catalog being updated.
    expect(clipNameFor(asset, ["Walk_B"], "walk")).toBe("Walk_B");
  });

  it("falls back to synonym matching when nothing was declared for the role", () => {
    expect(clipNameFor({ clips: {} }, ["Idle_A"], "idle")).toBe("Idle_A");
  });

  it("returns null when no clip in the file can serve the role", () => {
    expect(clipNameFor(asset, ["Idle_A"], "attack")).toBeNull();
  });
});

describe("attachSkinToContainer", () => {
  it("attaches the skin plugin to every MR-textured PBR material a loaded variant carries", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const skinned = new PBRMaterial("skinned", scene);
    skinned.metallicTexture = RawTexture.CreateRGBTexture(new Uint8Array([0, 200, 0]), 1, 1, scene);
    const bare = new PBRMaterial("bare", scene);
    expect(attachSkinToContainer({ materials: [skinned, bare] })).toBe(1);
    expect(skinned.pluginManager?.getPlugin("SkinShading")).toBeTruthy();
    expect(bare.pluginManager?.getPlugin("SkinShading") ?? null).toBeNull();
    scene.dispose();
    engine.dispose();
  });
});

/** The real GLBs, read from disk the way catalogModels.test.ts does. */
const fromDisk: CharacterLoader = (asset, scene) => {
  registerBuiltInLoaders();
  const bytes = readFileSync(new URL(`../../assets/${asset.output}`, import.meta.url));
  return loadAssetContainerAsync(new Uint8Array(bytes), scene, { pluginExtension: ".glb" });
};

describe("createCharacterPool", () => {
  let engine: NullEngine | null = null;
  afterEach(() => {
    engine?.dispose();
    engine = null;
  });
  function scene(): Scene {
    engine = new NullEngine();
    return new Scene(engine);
  }

  it("loads only the assets it is asked for", async () => {
    const s = scene();
    const pool = createCharacterPool(catalog, fromDisk);
    expect(pool.has("ranger.nathan")).toBe(false);
    await pool.load(s, ["ranger.nathan", "hollow.antlered"]);
    expect(pool.has("ranger.nathan")).toBe(true);
    expect(pool.has("hollow.antlered")).toBe(true);
    expect(pool.has("ranger.eric")).toBe(false);
    expect(pool.acquire(3, "ranger.eric")).toBeNull();
    pool.dispose();
  });

  it("gives a ranger a root carrying the four clips, and plays the one asked for", async () => {
    const s = scene();
    const pool = createCharacterPool(catalog, fromDisk);
    await pool.load(s, ["ranger.nathan"]);
    const instance = pool.acquire(4, "ranger.nathan")!;
    expect(instance).not.toBeNull();
    expect(instance.root.name).toBe("character_4_orientation");
    expect(pool.acquire(4, "ranger.nathan")).toBe(instance);
    const mine = s.animationGroups.filter((g) => g.name.startsWith("character_4_"));
    expect(mine.map((g) => g.name).sort()).toEqual([
      "character_4_attack", "character_4_death", "character_4_idle", "character_4_walk",
    ]);
    expect(instance.root.getChildMeshes(false).length).toBeGreaterThan(0);

    instance.play("walk");
    const walk = mine.find((g) => g.name === "character_4_walk")!;
    expect(walk.isPlaying).toBe(true);
    expect(mine.filter((g) => g.isPlaying)).toHaveLength(1);
    instance.setSpeed(1.6);
    expect(walk.speedRatio).toBe(1.6);
    instance.play("idle");
    expect(walk.isPlaying).toBe(false);
    expect(mine.find((g) => g.name === "character_4_idle")!.isPlaying).toBe(true);
    expect(mine.find((g) => g.name === "character_4_idle")!.speedRatio).toBe(1.6);

    pool.release(4);
    expect(instance.root.isDisposed()).toBe(true);
    expect(s.animationGroups.filter((g) => g.name.startsWith("character_4_"))).toHaveLength(0);
    // Released, the key is free: the next acquire builds a fresh instance.
    const again = pool.acquire(4, "ranger.nathan");
    expect(again).not.toBe(instance);
    pool.dispose();
  });

  it("carries the Hollow's glowing eye material and its four clips", async () => {
    const s = scene();
    const pool = createCharacterPool(catalog, fromDisk);
    await pool.load(s, ["hollow.antlered"]);
    const instance = pool.acquire(7, "hollow.antlered")!;
    const glowing = instance.root
      .getChildMeshes(false)
      .map((m) => m.material)
      .filter((m): m is PBRMaterial => m instanceof PBRMaterial && m.emissiveColor.r + m.emissiveColor.g + m.emissiveColor.b > 0);
    expect(glowing).toHaveLength(1);
    expect(s.animationGroups.filter((g) => g.name.startsWith("character_7_"))).toHaveLength(4);
    pool.dispose();
  });

  it("raises every loaded material's light cap to one lamp per hiker plus the sun and fill", async () => {
    // Container materials never reach the scene's new-material observable,
    // so without this they keep Babylon's 4 and drop the third hiker's lamp.
    const s = scene();
    const pool = createCharacterPool(catalog, fromDisk);
    await pool.load(s, ["ranger.nathan", "hollow.antlered"]);
    for (const key of [1, 2] as const) {
      const instance = pool.acquire(key, key === 1 ? "ranger.nathan" : "hollow.antlered")!;
      const materials = instance.root.getChildMeshes(false).flatMap((m) => (m.material === null ? [] : [m.material]));
      expect(materials.length).toBeGreaterThan(0);
      for (const m of materials) expect((m as PBRMaterial).maxSimultaneousLights).toBe(7);
    }
    pool.dispose();
  });

  it("shares one load between two calls naming the same asset", async () => {
    const s = scene();
    let calls = 0;
    const counting: CharacterLoader = (asset, sc) => {
      calls++;
      return fromDisk(asset, sc);
    };
    const pool = createCharacterPool(catalog, counting);
    await Promise.all([pool.load(s, ["ranger.nathan"]), pool.load(s, ["ranger.nathan", "ranger.eric"])]);
    expect(calls).toBe(2);
    expect(pool.has("ranger.nathan")).toBe(true);
    expect(pool.has("ranger.eric")).toBe(true);
    await pool.load(s, ["ranger.nathan"]);
    expect(calls).toBe(2);
    pool.dispose();
  });

  it("keeps a model that failed to load out, and the rest in", async () => {
    const s = scene();
    const failing: CharacterLoader = (asset, sc) =>
      asset.id === "ranger.eric" ? Promise.reject(new Error("unreadable")) : fromDisk(asset, sc);
    const pool = createCharacterPool(catalog, failing);
    await pool.load(s, ["ranger.eric", "ranger.nathan"]);
    expect(pool.has("ranger.eric")).toBe(false);
    expect(pool.has("ranger.nathan")).toBe(true);
    pool.dispose();
  });

  it("drops a load that finishes after the pool was disposed", async () => {
    const s = scene();
    const pool = createCharacterPool(catalog, fromDisk);
    const pending = pool.load(s, ["ranger.nathan"]);
    pool.dispose();
    await pending;
    expect(pool.has("ranger.nathan")).toBe(false);
    expect(s.meshes).toHaveLength(0);
  });
});
