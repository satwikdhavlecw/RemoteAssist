import { buildApp } from "./app.js";
import { OpenAIRealtimeProvider } from "./providers/realtime.js";

const port = Number.parseInt(process.env.PORT ?? "4310", 10);
const host = process.env.HOST ?? "127.0.0.1";
const authMode = process.env.AUTH_MODE === "production" ? "production" : "mock";
const voiceProviderType =
  process.env.VOICE_PROVIDER?.trim().toLowerCase() || "openai_realtime";
const llmProviderType =
  process.env.LLM_PROVIDER?.trim().toLowerCase() || "openai";
const apiKey = process.env.OPENAI_API_KEY?.trim();

if (
  (voiceProviderType === "openai_realtime" || llmProviderType === "openai") &&
  !apiKey
) {
  throw new Error(
    "OPENAI_API_KEY is required when using OpenAI Realtime or OpenAI LLM. Add a server-side OpenAI API key to .env.",
  );
}

const voiceProvider = new OpenAIRealtimeProvider({
  apiKey: apiKey || "mock-key-bypass",
  model: process.env.OPENAI_REALTIME_MODEL ?? "gpt-realtime-2.1",
  voice: process.env.OPENAI_REALTIME_VOICE ?? "marin",
  transcriptionModel:
    process.env.OPENAI_REALTIME_TRANSCRIPTION_MODEL ?? "gpt-realtime-whisper",
});
const app = buildApp({ authMode, voiceProvider });

try {
  await app.listen({ port, host });
  console.log(`RemoteAssist API listening at http://${host}:${port}`);
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
