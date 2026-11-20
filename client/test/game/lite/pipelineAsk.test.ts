import { describe, expect, it } from "vitest";
import { askRenderPipeline, type PipelineDevice } from "@csarkosh/engine/game/lite/pipelineAsk";

/** A device whose asynchronous make answers `answer`, saying what it was asked. */
function device(answer: "made" | "refused"): { device: PipelineDevice; asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    device: {
      createRenderPipeline: (descriptor) => (asked.push(`sync ${descriptor.label}`), { label: `sync ${descriptor.label}` } as unknown as GPURenderPipeline),
      createRenderPipelineAsync: (descriptor) => {
        asked.push(`async ${descriptor.label}`);
        return answer === "made" ? Promise.resolve({ label: `async ${descriptor.label}` } as unknown as GPURenderPipeline) : Promise.reject(new Error("refused"));
      },
    },
  };
}
const descriptor = { label: "post grade" } as GPURenderPipelineDescriptor;

describe("a pipeline of the game's own asked for off the page's thread", () => {
  it("is the device's asynchronous answer, and nothing is made the synchronous way", async () => {
    const { device: d, asked } = device("made");
    expect((await askRenderPipeline(d, descriptor)).label).toBe("async post grade");
    expect(asked).toEqual(["async post grade"]);
  });

  it("is made again the synchronous way where the device refuses it, so its error is the device's to report", async () => {
    const { device: d, asked } = device("refused");
    expect((await askRenderPipeline(d, descriptor)).label).toBe("sync post grade");
    expect(asked).toEqual(["async post grade", "sync post grade"]);
  });
});
