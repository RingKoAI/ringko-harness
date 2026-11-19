import type { ProviderPreset } from "./types.ts";
export default {
  id: "google",
  label: "Google (Gemini)",
  type: "google",
  builtin: true,
  defaultBaseURL: "https://generativelanguage.googleapis.com/v1beta",
  apiKeyEnv: "GEMINI_API_KEY",
  apiKeyUrl: "https://aistudio.google.com/apikey",
  auth: "apikey",
  docs: "https://ai.google.dev",
  defaultModels: [
    { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
    { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
  ],
} satisfies ProviderPreset;
