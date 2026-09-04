import { afterEach, describe, expect, it, vi } from "vitest";
import { VertexAiLlmProvider } from "../src/domain/llm-service.js";

describe("Vertex AI LLM provider", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("sends Gemini content with an explicit user role", async () => {
    vi.stubEnv("GEMINI_API_KEY", "gemini-test-key");
    vi.stubEnv("VERTEX_AI_KEY_PATH", "");
    vi.stubEnv("ORCHESTRATOR_GOOGLE_APPLICATION_CREDENTIALS", "");
    vi.stubEnv("GOOGLE_APPLICATION_CREDENTIALS", "");

    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      inferred: "The page is a login screen.",
                      proposedNextStep: "Ask what error appears after login.",
                    }),
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchImplementation);

    const provider = new VertexAiLlmProvider(
      "project-test",
      "global",
      "gemini-test",
    );
    const result = await provider.generateGuidance(
      "login not working",
      "Application: ConversationFlo",
      "Approved article content",
    );

    expect(result.proposedNextStep).toBe("Ask what error appears after login.");
    const requestBody = JSON.parse(
      String(fetchImplementation.mock.calls[0]?.[1]?.body),
    ) as {
      contents: Array<{ role?: string; parts?: Array<{ text?: string }> }>;
    };
    expect(requestBody.contents[0]).toMatchObject({ role: "user" });
    expect(requestBody.contents[0]?.parts?.[0]?.text).toContain(
      "User query: login not working",
    );
  });

  it("uses Gemini 3.5 Flash as the default guidance model", async () => {
    vi.stubEnv("GEMINI_API_KEY", "gemini-test-key");
    vi.stubEnv("VERTEX_AI_KEY_PATH", "");
    vi.stubEnv("ORCHESTRATOR_GOOGLE_APPLICATION_CREDENTIALS", "");
    vi.stubEnv("GOOGLE_APPLICATION_CREDENTIALS", "");
    vi.stubEnv("VERTEX_AI_MODEL", "");
    vi.stubEnv("ORCHESTRATOR_VERTEX_MODEL", "");
    vi.stubEnv("ORCHESTRATOR_GOOGLE_MODEL", "");

    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      inferred: "The page is visible.",
                      proposedNextStep: "Ask for the visible error.",
                    }),
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchImplementation);

    const provider = new VertexAiLlmProvider();
    await provider.generateGuidance(
      "login not working",
      "Application: ConversationFlo",
      "Approved article content",
    );

    expect(String(fetchImplementation.mock.calls[0]?.[0])).toContain(
      "/models/gemini-3.5-flash:generateContent",
    );
  });

  it("accepts a valid Gemini JSON response without terminal punctuation", async () => {
    vi.stubEnv("GEMINI_API_KEY", "gemini-test-key");
    vi.stubEnv("VERTEX_AI_KEY_PATH", "");
    vi.stubEnv("ORCHESTRATOR_GOOGLE_APPLICATION_CREDENTIALS", "");
    vi.stubEnv("GOOGLE_APPLICATION_CREDENTIALS", "");
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        inferred: "The History navigation is visible",
                        proposedNextStep: "Open History after user approval",
                      }),
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    );

    const provider = new VertexAiLlmProvider(
      "project-test",
      "global",
      "gemini-test",
    );
    const result = await provider.generateGuidance(
      "why is this page showing an error",
      "Application: ServiceNow",
      "NO_APPROVED_ENTERPRISE_ARTICLE",
    );

    expect(result).toEqual({
      inferred: "The History navigation is visible.",
      proposedNextStep: "Open History after user approval.",
    });
    const requestBody = JSON.parse(
      String((vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit).body),
    ) as { generationConfig?: Record<string, unknown> };
    expect(requestBody.generationConfig).not.toHaveProperty("responseMimeType");
  });

  it("does not display an incomplete Gemini JSON wrapper", async () => {
    vi.stubEnv("GEMINI_API_KEY", "gemini-test-key");
    vi.stubEnv("VERTEX_AI_KEY_PATH", "");
    vi.stubEnv("ORCHESTRATOR_GOOGLE_APPLICATION_CREDENTIALS", "");
    vi.stubEnv("GOOGLE_APPLICATION_CREDENTIALS", "");
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [{ text: 'Here is the JSON requested: {"inferred":' }],
                },
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    );

    const provider = new VertexAiLlmProvider(
      "project-test",
      "global",
      "gemini-test",
    );
    const result = await provider.generateGuidance(
      "explain the dashboard",
      "Application: SAP. Page title: Home.",
      "Approved article content",
    );

    expect(result.proposedNextStep).not.toContain("JSON requested");
    expect(result.proposedNextStep).toBe(
      "Proceed with the recommended step in the procedure card.",
    );
  });

  it("rejects a plain-text response that ends in a formatting fragment", async () => {
    vi.stubEnv("GEMINI_API_KEY", "gemini-test-key");
    vi.stubEnv("VERTEX_AI_KEY_PATH", "");
    vi.stubEnv("ORCHESTRATOR_GOOGLE_APPLICATION_CREDENTIALS", "");
    vi.stubEnv("GOOGLE_APPLICATION_CREDENTIALS", "");
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: "The page is a dashboard. Visible areas include Finance. *.",
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    );

    const provider = new VertexAiLlmProvider(
      "project-test",
      "global",
      "gemini-test",
    );
    const result = await provider.generateGuidance(
      "explain the dashboard",
      "Application: SAP. Page title: Home.",
      "Approved article content",
    );

    expect(result.proposedNextStep).toBe(
      "Proceed with the recommended step in the procedure card.",
    );
  });

  it("preserves the complete parsed provider response in both guidance fields", async () => {
    vi.stubEnv("GEMINI_API_KEY", "gemini-test-key");
    vi.stubEnv("VERTEX_AI_KEY_PATH", "");
    vi.stubEnv("ORCHESTRATOR_GOOGLE_APPLICATION_CREDENTIALS", "");
    vi.stubEnv("GOOGLE_APPLICATION_CREDENTIALS", "");
    const inferred =
      `The page is a dashboard with visible business areas. ${"More visible context. ".repeat(180)}`.trim();
    const proposedNextStep =
      `Review the visible dashboard sections before choosing a next step. ${"Continue reviewing the current page. ".repeat(180)}`.trim();
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({ inferred, proposedNextStep }),
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    );

    const provider = new VertexAiLlmProvider(
      "project-test",
      "global",
      "gemini-test",
    );
    const result = await provider.generateGuidance(
      "explain the dashboard",
      "Application: SAP. Page title: Home.",
      "Approved article content",
    );

    expect(result).toEqual({ inferred, proposedNextStep });
  });

  it("falls back when Gemini reports that its response was truncated", async () => {
    vi.stubEnv("GEMINI_API_KEY", "gemini-test-key");
    vi.stubEnv("VERTEX_AI_KEY_PATH", "");
    vi.stubEnv("ORCHESTRATOR_GOOGLE_APPLICATION_CREDENTIALS", "");
    vi.stubEnv("GOOGLE_APPLICATION_CREDENTIALS", "");
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            candidates: [
              {
                finishReason: "MAX_TOKENS",
                content: {
                  parts: [{ text: "The response was cut off" }],
                },
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    );

    const provider = new VertexAiLlmProvider(
      "project-test",
      "global",
      "gemini-test",
    );
    const result = await provider.generateGuidance(
      "explain the dashboard",
      "Application: SAP. Page title: Home.",
      "Approved article content",
    );

    expect(result).toEqual({
      inferred:
        "[Vertex AI Inference] Analyzed issue: 'explain the dashboard' using matched document details.",
      proposedNextStep:
        "Proceed with the recommended step in the procedure card.",
    });
  });
});
