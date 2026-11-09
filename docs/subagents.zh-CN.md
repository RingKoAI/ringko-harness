# 子代理

子代理让父模型把独立任务委派给拥有独立上下文的子执行体。RingKo 把每个子代理
视为一次 **provider 执行**，不同后端共享同一套父侧契约：

- 每个子代理一条持久化目录记录；
- 一个终态结果（`completed`、`failed` 或 `cancelled`）；
- 事件与轨迹写入父会话；
- 后台任务复用 run 级 `JobManager`，支持取消；
- 支持续接的 provider 可以继续对话。

## Provider

Provider 在 `~/.ringko/settings.local.json`（或 `--config` 指定文件）的
`subagents.providers` 中命名配置。未配置时使用一个进程内 provider。

| 类型 | 可续接 | 可冷恢复 | 工作区工具 | 说明 |
| --- | --- | --- | --- | --- |
| `in-process` | 是 | 是 | 是 | 拥有持久子会话，继承父级审批与 `read` / `write` / `full` 模式。 |
| `openai` | 是 | 是 | 是 | 使用 OpenAI Responses API 或 Chat Completions 的持久子会话，支持 API key 或 ChatGPT OAuth。 |
| `claude-code` | 是 | 是 | 否 | 以 `stream-json` 运行 Claude Code CLI，使用 `--resume` 续接。 |
| `codex` | 是 | 是 | 否 | 以 JSONL `exec` 运行 Codex CLI，使用 `exec resume` 续接。 |
| `acp` | 否 | 否 | 否 | 在独立子进程中运行 Agent Client Protocol 代理。 |
| `command` | 可选 | 可选 | 否 | 任意 CLI 代理的通用行协议适配器。 |

```json
{
  "subagents": {
    "default": "in-process",
    "maxActive": 4,
    "maxPerRun": 8,
    "providers": [
      { "type": "in-process", "name": "in-process" },
      {
        "type": "openai",
        "name": "openai-responses",
        "model": "gpt-6.1-sol",
        "models": ["gpt-6.1-sol", "gpt-6.1-terra", "gpt-6-astra"],
        "protocol": "responses",
        "apiKeyEnv": "OPENAI_API_KEY"
      },
      {
        "type": "openai",
        "name": "openai-chat",
        "model": "gpt-6.1-sol",
        "protocol": "chat",
        "baseURL": "https://api.openai.com/v1"
      },
      {
        "type": "openai",
        "name": "openai-oauth",
        "model": "gpt-6.1-terra",
        "protocol": "responses",
        "auth": "oauth",
        "oauthAccount": "you@example.com"
      },
      {
        "type": "claude-code",
        "name": "claude",
        "command": "claude",
        "permissionMode": "dontAsk"
      },
      {
        "type": "acp",
        "name": "acp",
        "command": "my-acp-agent",
        "args": ["--acp"],
        "permission": "reject"
      },
      {
        "type": "command",
        "name": "custom",
        "command": "my-agent",
        "args": ["--json"],
        "parser": "text"
      }
    ]
  }
}
```

### 通用 command provider

`command` 可以把任意 CLI 变成子代理。命令行参数支持 `{cwd}`、`{model}`、
`{sessionId}` 和 `{prompt}`。`{prompt}` 只允许和 `promptDelivery: "arg"` 一起
使用；默认 stdin 投递，Windows 上必须使用 stdin 以避免参数注入。

- `parser`：`text`、`claude-stream-json` 或 `codex-jsonl`。
- `resumeArgs`：续接时的 argv，需要包含 `{sessionId}`。
- `continuable` / `resume`：声明是否支持后续输入与冷恢复。
- `env`：显式追加到子进程环境的键值。
- `inheritEnv`：额外允许继承的宿主变量名，例如 API key 的变量名；缺失会明确报错。
- `timeoutMs`：外部进程截止时间，默认 120,000 毫秒。

CLI/ACP 默认仅继承系统、语言、终端、代理和配置目录等白名单变量，不再全量复制
宿主环境。`NODE_OPTIONS`、`LD_*` 等 loader 覆盖会被拒绝。stdout/stderr 各限制
2 MiB，stdout 单行 256 KiB、最多 2,048 帧；超限会失败，不会报告截断后的成功。
Windows 批处理参数中的引号、百分号、感叹号、脱字符和换行会被拒绝；需要这些参数
时请配置原生可执行文件或明确的解释器。详见[加固说明](hardening.zh-CN.md)。

