import { describe, expect, it } from "vitest";
import {
  creatureClipFor, creatureGroupsByName, creatureRoleGroups, resolveCreatureAssets, type CreatureAsset,
} from "../../src/game/creatureModel.js";
import catalog from "../../assets/catalog.json" with { type: "json" };

/**
 * `modelUrl` (creatureModel.ts's default `urlFor`) throws on any `output` the
 * Vite glob over `client/assets/models/` does not know — so a synthetic catalog
 * here must go through an identity stand-in instead.
 * `resolveCreatureAssets(catalog)` below (no second argument) exercises the real
 * default against the shipped catalog.
 */
const identityUrl = (output: string): string => output;

const elk: CreatureAsset = { id: "wildlife.elk", url: "/x.glb", clips: { graze: "Graze", walk: "Walk", run: "Run" } };

describe("resolveCreatureAssets", () => {
  it("keeps only kind creature, in catalog order, with the role map", () => {
    const found = resolveCreatureAssets(
      {
        assets: [
          { id: "ranger.nathan", kind: "character", output: "models/ranger.nathan.glb", animations: { idle: "idle" } },
          {
            id: "wildlife.elk",
            kind: "creature",
            output: "models/wildlife.elk.glb",
            animations: { graze: "Graze", walk: "Walk", run: "Run", alert: "Alert" },
          },
        ],
      },
      identityUrl,
    );
    expect(found.map((a) => a.id)).toEqual(["wildlife.elk"]);
    expect(found[0]!.clips).toEqual({ graze: "Graze", walk: "Walk", run: "Run", alert: "Alert" });
  });

  it("resolves the shipped catalog's creatures through the real modelUrl", () => {
    // The default `urlFor` throws on an `output` the glob cannot resolve, so this fails the moment
    // a creature entry ships without its .glb.
    const found = resolveCreatureAssets(catalog);
    expect(found.map((a) => a.id)).toEqual([
      "wildlife.rabbit", "wildlife.squirrel", "wildlife.elk", "wildlife.deer",
    ]);
    expect(found.every((a) => a.id.startsWith("wildlife."))).toBe(true);
    expect(found[0]!.clips).toEqual({ graze: "Graze", walk: "Hop", run: "Hop" });
    expect(found[0]!.url).toContain("wildlife.rabbit");
    // The three quadrupeds share one rig and one clip map with four roles; asserted as the
    // full map because the point is that the catalog and the shipped files agree about
    // exactly which clips exist.
    for (const a of found.slice(1)) {
      expect(a.clips).toEqual({ graze: "Graze", walk: "Walk", run: "Run", alert: "Alert" });
      expect(a.url).toContain(a.id);
    }
  });
});

describe("creatureClipFor", () => {
  it("uses the declared clip when present", () => {
    expect(creatureClipFor(elk, ["Graze", "Walk", "Run"], "run")).toBe("Run");
  });

  it("falls back alert → idle → graze, idle → graze", () => {
    expect(creatureClipFor(elk, ["Graze", "Walk", "Run"], "alert")).toBe("Graze");
    expect(
      creatureClipFor({ ...elk, clips: { ...elk.clips, idle: "Idle" } }, ["Graze", "Walk", "Run", "Idle"], "alert"),
    ).toBe("Idle");
    expect(creatureClipFor(elk, ["Graze", "Walk", "Run"], "idle")).toBe("Graze");
  });

  it("matches by synonym when the declared clip is absent from the file", () => {
    expect(creatureClipFor(elk, ["Eat_Grass", "Walk_Cycle", "Gallop"], "run")).toBe("Gallop");
    expect(creatureClipFor(elk, ["Eat_Grass", "Walk_Cycle", "Gallop"], "graze")).toBe("Eat_Grass");
  });

  it("returns null when nothing fits", () => {
    expect(creatureClipFor(elk, ["Dance"], "run")).toBeNull();
  });

  it("does not match a synonym as a substring across a token boundary", () => {
    // "eat" ⊂ "Death" and "run" ⊂ "Trunk_Idle"/"Grunt" as plain substrings.
    // "Trunk_Idle" is dropped from the graze
    // fixture: it genuinely tokenizes to ["trunk", "idle"], so graze's
    // idle-fallback legitimately matches it — that's the fallback chain
    // working as designed, not a collision, so it stays out of a
    // collision-avoidance assertion. "run" keeps the full three-name list:
    // run's own fallback (walk) finds nothing in it either way.
    expect(creatureClipFor(elk, ["Death", "Grunt"], "graze")).toBeNull();
    expect(creatureClipFor(elk, ["Death", "Trunk_Idle", "Grunt"], "run")).toBeNull();
    // The same synonyms still resolve once they're on a real token boundary,
    // including the exporter take-number suffix ("Run_Cycle" has no digit,
    // "Eat_Grass_01" does).
    expect(creatureClipFor(elk, ["Eat_Grass_01", "Run_Cycle"], "graze")).toBe("Eat_Grass_01");
    expect(creatureClipFor(elk, ["Eat_Grass_01", "Run_Cycle"], "run")).toBe("Run_Cycle");
  });
});

