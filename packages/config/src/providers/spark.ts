import type { ProviderPreset } from "./types.ts";
export default { id: "spark", label: "iFlytek Spark", type: "openai-compatible", baseURL: "https://spark-api-open.xf-yun.com/v1", apiKeyEnv: "SPARK_API_KEY", auth: "apikey" } satisfies ProviderPreset;
