export interface GoogleSttConfig {
  apiKey?: string;
  languageCode?: string;
}

export interface GoogleTtsConfig {
  apiKey?: string;
  voiceName?: string;
  languageCode?: string;
}

export class GoogleSttClient {
  private readonly apiKey: string;
  private readonly languageCode: string;

  constructor(config: GoogleSttConfig = {}) {
    this.apiKey = config.apiKey || process.env.GOOGLE_API_KEY || "";
    this.languageCode = config.languageCode || "en-IN";
  }

  async transcribe(audioBase64: string): Promise<string> {
    if (!this.apiKey) {
      return "[Google STT Mock] Simulated transcript of audio chunk.";
    }

    try {
      const response = await fetch(
        `https://speech.googleapis.com/v1/speech:recognize?key=${this.apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            config: {
              encoding: "WEBM_OPUS",
              sampleRateHertz: 48000,
              languageCode: this.languageCode,
            },
            audio: { content: audioBase64 },
          }),
        },
      );

      if (response.ok) {
        const data = (await response.json()) as any;
        return data.results?.[0]?.alternatives?.[0]?.transcript || "";
      }
    } catch {
      // Fallback
    }

    return "";
  }
}

export class GoogleTtsClient {
  private readonly apiKey: string;
  private readonly voiceName: string;
  private readonly languageCode: string;

  constructor(config: GoogleTtsConfig = {}) {
    this.apiKey = config.apiKey || process.env.GOOGLE_API_KEY || "";
    this.voiceName = config.voiceName || "en-IN-Wavenet-A";
    this.languageCode = config.languageCode || "en-IN";
  }

  async synthesize(text: string): Promise<string> {
    if (!this.apiKey) {
      // Return a base64 encoded silent/mock wav payload
      return "UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAAAAAA==";
    }

    try {
      const response = await fetch(
        `https://texttospeech.googleapis.com/v1/text:synthesize?key=${this.apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            input: { text },
            voice: { languageCode: this.languageCode, name: this.voiceName },
            audioConfig: { audioEncoding: "MP3" },
          }),
        },
      );

      if (response.ok) {
        const data = (await response.json()) as any;
        return data.audioContent || "";
      }
    } catch {
      // Fallback
    }

    return "";
  }
}
