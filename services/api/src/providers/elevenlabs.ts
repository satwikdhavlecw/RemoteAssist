export interface ElevenLabsConfig {
  apiKey?: string;
  voiceId?: string;
  ttsModel?: string;
  sttModel?: string;
}

export class ElevenLabsClient {
  private readonly apiKey: string;
  private readonly voiceId: string;
  private readonly ttsModel: string;
  private readonly sttModel: string;

  constructor(config: ElevenLabsConfig = {}) {
    this.apiKey = config.apiKey || process.env.ELEVENLABS_API_KEY || "";
    this.voiceId =
      config.voiceId ||
      process.env.ELEVENLABS_VOICE_ID ||
      "21m00Tcm4TlvDq8ikWAM";
    this.ttsModel =
      config.ttsModel ||
      process.env.ELEVENLABS_TTS_MODEL ||
      "eleven_flash_v2_5";
    this.sttModel =
      config.sttModel || process.env.ELEVENLABS_STT_MODEL || "scribe_v2";
  }

  async synthesize(text: string): Promise<string> {
    if (!this.apiKey) {
      // Return a base64 encoded silent/mock wav payload
      return "UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAAAAAA==";
    }

    try {
      const response = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${this.voiceId}/stream?output_format=mp3_44100_128`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "audio/mpeg",
            "xi-api-key": this.apiKey,
          },
          body: JSON.stringify({
            text,
            model_id: this.ttsModel,
            voice_settings: {
              stability: 0.5,
              similarity_boost: 0.75,
              speed: 0.88,
            },
          }),
        },
      );

      if (response.ok) {
        const arrayBuffer = await response.arrayBuffer();
        const base64 = Buffer.from(arrayBuffer).toString("base64");
        return base64;
      }

      const errText = await response.text().catch(() => "");
      console.error(
        `[ElevenLabs TTS Error]: Status ${response.status}. Body: ${errText}`,
      );
    } catch (e) {
      console.error("[ElevenLabs TTS Exception]:", e);
    }

    return "";
  }

  async transcribe(audioBase64: string): Promise<string> {
    if (!this.apiKey) {
      return "";
    }

    try {
      const buffer = Buffer.from(audioBase64, "base64");
      const blob = new Blob([buffer], { type: "audio/webm" });
      const formData = new FormData();
      formData.append("file", blob, "audio.webm");
      formData.append("model_id", this.sttModel);
      formData.append("tag_audio_events", "false");
      formData.append("num_speakers", "1");

      const response = await fetch(
        "https://api.elevenlabs.io/v1/speech-to-text",
        {
          method: "POST",
          headers: {
            "xi-api-key": this.apiKey,
          },
          body: formData,
        },
      );

      if (response.ok) {
        const data = (await response.json()) as any;
        return typeof data.text === "string" ? data.text.trim() : "";
      } else {
        const errText = await response.text().catch(() => "");
        console.error(
          `[ElevenLabs STT Error]: Status ${response.status}. Body: ${errText}`,
        );
      }
    } catch (e) {
      console.error("[ElevenLabs STT Exception]:", e);
    }

    return "";
  }
}
