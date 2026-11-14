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
| `opencode-go` | OpenCode Go；通过官方 Chat Completions 兼容接口访问所有 Go 文本模型 |
| `openai-oauth` | 通过 OAuth 账号访问 OpenAI |
| `anthropic-oauth` | 通过 OAuth 账号访问 Anthropic |
| `github-copilot` | GitHub Copilot |
| `xai-oauth` | 通过 OAuth 账号访问 xAI |
| `echo` | 测试与首次运行使用的离线确定性供应商 |

托管供应商必须写 `type`；省略时选择离线 `echo` 供应商。`gemini`、`grok`、
`copilot`、`chatgpt`、`compatible` 等常用别名会映射到正式类型；完整列表见
各运行时提供商文件中的 `aliases`，由 `packages/providers/src/registry.ts` 注册。

### 源码组织

每个提供商的预设独立维护在 `packages/config/src/providers/<id>.ts`，包括名称、
端点、环境变量、快捷搜索别名和密钥要求；`presets.ts` 负责显式注册。
运行时适配位于 `packages/providers/src/<type>.ts`，各自维护模型创建、发现请求、
鉴权和特殊传输设置，`registry.ts` 与 `index.ts` 负责注册分发。
例如 OpenCode Go 对应 `providers/opencode-go.ts`；DeepSeek 的配置位于
`config/src/providers/deepseek.ts`，传输复用 OpenAI-compatible 适配器。

## 自定义端点

### 在 CLI 中配置

输入不带参数的 `/connect`，直接输入提供商名称或 ID，再按 Enter。
名称与快捷别名会优先匹配，例如输入 `opencodego` 或 `go` 即可进入 OpenCode Go。
也可直接输入 `/connect opencode-go`。快捷流程只需：

1. 粘贴 API key，按 Enter；预设名称和地址自动使用默认值。
2. 自动获取模型后，输入模型名称或 ID，再按 Enter 使用。

界面只用星号显示密钥；留空则保留已有凭证或使用支持的环境变量。
自定义提供商先输入 API 根地址，再进入密钥输入。需要改名、改地址或手工指定模型时，
按 Tab 进入完整表单，之后可用 Enter 逐项完成；模型 ID 用英文逗号分隔，填写后跳过发现。
Ctrl+S 直接保存，Esc 取消。输入已配置的提供商名称可重新配置；模型切换也可用 `/model`。
失败时保留表单以便修改重试。密钥单独保存在用户的 `auth/auth.json`，
不会写入聊天记录或项目配置；使用 `--config` 时，提供商设置写入指定文件。

### OpenCode Go

在 [OpenCode Console](https://opencode.ai/console) 开通 Go 并取得 API key，然后使用
`/connect opencode-go`。也可设置 `OPENCODE_API_KEY`，并在表单中将密钥留空。
Go 默认根地址为 `https://opencode.ai/inference/go/openai/v1`；模型列表使用官方公开
接口 `https://opencode.ai/inference/go/v1/models`，查询列表时不发送 API key。

```json
{
  "name": "opencode-go",
  "type": "opencode-go",
  "models": [{ "id": "deepseek-v4-pro", "name": "DeepSeek V4 Pro" }]
}
```

OpenCode 官方支持将 Go 文本模型转换为 Chat Completions，RingKo 使用该接口访问
DeepSeek、Kimi、GLM、Claude、Gemini、GPT 等模型，无需按模型名猜测原生协议。
每次推理请求带有 RingKo User-Agent 和稳定的 `x-opencode-session`；会话标识经过
哈希，只用于传输，不进入模型消息。模型可用性与额度由 Go 账号决定。
参见 [OpenCode Go 官方说明](https://opencode.ai/docs/go/)。

### 自定义 OpenAI 兼容接口

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

Web UI 的「设置 → 提供商以及模型配置」中，每个模型都有「上下文与 token 上限」：
可直接填写总窗口、最大输入、最大输出及可选目录映射；OAuth 模型也支持这些容量设置。
留空或点击「恢复自动」会移除手动容量覆盖值，点击页面「保存」后用于后续运行。
「查看自动容量」只查询 RingKo 的目录元数据，不探测供应商端点，也不向目录发送凭证。
界面会区分目录公布的最大输出与自动预留的输出预算。参数需为安全整数范围内的正整数；
明确填写总窗口时，输入和输出的各自上限不能超过它。修改不会扩展服务商实际支持的容量。
使用 `--config` 时，页面读取并保存该文件；否则保存 `provider.json`。
重新「获取模型」会保留已有模型的容量、显示名称、目录映射及能力字段。

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
