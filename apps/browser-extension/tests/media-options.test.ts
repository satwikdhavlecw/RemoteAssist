import { describe, expect, it } from "vitest";
import { tabDisplayMediaOptions } from "../src/sidepanel/media-options.js";

describe("tab-sharing picker options", () => {
  it("offers a complete browser window without monitor or audio capture", () => {
    expect(tabDisplayMediaOptions.video.displaySurface).toBe("window");
    expect(tabDisplayMediaOptions.preferCurrentTab).toBe(false);
    expect(tabDisplayMediaOptions.selfBrowserSurface).toBe("include");
    expect(tabDisplayMediaOptions.monitorTypeSurfaces).toBe("exclude");
    expect(tabDisplayMediaOptions.audio).toBe(false);
  });
});
