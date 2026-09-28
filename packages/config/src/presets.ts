// Built-in provider presets (data, not code). Each entry maps to an rkh provider
// type; most are OpenAI-compatible endpoints. Model lists are discovered live or
// filled from the catalog, so presets stay small and current.
export interface ProviderPreset {
  /** Stable id (used as the default provider name). */
  id: string;
  label: string;
  /** rkh provider type: openai | anthropic | google | openai-compatible | openai-oauth | github-copilot | xai-oauth. */
  type: string;
  /** Base URL for OpenAI-compatible (or custom) endpoints. */
  baseURL?: string;
  /** Suggested API-key environment variable name. */
  apiKeyEnv?: string;
  auth?: "apikey" | "oauth";
  docs?: string;
}

export const OAUTH_DOMAIN_BY_TYPE: Record<string, string> = {
  "openai-oauth": "openai-oauth",
  "github-copilot": "github-copilot",
  "xai-oauth": "xai-oauth",
};

export const PROVIDER_PRESETS: readonly ProviderPreset[] = [
  // First-party / OAuth
  { id: "openai", label: "OpenAI", type: "openai", apiKeyEnv: "OPENAI_API_KEY", auth: "apikey", docs: "https://platform.openai.com/docs" },
  { id: "openai-codex", label: "OpenAI (ChatGPT OAuth)", type: "openai-oauth", auth: "oauth" },
  { id: "anthropic", label: "Anthropic (Claude)", type: "anthropic", apiKeyEnv: "ANTHROPIC_API_KEY", auth: "apikey", docs: "https://docs.anthropic.com" },
  { id: "anthropic-oauth", label: "Anthropic (Claude Pro/Max OAuth)", type: "anthropic-oauth", auth: "oauth" },
  { id: "google-gemini-cli", label: "Google (Gemini CLI OAuth)", type: "google-gemini-cli", auth: "oauth", docs: "https://github.com/google-gemini/gemini-cli" },
  { id: "google", label: "Google (Gemini)", type: "google", apiKeyEnv: "GEMINI_API_KEY", auth: "apikey", docs: "https://ai.google.dev" },
  { id: "xai", label: "xAI (Grok OAuth)", type: "xai-oauth", auth: "oauth" },
  { id: "github-copilot", label: "GitHub Copilot", type: "github-copilot", auth: "oauth" },
  { id: "github-models", label: "GitHub Models", type: "openai-compatible", baseURL: "https://models.github.ai/inference", apiKeyEnv: "GITHUB_TOKEN", auth: "apikey" },

  // OpenAI-compatible gateways / APIs
  { id: "xai-api", label: "xAI (API key)", type: "openai-compatible", baseURL: "https://api.x.ai/v1", apiKeyEnv: "XAI_API_KEY", auth: "apikey" },
  { id: "deepseek", label: "DeepSeek", type: "openai-compatible", baseURL: "https://api.deepseek.com/v1", apiKeyEnv: "DEEPSEEK_API_KEY", auth: "apikey" },
  { id: "groq", label: "Groq", type: "openai-compatible", baseURL: "https://api.groq.com/openai/v1", apiKeyEnv: "GROQ_API_KEY", auth: "apikey" },
  { id: "mistral", label: "Mistral", type: "openai-compatible", baseURL: "https://api.mistral.ai/v1", apiKeyEnv: "MISTRAL_API_KEY", auth: "apikey" },
  { id: "openrouter", label: "OpenRouter", type: "openai-compatible", baseURL: "https://openrouter.ai/api/v1", apiKeyEnv: "OPENROUTER_API_KEY", auth: "apikey" },
  { id: "together", label: "Together AI", type: "openai-compatible", baseURL: "https://api.together.xyz/v1", apiKeyEnv: "TOGETHER_API_KEY", auth: "apikey" },
  { id: "fireworks", label: "Fireworks AI", type: "openai-compatible", baseURL: "https://api.fireworks.ai/inference/v1", apiKeyEnv: "FIREWORKS_API_KEY", auth: "apikey" },
  { id: "cerebras", label: "Cerebras", type: "openai-compatible", baseURL: "https://api.cerebras.ai/v1", apiKeyEnv: "CEREBRAS_API_KEY", auth: "apikey" },
  { id: "perplexity", label: "Perplexity", type: "openai-compatible", baseURL: "https://api.perplexity.ai", apiKeyEnv: "PERPLEXITY_API_KEY", auth: "apikey" },
  { id: "cohere", label: "Cohere", type: "openai-compatible", baseURL: "https://api.cohere.ai/compatibility/v1", apiKeyEnv: "COHERE_API_KEY", auth: "apikey" },
  { id: "baseten", label: "Baseten", type: "openai-compatible", baseURL: "https://inference.baseten.co/v1", apiKeyEnv: "BASETEN_API_KEY", auth: "apikey" },
  { id: "nvidia", label: "NVIDIA NIM", type: "openai-compatible", baseURL: "https://integrate.api.nvidia.com/v1", apiKeyEnv: "NVIDIA_API_KEY", auth: "apikey" },
  { id: "huggingface", label: "Hugging Face", type: "openai-compatible", baseURL: "https://router.huggingface.co/v1", apiKeyEnv: "HF_TOKEN", auth: "apikey" },
  { id: "vercel-ai-gateway", label: "Vercel AI Gateway", type: "openai-compatible", baseURL: "https://ai-gateway.vercel.sh/v1", apiKeyEnv: "AI_GATEWAY_API_KEY", auth: "apikey" },
  { id: "novita", label: "Novita AI", type: "openai-compatible", baseURL: "https://api.novita.ai/v3/openai", apiKeyEnv: "NOVITA_API_KEY", auth: "apikey" },
  { id: "sambanova", label: "SambaNova", type: "openai-compatible", baseURL: "https://api.sambanova.ai/v1", apiKeyEnv: "SAMBANOVA_API_KEY", auth: "apikey" },
  { id: "hyperbolic", label: "Hyperbolic", type: "openai-compatible", baseURL: "https://api.hyperbolic.xyz/v1", apiKeyEnv: "HYPERBOLIC_API_KEY", auth: "apikey" },
  { id: "siliconflow", label: "SiliconFlow", type: "openai-compatible", baseURL: "https://api.siliconflow.cn/v1", apiKeyEnv: "SILICONFLOW_API_KEY", auth: "apikey" },
  { id: "dashscope", label: "Alibaba Cloud (DashScope)", type: "openai-compatible", baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1", apiKeyEnv: "DASHSCOPE_API_KEY", auth: "apikey" },
  { id: "moonshotai", label: "Moonshot (Kimi, global)", type: "openai-compatible", baseURL: "https://api.moonshot.ai/v1", apiKeyEnv: "MOONSHOT_API_KEY", auth: "apikey" },
  { id: "moonshotai-cn", label: "Moonshot (Kimi, CN)", type: "openai-compatible", baseURL: "https://api.moonshot.cn/v1", apiKeyEnv: "MOONSHOT_API_KEY", auth: "apikey" },
  { id: "minimax", label: "MiniMax", type: "openai-compatible", baseURL: "https://api.minimax.io/v1", apiKeyEnv: "MINIMAX_API_KEY", auth: "apikey" },
  { id: "zai", label: "Z.ai (GLM)", type: "openai-compatible", baseURL: "https://api.z.ai/api/paas/v4", apiKeyEnv: "ZAI_API_KEY", auth: "apikey" },
  { id: "zhipu", label: "Zhipu (BigModel, CN)", type: "openai-compatible", baseURL: "https://open.bigmodel.cn/api/paas/v4", apiKeyEnv: "ZHIPUAI_API_KEY", auth: "apikey" },
  { id: "meta", label: "Meta Llama API", type: "openai-compatible", baseURL: "https://api.llama.com/compat/v1", apiKeyEnv: "LLAMA_API_KEY", auth: "apikey" },
  { id: "poe", label: "Poe", type: "openai-compatible", baseURL: "https://api.poe.com/v1", apiKeyEnv: "POE_API_KEY", auth: "apikey" },
  { id: "lmstudio", label: "LM Studio (local)", type: "openai-compatible", baseURL: "http://127.0.0.1:1234/v1", auth: "apikey" },
  { id: "ollama", label: "Ollama (local)", type: "openai-compatible", baseURL: "http://127.0.0.1:11434/v1", auth: "apikey" },
  { id: "vllm", label: "vLLM (local)", type: "openai-compatible", baseURL: "http://localhost:8000/v1", auth: "apikey" },
  { id: "llama-cpp", label: "llama.cpp server (local)", type: "openai-compatible", baseURL: "http://localhost:8080/v1", auth: "apikey" },
  { id: "jan", label: "Jan (local)", type: "openai-compatible", baseURL: "http://localhost:1337/v1", auth: "apikey" },
  { id: "azure-openai", label: "Azure OpenAI", type: "openai-compatible", baseURL: "https://YOUR-RESOURCE.openai.azure.com/openai/v1", apiKeyEnv: "AZURE_OPENAI_API_KEY", auth: "apikey" },

  // More OpenAI-compatible providers
  { id: "gemini-openai", label: "Gemini (OpenAI-compat)", type: "openai-compatible", baseURL: "https://generativelanguage.googleapis.com/v1beta/openai", apiKeyEnv: "GEMINI_API_KEY", auth: "apikey" },
  { id: "minimax-cn", label: "MiniMax (CN)", type: "openai-compatible", baseURL: "https://api.minimaxi.com/v1", apiKeyEnv: "MINIMAX_API_KEY", auth: "apikey" },
  { id: "deepinfra", label: "DeepInfra", type: "openai-compatible", baseURL: "https://api.deepinfra.com/v1/openai", apiKeyEnv: "DEEPINFRA_API_KEY", auth: "apikey" },
  { id: "nebius", label: "Nebius AI Studio", type: "openai-compatible", baseURL: "https://api.studio.nebius.ai/v1", apiKeyEnv: "NEBIUS_API_KEY", auth: "apikey" },
  { id: "featherless", label: "Featherless AI", type: "openai-compatible", baseURL: "https://api.featherless.ai/v1", apiKeyEnv: "FEATHERLESS_API_KEY", auth: "apikey" },
  { id: "kluster", label: "Kluster.ai", type: "openai-compatible", baseURL: "https://api.kluster.ai/v1", apiKeyEnv: "KLUSTER_API_KEY", auth: "apikey" },
  { id: "friendli", label: "FriendliAI", type: "openai-compatible", baseURL: "https://api.friendli.ai/serverless/v1", apiKeyEnv: "FRIENDLI_TOKEN", auth: "apikey" },
  { id: "requesty", label: "Requesty", type: "openai-compatible", baseURL: "https://router.requesty.ai/v1", apiKeyEnv: "REQUESTY_API_KEY", auth: "apikey" },
  { id: "ai21", label: "AI21 Labs", type: "openai-compatible", baseURL: "https://api.ai21.com/studio/v1", apiKeyEnv: "AI21_API_KEY", auth: "apikey" },
  { id: "upstage", label: "Upstage", type: "openai-compatible", baseURL: "https://api.upstage.ai/v1", apiKeyEnv: "UPSTAGE_API_KEY", auth: "apikey" },
  { id: "baichuan", label: "Baichuan", type: "openai-compatible", baseURL: "https://api.baichuan-ai.com/v1", apiKeyEnv: "BAICHUAN_API_KEY", auth: "apikey" },
  { id: "stepfun", label: "StepFun", type: "openai-compatible", baseURL: "https://api.stepfun.com/v1", apiKeyEnv: "STEPFUN_API_KEY", auth: "apikey" },
  { id: "hunyuan", label: "Tencent Hunyuan", type: "openai-compatible", baseURL: "https://api.hunyuan.cloud.tencent.com/v1", apiKeyEnv: "HUNYUAN_API_KEY", auth: "apikey" },
  { id: "volcengine-ark", label: "Volcengine Ark (Doubao)", type: "openai-compatible", baseURL: "https://ark.cn-beijing.volces.com/api/v3", apiKeyEnv: "ARK_API_KEY", auth: "apikey" },
  { id: "qianfan", label: "Baidu Qianfan", type: "openai-compatible", baseURL: "https://qianfan.baidubce.com/v2", apiKeyEnv: "QIANFAN_API_KEY", auth: "apikey" },
  { id: "spark", label: "iFlytek Spark", type: "openai-compatible", baseURL: "https://spark-api-open.xf-yun.com/v1", apiKeyEnv: "SPARK_API_KEY", auth: "apikey" },
  { id: "custom", label: "Custom (OpenAI-compatible)", type: "openai-compatible", auth: "apikey" },
];

export function findProviderPreset(id: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((preset) => preset.id === id);
}
