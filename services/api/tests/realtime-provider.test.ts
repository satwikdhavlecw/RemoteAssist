import { describe, expect, it, vi } from "vitest";
import { OpenAIRealtimeProvider } from "../src/providers/realtime.js";

describe("OpenAI Realtime provider", () => {
  it("creates a governed WebRTC call and hangs it up without exposing the API key", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response("v=0\r\nt=openai-answer", {
          status: 201,
          headers: {
            location: "https://api.openai.com/v1/realtime/calls/call_test_123",
          },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    const provider = new OpenAIRealtimeProvider({
      apiKey: "server-only-test-key",
      model: "gpt-realtime-test",
      voice: "marin",
      transcriptionModel: "gpt-realtime-whisper-test",
      fetchImplementation,
    });

    const connection = await provider.createSession({
      sessionId: "rs_test",
      tenantId: "tenant-test",
      userId: "user-test",
      language: "en-IN",
      offerSdp: "v=0\r\nt=browser-offer",
      context: {
        reportedIssue: "Salesforce sign-in failed",
        application: "Salesforce",
        visibleError: "SAML authentication failed",
        availableControls: [
          {
            name: "Try Again",
            role: "button",
            actions: ["CLICK_ELEMENT", "FOCUS_ELEMENT", "SCROLL_TO_ELEMENT"],
          },
        ],
      },
    });

    expect(connection).toEqual({
      provider: "openai_realtime",
      sessionId: "rs_test",
      model: "gpt-realtime-test",
      answerSdp: "v=0\r\nt=openai-answer",
      transport: "webrtc",
    });
    expect(JSON.stringify(connection)).not.toContain("server-only-test-key");
    const createInit = fetchImplementation.mock.calls[0]?.[1];
    expect(createInit?.headers).toMatchObject({
      Authorization: "Bearer server-only-test-key",
    });
    const form = createInit?.body as FormData;
    expect(form.get("sdp")).toBe("v=0\r\nt=browser-offer");
    expect(form.get("session")).toContain("gpt-realtime-test");
    expect(form.get("session")).toContain("untrusted data");
    expect(form.get("session")).toContain("propose_browser_action");
    expect(form.get("session")).toContain("Try Again");
    expect(form.get("session")).toContain("FOCUS_ELEMENT");

    await provider.endSession("rs_test");
    expect(fetchImplementation).toHaveBeenLastCalledWith(
      "https://api.openai.com/v1/realtime/calls/call_test_123/hangup",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("fails closed when OpenAI does not return a call identifier", async () => {
    const provider = new OpenAIRealtimeProvider({
      apiKey: "server-only-test-key",
      model: "gpt-realtime-test",
      voice: "marin",
      transcriptionModel: "gpt-realtime-whisper-test",
      fetchImplementation: vi.fn(async () =>
        Promise.resolve(new Response("v=0", { status: 201 })),
      ),
    });

    await expect(
      provider.createSession({
        sessionId: "rs_test",
        tenantId: "tenant-test",
        userId: "user-test",
        language: "en-IN",
        offerSdp: "v=0",
        context: {
          reportedIssue: "Sign-in failed",
          application: null,
          visibleError: null,
          availableControls: [],
        },
      }),
    ).rejects.toThrow("did not return a call identifier");
  });
});
