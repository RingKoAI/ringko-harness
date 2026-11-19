// Explicit registration keeps standalone builds deterministic; provider details live in their own files.
import openai from "./providers/openai.ts";
import openaiCodex from "./providers/openai-codex.ts";
import anthropic from "./providers/anthropic.ts";
import anthropicOauth from "./providers/anthropic-oauth.ts";
import google from "./providers/google.ts";
import xai from "./providers/xai.ts";
import githubCopilot from "./providers/github-copilot.ts";
import githubModels from "./providers/github-models.ts";
import opencodeGo from "./providers/opencode-go.ts";
import xaiApi from "./providers/xai-api.ts";
import deepseek from "./providers/deepseek.ts";
import groq from "./providers/groq.ts";
import mistral from "./providers/mistral.ts";
import openrouter from "./providers/openrouter.ts";
import together from "./providers/together.ts";
import fireworks from "./providers/fireworks.ts";
import cerebras from "./providers/cerebras.ts";
import perplexity from "./providers/perplexity.ts";
import cohere from "./providers/cohere.ts";
import baseten from "./providers/baseten.ts";
import nvidia from "./providers/nvidia.ts";
import huggingface from "./providers/huggingface.ts";
import vercelAiGateway from "./providers/vercel-ai-gateway.ts";
import novita from "./providers/novita.ts";
import sambanova from "./providers/sambanova.ts";
import hyperbolic from "./providers/hyperbolic.ts";
import siliconflow from "./providers/siliconflow.ts";
import dashscope from "./providers/dashscope.ts";
import moonshotai from "./providers/moonshotai.ts";
import moonshotaiCn from "./providers/moonshotai-cn.ts";
import minimax from "./providers/minimax.ts";
import zai from "./providers/zai.ts";
import zhipu from "./providers/zhipu.ts";
import meta from "./providers/meta.ts";
import poe from "./providers/poe.ts";
import lmstudio from "./providers/lmstudio.ts";
import ollama from "./providers/ollama.ts";
import vllm from "./providers/vllm.ts";
import llamaCpp from "./providers/llama-cpp.ts";
import jan from "./providers/jan.ts";
import azureOpenai from "./providers/azure-openai.ts";
import geminiOpenai from "./providers/gemini-openai.ts";
import minimaxCn from "./providers/minimax-cn.ts";
import deepinfra from "./providers/deepinfra.ts";
import nebius from "./providers/nebius.ts";
import featherless from "./providers/featherless.ts";
import kluster from "./providers/kluster.ts";
import friendli from "./providers/friendli.ts";
import requesty from "./providers/requesty.ts";
import ai21 from "./providers/ai21.ts";
import upstage from "./providers/upstage.ts";
import baichuan from "./providers/baichuan.ts";
import stepfun from "./providers/stepfun.ts";
import hunyuan from "./providers/hunyuan.ts";
import volcengineArk from "./providers/volcengine-ark.ts";
import qianfan from "./providers/qianfan.ts";
import spark from "./providers/spark.ts";
import custom from "./providers/custom.ts";
import type { ProviderPreset } from "./providers/types.ts";

export type { PresetStarterModel, ProviderPreset } from "./providers/types.ts";

export const OAUTH_DOMAIN_BY_TYPE: Record<string, string> = {
  "openai-oauth": "openai-oauth",
  "github-copilot": "github-copilot",
  "xai-oauth": "xai-oauth",
};

export const PROVIDER_PRESETS: readonly ProviderPreset[] = [
  openai, openaiCodex, anthropic, anthropicOauth, google, xai, githubCopilot, githubModels,
  opencodeGo, xaiApi, deepseek, groq, mistral, openrouter, together, fireworks, cerebras,
  perplexity, cohere, baseten, nvidia, huggingface, vercelAiGateway, novita, sambanova,
  hyperbolic, siliconflow, dashscope, moonshotai, moonshotaiCn, minimax, zai, zhipu,
  meta, poe, lmstudio, ollama, vllm, llamaCpp, jan, azureOpenai, geminiOpenai, minimaxCn,
  deepinfra, nebius, featherless, kluster, friendli, requesty, ai21, upstage, baichuan,
  stepfun, hunyuan, volcengineArk, qianfan, spark, custom,
];

/** The 15 always-available built-in preset providers surfaced directly in the workbench. */
export const BUILTIN_PROVIDER_IDS: readonly string[] = [
  "openai",
  "anthropic",
  "google",
  "xai-api",
  "deepseek",
  "siliconflow",
  "dashscope",
  "volcengine-ark",
  "moonshotai-cn",
  "zhipu",
  "minimax-cn",
  "openrouter",
  "groq",
  "ollama",
  "lmstudio",
];

export const BUILTIN_PROVIDER_PRESETS: readonly ProviderPreset[] = BUILTIN_PROVIDER_IDS
  .map(id => PROVIDER_PRESETS.find(preset => preset.id === id))
  .filter((preset): preset is ProviderPreset => preset !== undefined);

export function findProviderPreset(id: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find(preset => preset.id === id);
}
