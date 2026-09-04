// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  isSensitiveElement,
  sanitizeDocument,
} from "../src/security/sanitize.js";

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "getClientRects", {
    configurable: true,
    value: () => [{ x: 10, y: 10, width: 120, height: 32 }],
  });
  Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      x: 10,
      y: 10,
      left: 10,
      top: 10,
      right: 130,
      bottom: 42,
      width: 120,
      height: 32,
    }),
  });
  document.title = "Salesforce sign in";
  document.body.innerHTML = `
    <main>
      <h1>Salesforce</h1>
      <p role="alert">SAML authentication failed</p>
      <label for="username">Username</label>
      <input id="username" name="username" value="alice@example.com" />
      <label for="password">Password</label>
      <input id="password" type="password" value="not-for-the-agent" />
      <label for="otp">One-time code</label>
      <input id="otp" autocomplete="one-time-code" value="123456" />
      <input type="hidden" name="csrf" value="secret-token" />
      <button>Try Again</button>
    </main>
  `;
});

describe("DOM sanitation", () => {
  it("identifies password, OTP, and hidden fields as sensitive", () => {
    expect(isSensitiveElement(document.querySelector("#password")!)).toBe(true);
    expect(isSensitiveElement(document.querySelector("#otp")!)).toBe(true);
    expect(
      isSensitiveElement(document.querySelector("input[type='hidden']")!),
    ).toBe(true);
    expect(isSensitiveElement(document.querySelector("#username")!)).toBe(
      false,
    );
  });

  it("returns safe visible controls without field values or secrets", async () => {
    const observation = await sanitizeDocument(document);
    const serialized = JSON.stringify(observation);
    expect(observation.screen_state).toBe("saml_login_error");
    expect(observation.sensitive_content).toBe(true);
    expect(observation.controls.map((control) => control.name)).toContain(
      "Try Again",
    );
    expect(observation.controls.map((control) => control.name)).not.toContain(
      "Password",
    );
    expect(serialized).not.toContain("not-for-the-agent");
    expect(serialized).not.toContain("123456");
    expect(serialized).not.toContain("secret-token");
    expect(serialized).not.toContain("alice@example.com");
  });

  it("derives an unknown application safely from page metadata", async () => {
    document.title = "ConversationFlo | Login";
    document.body.innerHTML = `
      <main>
        <h1>ConversationFlo</h1>
        <p>Sign in to your tenant</p>
        <label for="password">Password</label>
        <input id="password" type="password" value="never-send-this" />
      </main>
    `;

    const observation = await sanitizeDocument(document);

    expect(observation.application).toBe("ConversationFlo");
    expect(observation.page_title).toBe("ConversationFlo | Login");
    expect(observation.visible_text).toContain("Sign in to your tenant");
    expect(JSON.stringify(observation)).not.toContain("never-send-this");
  });

  it("observes text-labelled navigation controls rendered without native roles", async () => {
    document.body.innerHTML = `
      <div class="sn-polaris-header"><span>All</span><span>History</span></div>
      <main><h1>Incidents</h1></main>
    `;

    const observation = await sanitizeDocument(document);
    expect(observation.controls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "link", name: "History" }),
      ]),
    );
  });

  it("observes navigation labels inside open shadow roots", async () => {
    document.body.innerHTML = "<main><h1>Incidents</h1></main>";
    const host = document.createElement("div");
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = "<span>History</span>";
    document.body.append(host);

    const observation = await sanitizeDocument(document);
    expect(observation.controls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "link", name: "History" }),
      ]),
    );
  });

  it("observes SAP invoice section labels rendered without native roles", async () => {
    document.body.innerHTML = `
      <div class="sections-tab-bar">
        <span>General Information</span>
        <span>Purchasing Document References</span>
        <span>Tax</span>
      </div>
    `;

    const observation = await sanitizeDocument(document);
    expect(observation.controls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "link", name: "Tax" }),
        expect.objectContaining({
          role: "link",
          name: "Purchasing Document References",
        }),
      ]),
    );
  });

  it("keeps native tab roles when a framework duplicates aria and visible text", async () => {
    document.body.innerHTML = `
      <div role="tablist">
        <div role="tab" aria-label="Tax"><span>Tax</span></div>
      </div>
    `;

    const observation = await sanitizeDocument(document);
    expect(observation.controls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "tab", name: "Tax" }),
      ]),
    );
  });

  it("observes the SAP create supplier invoice navigation tile", async () => {
    document.body.innerHTML = `
      <div class="apps">
        <span>Create Supplier Invoice</span>
      </div>
    `;

    const observation = await sanitizeDocument(document);
    expect(observation.controls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "link",
          name: "Create Supplier Invoice",
        }),
      ]),
    );
  });

  it("prioritizes allowlisted navigation labels before the control bound", async () => {
    document.body.innerHTML = `
      <div class="sections-tab-bar">
        <span>Tax</span>
      </div>
      ${Array.from({ length: 350 }, (_, index) => `<button>Action ${index}</button>`).join("")}
    `;

    const observation = await sanitizeDocument(document);
    expect(observation.controls[0]).toMatchObject({
      role: "link",
      name: "Tax",
    });
  });

  it("does not concatenate child text into container aria-label or accessible names", async () => {
    document.body.innerHTML = `
      <section aria-label="Page Sections">
        <button role="tab">Procurement</button>
        <button class="sap-tile">Manage Purchase Orders</button>
      </section>
    `;

    const observation = await sanitizeDocument(document);
    const sectionControl = observation.controls.find(
      (c) => c.role === "region",
    );
    expect(sectionControl?.name).toBe("Page Sections");
    expect(sectionControl?.name).not.toContain("Procurement");
    expect(sectionControl?.name).not.toContain("Manage Purchase Orders");

    expect(observation.controls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "tab", name: "Procurement" }),
        expect.objectContaining({
          role: "button",
          name: "Manage Purchase Orders",
        }),
      ]),
    );
  });

  it("captures dynamic role=alert and role=status elements in safe controls", async () => {
    document.body.innerHTML = `
      <main>
        <div role="alert" class="sapMMessageStrip sapMMessageStripWarning" aria-label="Price Variance Alert">
          <span class="sapMMessageStripText">[POLICY WARNING]: Price variance tolerance exceeded.</span>
        </div>
        <button id="btn-variance-appr" aria-label="Request Variance Manager Approval">Request Variance Manager Approval</button>
      </main>
    `;

    const observation = await sanitizeDocument(document);
    expect(observation.controls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "alert",
          name: "Price Variance Alert",
        }),
        expect.objectContaining({
          role: "button",
          name: "Request Variance Manager Approval",
        }),
      ]),
    );
  });
});

