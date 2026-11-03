# 供应商

供应商与模型选择定义在 `~/.ringko/provider.json`：

```json
{
  "model": "DeepSeek/deepseek-chat",
  "small_model": "DeepSeek/deepseek-chat",
  "providers": [
    {
      "name": "DeepSeek",
      "type": "openai-compatible",
      "baseURL": "https://api.deepseek.com/v1",
      "models": [
        { "id": "deepseek-chat", "name": "DeepSeek Chat", "toolCalling": true },
        { "id": "deepseek-reasoner", "name": "DeepSeek Reasoner", "thinking": true }
      ]
    }
  ]
}
```

`model` 使用 `<供应商 name>/<模型 id>`。匹配不到时使用第一个供应商及其第一个模型。
`small_model` 可选，用于压缩和会话元数据。

## 供应商类型

| `type` | 传输 |
| --- | --- |
| `openai` | OpenAI API |
| `anthropic` | Anthropic Messages API |
| `google` | Google Generative AI |
| `openai-compatible` | 任意 OpenAI 兼容 chat-completions 端点；必须提供 `baseURL` |
| `openai-oauth` | 通过 OAuth 账号访问 OpenAI |
| `anthropic-oauth` | 通过 OAuth 账号访问 Anthropic |
| `github-copilot` | GitHub Copilot |
| `xai-oauth` | 通过 OAuth 账号访问 xAI |
| `echo` | 测试与首次运行使用的离线确定性供应商 |

托管供应商必须写 `type`；省略时选择离线 `echo` 供应商。`gemini`、`grok`、
`copilot`、`chatgpt`、`compatible` 等常用别名会映射到正式类型；完整列表见
`packages/providers/src/loader.ts` 中的 `TYPE_ALIASES`。

## 自定义端点

```json
{
  "name": "Local",
  "type": "openai-compatible",
  "baseURL": "http://127.0.0.1:8000/v1",
  "apiKey": "local",
  "models": [{ "id": "my-model", "name": "My Model" }]
}
```

`baseURL` 指向 API 根地址，而不是 chat-completions 路径。模型项也可以用 `url`
提供完整的 chat-completions 地址，RingKo 会从中推导 base URL。需要自定义模块的
供应商可以把 `module` 指向导出 `createProviderClient` 的包，该模块在运行时导入；
内置供应商模块随 CLI 发布。

## 凭证

凭证来自供应商的 `apiKey`，或 `~/.ringko/auth/auth.json` 中按供应商 `name` 查找的
记录：

```sh
ringko auth set DeepSeek sk-...
ringko auth status
ringko auth logout DeepSeek
```

OAuth 供应商使用 `ringko auth login`：

```sh
ringko auth login openai-oauth
ringko auth login github-copilot
ringko auth login anthropic-oauth
ringko auth login xai-oauth
```

`ringko auth login openai-oauth --device` 使用设备码流程。OAuth 账号按域分组；
保存多个账号时，用 `ringko auth default <domain> <account-id>` 选择默认账号。
不要把 API key、令牌或带凭证的端点 URL 提交进仓库。

内置 OpenAI 与 Anthropic 供应商在 RingKo 没有配置密钥时，也会通过 AI SDK 读取
`OPENAI_API_KEY` 与 `ANTHROPIC_API_KEY`。

## 模型与限制

模型项支持：

| 字段 | 含义 |
| --- | --- |
| `id` | 请求中发送的模型 id，必填。 |
| `name` | TUI 与 Web UI 中的显示名称。 |
| `thinking` | 模型是否支持推理。 |
| `vision` | 模型是否接受图片。 |
| `toolCalling` | 模型是否支持工具调用。 |
| `contextWindow` | 总上下文窗口。 |
| `maxInputTokens` | 仅输入的 token 上限。 |
| `maxOutputTokens` | 输出上限与预留覆盖值。 |
| `catalogId` | 精确的 Models.dev 映射，格式 `provider/model-id`。 |
| `url` | 单模型 chat-completions 地址。 |

显式 `contextWindow`、`maxInputTokens` 与 `maxOutputTokens` 优先于目录值。总窗口与
仅输入上限分开处理。没有可用值时，RingKo 使用 128,000 token 的工作窗口，并预留
4,096 个输出 token。目录里的输出上限不会自动变成预留值。

缺失的限制由 [Models.dev](https://models.dev/api.json) 补全。RingKo 按供应商端点或
身份、精确模型 id 和无歧义的 canonical id 匹配。别名应使用 `catalogId`，结果确定。
回环或其他本地地址的模型除非设置 `catalogId`，否则不查目录。自动补全结果不会写回
`provider.json`，也不会加入模型提示词。

目录缓存在 `~/.ringko/cache/models-<来源哈希>.json`，并以随包附带的离线快照回退。
缓存有效期为 1 小时；刷新失败后 5 分钟重试，并保留旧数据。`RINGKO_MODELS_URL` 可以
指定兼容镜像；除回环外要求 HTTPS。供应商凭证不会发送到目录地址。

## 思考字段

`thinking` 取 `off`、`low`、`high` 或 `max`，各供应商收到的字段不同：

| 供应商 | 请求字段 |
| --- | --- |
| Anthropic | `thinking` 与 `effort`；旧模型使用 token 预算 |
| Google 2.5 | `thinkingConfig.thinkingBudget` |
| Google 3 | `thinkingConfig.thinkingLevel` |
| OpenAI | `reasoningEffort` |
| OpenAI 兼容、xAI、Copilot | 对应 provider-options 键加 `reasoningEffort` |

助手推理只按当前供应商接受的形式回放：Anthropic 使用带签名的思考，Google 使用
thought signature，OpenAI 使用 provider items，兼容端点使用 reasoning content。
切换供应商时，外来推理会被丢弃，而不是重新贴标签。

## 发现模型

```sh
ringko models                 # 发现当前供应商的模型
ringko models DeepSeek        # 发现指定供应商的模型
```

发现结果会把新的模型 id 追加到供应商条目，不删除已有模型。TUI 与 Web UI 的模型选择器
读取同一份配置。
