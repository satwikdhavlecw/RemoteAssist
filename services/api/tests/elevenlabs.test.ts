import { afterEach, describe, expect, it, vi } from "vitest";
import { ElevenLabsClient } from "../src/providers/elevenlabs.js";

describe("ElevenLabs provider", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("uses the current default TTS model and mp3 output format", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(String(url)).toContain("/stream?output_format=mp3_44100_128");
      const body = JSON.parse(String(init?.body)) as {
        text: string;
        model_id: string;
        voice_settings: {
          stability: number;
          similarity_boost: number;
          speed: number;
        };
      };
      expect(body).toMatchObject({
        text: "Hello from RemoteAssist.",
        model_id: "eleven_flash_v2_5",
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          speed: 0.88,
        },
      });
      expect((init?.headers as Record<string, string>).Accept).toBe(
        "audio/mpeg",
      );
      return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new ElevenLabsClient({
      apiKey: "test-key",
      voiceId: "test-voice",
    });

    await expect(client.synthesize("Hello from RemoteAssist.")).resolves.toBe(
      "AQID",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("disables STT audio event tags so background chatter is less likely to become the query", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = init?.body as FormData;
      expect(body.get("model_id")).toBe("scribe_v2");
      expect(body.get("tag_audio_events")).toBe("false");
      expect(body.get("num_speakers")).toBe("1");
      return Response.json({ text: "Login button is not working" });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new ElevenLabsClient({
      apiKey: "test-key",
      voiceId: "test-voice",
    });

    await expect(client.transcribe("AQID")).resolves.toBe(
      "Login button is not working",
    );
  });
});