/**
 * The two halves of `acquire`'s clip wiring, split out so they can be tested
 * without a GPU: `createCreaturePool` reads the real catalog and has no seam
 * for a fake container, and these are the parts worth pinning — a fake group is
 * just `{ name }`.
 */
describe("the per-instance clip memo", () => {
  const named = (...names: string[]) => names.map((name) => ({ name }));

  it("keys a clone's groups on the exact instantiated name before falling back to a scan", () => {
    // `instantiateModelsToScene` renames each group through the name function,
    // so `creature_7_Walk_Fast` IS `Walk_Fast`. A plain `includes` scan gives it
    // to `Walk` (first in the list) and loses the real one.
    const clipNames = ["Walk", "Walk_Fast", "Graze"];
    const groups = named("creature_7_Walk", "creature_7_Walk_Fast", "creature_7_Graze");
    const byName = creatureGroupsByName(clipNames, "creature_7_", groups);
    expect(byName.get("Walk")!.name).toBe("creature_7_Walk");
    expect(byName.get("Walk_Fast")!.name).toBe("creature_7_Walk_Fast");
    expect(byName.size).toBe(3);
    // A loader that renames some other way still resolves through the scan.
    const scanned = creatureGroupsByName(["Graze"], "creature_7_", named("Graze.001"));
    expect(scanned.get("Graze")!.name).toBe("Graze.001");
  });

  it("resolves every role once, including a role that only the synonym scan can find", () => {
    // `alert` is undeclared here — the path that made `play` allocate per frame,
    // since `bySynonym` splits a fresh array per clip name per synonym.
    const clipNames = ["Graze", "Walk", "Run", "Listen"];
    const byName = creatureGroupsByName(clipNames, "creature_1_", named(
      "creature_1_Graze", "creature_1_Walk", "creature_1_Run", "creature_1_Listen",
    ));
    const byRole = creatureRoleGroups(elk, clipNames, byName);
    expect([...byRole.keys()].sort()).toEqual(["alert", "graze", "idle", "run", "walk"]);
    expect(byRole.get("run")!.name).toBe("creature_1_Run");
    expect(byRole.get("alert")!.name).toBe("creature_1_Listen");
    expect(byRole.get("idle")!.name).toBe("creature_1_Graze"); // idle → graze fallback
    // Every role agrees with the pure resolver it memoizes — the memo is a
    // lookup table for `creatureClipFor`, not a second policy.
    for (const role of ["graze", "idle", "walk", "run", "alert"] as const) {
      const name = creatureClipFor(elk, clipNames, role);
      expect(byRole.get(role)?.name ?? null).toBe(name === null ? null : `creature_1_${name}`);
    }
  });

  it("maps a role with no clip at all to null rather than dropping the key", () => {
    const byName = creatureGroupsByName(["Dance"], "creature_2_", named("creature_2_Dance"));
    const byRole = creatureRoleGroups({ ...elk, clips: {} }, ["Dance"], byName);
    expect(byRole.has("run")).toBe(true);
    expect(byRole.get("run")).toBeNull();
  });
});