### OpenAI 两种传输

一个 `openai` provider 同时支持两种 OpenAI API 形态，且共用同一套持久子会话生命周期
（工具、审批、追加回合、冷恢复）：

- `protocol: "responses"` 使用 Responses API。`auth: "api-key"`（默认）读取
  `OPENAI_API_KEY`、`apiKeyEnv` 或 `apiKey`；`auth: "oauth"` 使用
  `ringko auth login` 管理的 ChatGPT OAuth 凭据。
- OAuth2 两种登录方式都支持：浏览器 loopback/PKCE
  （`ringko auth login openai-oauth`）与设备码
  （`ringko auth login openai-oauth --device`）。Provider 读取已保存的凭据；
  多账号时用 `oauthAccount` 指定。
- `protocol: "chat"` 通过 OpenAI-compatible 传输使用 Chat Completions，需要 API key，
  支持任意兼容的 `baseURL`；该路径不支持 OAuth。

`model` 是默认模型，`models` 是可选的选择白名单。`temperature` 与
`maxOutputTokens` 应用于每次请求。子代理仍在进程内运行，因此工作区工具与父级审批
保持不变，只是模型传输不同。

## 工具

`task` 启动子代理：

| 字段 | 含义 |
| --- | --- |
| `description` | 短标签，最多 120 字符。 |
| `prompt` | 自包含任务，最多 16,384 字符。 |
| `mode` | `read`、`write` 或 `full`；外部 provider 忽略。 |
| `provider` | 已配置的 provider 名，默认取 `subagents.default`。 |
| `model` | 已配置模型 id；需要 provider 支持模型选择。 |
| `cwd` | 子代理工作目录，默认工作区。 |
| `background` | 立即返回 job id，并在首个回合结束后通知父模型。 |

`task_control` 管理已有子代理：

- `list`：返回父级目录，包含中断的历史子代理和可恢复的 provider 会话。
- `status`：返回单条目录记录。
- `send`：向可续接子代理追加一轮；上一轮已结束时会冷恢复持久子会话或 CLI 会话。
- `interrupt`：取消当前回合，保留子代理供后续使用。

`background` 任务走普通 `JobManager`；`job cancel` 和
`POST /api/sessions/:id/task-cancel` 会停止执行并写入 `cancelled` 结果。

## 持久化与冷恢复

父会话记录：

- `task/started`：provider、模式、模型、目录、是否可恢复、子会话 id；
- `task/event`：进程内子代理事件；
- `task/message`：用户/追加输入与助手文本；
- `task/status`：可续接子代理每一轮的状态；
- `task/completed`、`task/failed`、`task/cancelled`：终态结果。

进程内子代理拥有自己的会话文件，并带 `parentSession` 元数据。重启后
`task_control send` 会重新打开该会话，保留完整轨迹与工具历史。外部 provider
把原生 session/thread id 存入目录记录，通过自身 CLI 协议恢复。崩溃导致缺少终态
事件的子代理在后续查看时保持 `unknown`，不会被误显示为 `running`。

## 安全

- 进程内子代理只获得受限能力视图，所有工具调用仍经父级 registry 分发；审批、
  权限规则、沙箱策略和工具钩子保持单一来源。
- `read` 只能看到只读工具；`write` 额外获得写工具并自动批准工作区内写入；
  `full` 继承父级完整权限。所有模式都排除委派与 job 控制工具，子代理不能递归。
- 使用外部 provider，或工作目录位于工作区之外时，任务在启动前按需审批。
- 外部 provider 的命令来自用户配置，而不是模型输入；任务提示默认通过 stdin
  投递。
- 结果限制为 32,768 字符；诊断信息不包含原始 stderr、环境变量或凭据。

## 限制

- `maxActive` 限制并发子代理，`maxPerRun` 限制单次 run 的启动次数。
- 后台子代理会阻塞当前 run 直到首个回合结束，以便父模型收到结果；它不是跨 run
  常驻进程。
- 冷恢复要求 provider 仍然配置且原生会话/线程仍然存在。
- ACP 子代理只执行一次，不接受后续输入。
