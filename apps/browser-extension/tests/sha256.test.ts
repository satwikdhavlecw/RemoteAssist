import { describe, expect, it } from "vitest";
import { sha256Hex } from "../src/security/sha256.js";

describe("packaged SHA-256", () => {
  it.each([
    ["", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
    ["abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"],
    [
      "RemoteAssist ✓",
      "e4ace08d3afa65a35a6c294f1fb1607dc6ffc14c11848e57b08b88392efd8366",
    ],
  ])("matches the SHA-256 vector for %j", (input, expected) => {
    expect(sha256Hex(input)).toBe(expected);
  });
});
