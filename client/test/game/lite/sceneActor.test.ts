import { describe, expect, it } from "vitest";
import "../../../src/game/dayhikeAssets.js";
import "../../../src/sim/passes/index.js";
import { REST_BONES_APART, floatsApart } from "../../../src/game/lite/sceneActor.js";
import { CORD_COLOUR, CORD_ROUGHNESS } from "../../../src/game/lite/sceneryMeshes.js";
import { babylonText } from "../../helpers/babylonFixture.js";
import { sourceText } from "../../helpers/source.js";

const read = (path: string): string => sourceText(`game/${path}`);

describe("a staged scene's actor on Babylon Lite", () => {
  it("tells how far two runs of floats stand apart, and two of different lengths as wholly apart", () => {
    expect(floatsApart([1, 2, 3], [1, 2, 3])).toBe(0);
    expect(floatsApart([1, 2, 3], [1, 2.5, 2])).toBe(1);
    expect(floatsApart(new Float32Array([0.5]), new Float32Array([0.25]))).toBe(0.25);
    expect(floatsApart([1, 2], [1, 2, 3])).toBe(Infinity);
    // A run never sent (not a number anywhere) is apart from every run.
    expect(floatsApart([1], [Number.NaN]) === 0).toBe(false);
  });

  it("takes the loader's skin only where the rig's bones at rest are the loader's own", () => {
    // The model's joints are in hundredths of a metre: a tenth of a millimetre.
    expect(REST_BONES_APART).toBe(1e-2);
    const source = read("lite/sceneActor.ts");
    expect(source).toContain("if (!(apart <= REST_BONES_APART)) fail(");
  });

  it("poses its bones from the file with no engine, sends them on a frame that moves them, and never hands its clips to the scene's mixer", () => {
    const source = read("lite/sceneActor.ts");
    expect(source).toContain("container.animationGroups = undefined;");
    expect(source).toContain("const known = poseActor(rig, pose.clip, pose.clipTime, blend, posed);");
    expect(source).toContain("if (floatsApart(bones, sent) !== 0) {");
    expect(source).not.toMatch(/bakeVat|attachVat|playAnimation|updateAnimationManager/);
  });
});

describe("the handset's cord on Babylon Lite", () => {
  it("wears the material recorded of the stage on Babylon.js: thin dark rubber under the cab's share of the sky", () => {
    // The cord's material as the stage's shell on Babylon.js made it, its lines recorded.
    const shell = babylonText("stages/cordTube.material.txt");
    expect(shell).toContain(`material.albedoColor = new Color3(${CORD_COLOUR.join(", ")});`);
    expect(shell).toContain(`material.roughness = ${CORD_ROUGHNESS};`);
    expect(shell).toContain("material.metallic = 0;");
    expect(shell).toContain("material.environmentIntensity = CAB_SKY;");
    const lite = read("lite/sceneryMeshes.ts");
    expect(lite).toContain("baseColorFactor: [CORD_COLOUR[0], CORD_COLOUR[1], CORD_COLOUR[2], 1], metallicFactor: 0, roughnessFactor: CORD_ROUGHNESS, environmentIntensity: CAB_SKY,");
  });

  it("is laid in the car's own frame, and only where an end has moved in it", () => {
    const lite = read("lite/sceneryMeshes.ts");
    expect(lite).toContain("if (ends[0] === cordFrom.x && ends[1] === cordFrom.y && ends[2] === cordFrom.z && ends[3] === cordTo.x && ends[4] === cordTo.y && ends[5] === cordTo.z) return;");
    expect(lite).toContain("layTube(coiledCord(cordFrom, cordTo, CORD), CORD_TUBE_RADIUS, cord.tube);");
    // And the handset's vertices only where the hand has moved it in the car, never while it rests.
    expect(lite).toContain("if (!handset.carried) return;");
    expect(lite).toContain("if (handset.carried && carryScratch.every((value, i) => value === handset.carry[i])) return;");
  });
});
