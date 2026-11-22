import { describe, expect, it } from "vitest";
import { sourceText } from "../../helpers/source.js";

const mask = sourceText("game/lite/shadeMask.ts");

describe("the crowd's cards on Babylon Lite", () => {
  it("is drawn in the shade mask with the mask's material in place of its own, and brings the mask up while a card is, with or without a figure", () => {
    expect(mask).toContain("addMeshToTask(task, mesh, { material: cardMaterial });");
    expect(mask).toContain("figures = anyNow && count > 0 && looks.size > 0;\n      any = figures || cardsUp;\n      task.enabled = any;");
    expect(mask).toContain("cardsUp = up && cardsMesh !== null;\n      any = figures || cardsUp;\n      task.enabled = any;");
    expect(mask).toContain("if (cardsMesh !== null) removeMeshFromTask(task, cardsMesh);");
  });
});
