import { describe, it, expect } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture.js";
import {
  clipNameFor,
  pickClip,
  resolveEnemyAssets,
  variantForEnemy,
  attachSkinToContainer,
  type ClipKind,
  type EnemyAsset,
} from "../../src/game/enemyModel.js";
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

describe("resolveEnemyAssets", () => {
  const mixed = {
    assets: [
      {
        id: "enemy.grunt",
        kind: "character",
        output: "models/enemy.grunt.glb",
        animations: { idle: "Idle", walk: "Walk", attack: "Attack", death: "Death" },
      },
      { id: "crate", kind: "prop", output: "models/crate.glb" },
      {
        id: "enemy.skeleton",
        kind: "character",
        output: "models/enemy.skeleton.glb",
        animations: { idle: "Skeletons_Idle", walk: "Skeletons_Walking" },
      },
    ],
  };

  it("returns every character entry, in catalog order", () => {
    // Order is load-bearing: variantForEnemy indexes into this array, so the
    // same enemy id must select the same asset on every peer.
    expect(resolveEnemyAssets(mixed).map((a) => a.id)).toEqual([
      "enemy.grunt",
      "enemy.skeleton",
    ]);
  });

  it("resolves each URL from that entry's own output path", () => {
    // The URL is whatever Vite serves the built file at — content-hashed in a
    // production build, so it cannot be spelled out here. Asserting against
    // `modelUrl` of each entry's OWN output is the contract: derived per entry,
    // never hardcoded, and never drifting from the path the build writes.
    expect(resolveEnemyAssets(mixed).map((a) => a.url)).toEqual([
      modelUrl("models/enemy.grunt.glb"),
      modelUrl("models/enemy.skeleton.glb"),
    ]);
    // ...and the two are genuinely different files, which the equality above
    // would not catch on its own if both resolved through the same output.
    const [grunt, skeleton] = resolveEnemyAssets(mixed) as [EnemyAsset, EnemyAsset];
    expect(grunt.url).not.toBe(skeleton.url);
  });

  it("carries each entry's own clip names, present in the shipped model", () => {
    const [grunt, skeleton] = resolveEnemyAssets(mixed) as [EnemyAsset, EnemyAsset];
    expect(grunt.clips.walk).toBe("Walk");
    expect(skeleton.clips.walk).toBe("Skeletons_Walking");
  });

  it("omits roles the catalog did not map", () => {
    const [, skeleton] = resolveEnemyAssets(mixed) as [EnemyAsset, EnemyAsset];
    expect(skeleton.clips.attack).toBeUndefined();
  });

  it("returns an empty array rather than throwing on a malformed catalog", () => {
    expect(resolveEnemyAssets(null)).toEqual([]);
    expect(resolveEnemyAssets({})).toEqual([]);
    expect(resolveEnemyAssets({ assets: [] })).toEqual([]);
    expect(resolveEnemyAssets({ assets: "nope" })).toEqual([]);
    expect(resolveEnemyAssets({ assets: [null] })).toEqual([]);
  });

  it("returns an empty array when no entry is a character asset", () => {
    expect(
      resolveEnemyAssets({ assets: [{ id: "crate", kind: "prop", output: "models/c.glb" }] }),
    ).toEqual([]);
  });

  it("skips a character entry missing an id or an output path", () => {
    // The catalog schema requires both, so this is defence against a
    // hand-edited catalog rather than an expected shape.
    expect(resolveEnemyAssets({ assets: [{ kind: "character" }] })).toEqual([]);
    expect(
      resolveEnemyAssets({ assets: [{ kind: "character", output: "models/x.glb" }] }),
    ).toEqual([]);
    expect(resolveEnemyAssets({ assets: [{ id: "x", kind: "character" }] })).toEqual([]);
  });

  it("resolves the shipped catalog to both enemies", () => {
    const ids = resolveEnemyAssets(catalog).map((a) => a.id);
    expect(ids).toContain("enemy.grunt");
    expect(ids).toContain("enemy.skeleton");
    // Each URL must be the one `modelUrl` gives for that entry's OWN `output`,
    // looked up back out of the catalog rather than re-spelled here.
    const outputById = new Map(catalog.assets.map((a) => [a.id, a.output]));
    for (const asset of resolveEnemyAssets(catalog)) {
      expect(asset.url).toBe(modelUrl(outputById.get(asset.id)!));
    }
  });
});

describe("variantForEnemy", () => {
  const assets = ["a", "b", "c"];

  it("gives the same enemy the same variant every time", () => {
    // The property the whole design rests on. The host and every client build
    // views independently; a random draw would show two players different
    // models for the same enemy.
    expect(variantForEnemy(assets, 7)).toBe(variantForEnemy(assets, 7));
  });

  it("spreads sequential ids across every variant", () => {
    expect([0, 1, 2, 3, 4, 5].map((id) => variantForEnemy(assets, id))).toEqual([
      "a",
      "b",
      "c",
      "a",
      "b",
      "c",
    ]);
  });

  it("returns null when there are no assets at all", () => {
    expect(variantForEnemy([], 3)).toBeNull();
  });

  it("always returns the only asset when there is one", () => {
    expect(variantForEnemy(["only"], 99)).toBe("only");
  });

  it("does not throw on a negative or fractional id", () => {
    // Enemy ids are positive integers from the sim, so this is defence against
    // a future id scheme rather than an expected input.
    expect(variantForEnemy(assets, -4)).toBe("b");
    expect(variantForEnemy(assets, 2.9)).toBe("c");
  });
});

describe("clipNameFor", () => {
  const asset = {
    id: "enemy.skeleton",
    url: "/assets/models/enemy.skeleton.glb",
    clips: { walk: "Skeletons_Walking" } as Partial<Record<ClipKind, string>>,
  };

  it("prefers the catalog's declared name, present in every shipped file", () => {
    expect(clipNameFor(asset, ["Skeletons_Walking", "Walk_B"], "walk")).toBe(
      "Skeletons_Walking",
    );
  });

  it("falls back to synonym matching when the declared name is not in the file", () => {
    // Covers a model file whose animation clips were renamed in a later
    // version, without the catalog being updated.
    expect(clipNameFor(asset, ["Walk_B"], "walk")).toBe("Walk_B");
  });

  it("falls back to synonym matching when nothing was declared for the role", () => {
    expect(clipNameFor({ ...asset, clips: {} }, ["Idle_A"], "idle")).toBe("Idle_A");
  });

  it("returns null when no clip in the file can serve the role", () => {
    expect(clipNameFor(asset, ["Idle_A"], "attack")).toBeNull();
  });

  it("reads each asset's own mapping, not a shared one", () => {
    const grunt = {
      id: "enemy.grunt",
      url: "/assets/models/enemy.grunt.glb",
      clips: { walk: "Walk" } as Partial<Record<ClipKind, string>>,
    };
    expect(clipNameFor(grunt, ["Walk", "Skeletons_Walking"], "walk")).toBe("Walk");
    expect(clipNameFor(asset, ["Walk", "Skeletons_Walking"], "walk")).toBe(
      "Skeletons_Walking",
    );
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
