import { acquireTexture, releaseTexture } from "@babylonjs/lite";
import { describe, expect, it } from "vitest";
import { createMaskTargets, type MaskTargets } from "../../../src/game/lite/shadeMask.js";
import { picture, type FakePicture } from "../../../testing/textureClaims.js";
import { sourceText } from "../../helpers/source.js";

const src = sourceText("game/lite/shadeMask.ts");

describe("the haunt's figures in their mask on Babylon Lite", () => {
  it("draws a body in the mask's pass alone: the body stands hidden, and the mask shows it by its own word: the engine's half", () => {
    const read = (name: string): string => sourceText(`game/lite/${name}`);
    // The mask's pass draws what it is handed whatever the mesh's own word.
    expect(src).toContain("      addMeshToTask(task, mesh, { material });\n      setTaskMeshVisible(task, mesh, true);");
    // A Hollow's body is the mask's alone, and a model never shows such a primitive: no pass of the frame draws it,
    // as nothing or otherwise, and its own material wears no plugin for that.
    expect(read("skinnedModels.ts")).toContain("for (const part of parts) if (part.drawn && !part.elsewhere) setMeshVisible(part.mesh, next > 0);");
    expect(read("skinnedModels.ts").split("setMeshVisible(").length).toBe(3);
    expect(src).not.toContain("Unseen");
  });
});

describe("the mask's targets on Babylon Lite", () => {
  /** Targets as Lite's with a picture are: Lite claims a target's texture when it makes it, and lets that claim go when the target is disposed. */
  const lites = (): { targets: MaskTargets<FakePicture>; made: FakePicture[] } => {
    const made: FakePicture[] = [];
    const targets = createMaskTargets<FakePicture>(
      512, 256,
      () => {
        const target = picture();
        acquireTexture(target);
        made.push(target);
        return target;
      },
      (target) => void releaseTexture(target),
    );
    return { targets, made };
  };

  it("hands out a picture that names one texture: Lite lets a claim go on whatever texture a picture names at that moment", () => {
    // What went wrong with a picture that named whatever the target held: bound, it claimed the first texture; the
    // target was made again; unbound, the claim let go was the second texture's, which nobody had claimed, and Lite
    // destroys a texture at its last release.
    const first = picture().texture;
    const second = picture().texture;
    let held = first;
    const whatever = { get texture() { return held; }, view: {} } as unknown as FakePicture;
    acquireTexture(whatever);
    held = second;
    releaseTexture(whatever);
    expect(second.destroyed).toBe(true);
    // The targets' own: a picture is one object for one texture, and another target's is another object.
    const { targets } = lites();
    const one = targets.current;
    const texture = one.texture;
    targets.fit(512, 512);
    expect(one.texture).toBe(texture);
    expect(targets.current).not.toBe(one);
    expect(targets.current.texture).not.toBe(texture);
    expect(src).toContain("createRenderTargetTexture(engine, { lbl: \"shade_mask\"");
    expect(src).not.toContain("_colorTexture");
  });
});
