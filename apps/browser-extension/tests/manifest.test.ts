import { describe, expect, it } from "vitest";
import manifest from "../src/manifest.json";

describe("development extension permissions", () => {
  it("keeps broad tab metadata and external hosts optional", () => {
    expect(manifest.host_permissions).toEqual(
      expect.arrayContaining([
        "http://127.0.0.1:4320/*",
        "http://localhost:4320/*",
      ]),
    );
    expect(manifest.permissions).not.toContain("tabs");
    expect(manifest.optional_permissions).toContain("tabs");
    expect(manifest.host_permissions).not.toContain("<all_urls>");
    expect(manifest.optional_host_permissions).toEqual(
      expect.arrayContaining(["http://*/*", "https://*/*"]),
    );
  });
});
