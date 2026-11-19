import type { ProviderPreset } from "./types.ts";
export default {
  id: "zhipu",
  label: "Zhipu (BigModel, CN)",
  type: "openai-compatible",
  builtin: true,
  baseURL: "https://open.bigmodel.cn/api/paas/v4",
  apiKeyEnv: "ZHIPUAI_API_KEY",
  apiKeyUrl: "https://bigmodel.cn/usercenter/proj-mgmt/apikeys",
  auth: "apikey",
  defaultModels: [
    { id: "glm-4.5", name: "GLM-4.5" },
    { id: "glm-4.5-air", name: "GLM-4.5 Air" },
  ],
} satisfies ProviderPreset;
