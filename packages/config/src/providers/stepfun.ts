import type { ProviderPreset } from "./types.ts";
export default { id: "stepfun", label: "StepFun", type: "openai-compatible", baseURL: "https://api.stepfun.com/v1", apiKeyEnv: "STEPFUN_API_KEY", auth: "apikey" } satisfies ProviderPreset;
