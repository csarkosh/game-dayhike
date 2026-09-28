import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { sha256Hex } from "../../src/game/sha256.js";

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

describe("sha256Hex", () => {
  it("gives the standard's own test vectors", () => {
    expect(sha256Hex(utf8(""))).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex(utf8("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    // 56 bytes: the padding spills into a second block.
    expect(sha256Hex(utf8("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"))).toBe(
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    );
    expect(sha256Hex(utf8("abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu"))).toBe(
      "cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1",
    );
    // A million bytes, about the size of the largest shader stage.
    expect(sha256Hex(utf8("a".repeat(1_000_000)))).toBe("cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0");
  });

  it("hashes parts as the bytes they make one after another, wherever they are cut", () => {
    for (const length of [0, 1, 55, 56, 63, 64, 65, 119, 120, 127, 128, 1_000, 4_097]) {
      const bytes = new Uint8Array(length).map((_, i) => (i * 31 + 7) & 255);
      const whole = createHash("sha256").update(bytes).digest("hex");
      expect(sha256Hex(bytes), `${length}`).toBe(whole);
      for (const cut of [0, 1, 17, 63, 64, 65].filter((c) => c <= length)) {
        expect(sha256Hex(bytes.subarray(0, cut), bytes.subarray(cut)), `${length} cut at ${cut}`).toBe(whole);
        expect(sha256Hex(bytes.subarray(0, cut), new Uint8Array(0), bytes.subarray(cut)), `${length} cut at ${cut}, an empty part`).toBe(whole);
      }
    }
  });
});
