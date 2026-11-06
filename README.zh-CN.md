<p align="center">
  <img src="icon/ringko.svg" alt="RingKo Harness" width="96" height="96">
</p>

<h1 align="center">RingKo Harness</h1>

<p align="center">与模型供应商无关的编码 Agent Harness。</p>

<p align="center">
  <a href="https://github.com/RingKoAI/ringko-harness/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/RingKoAI/ringko-harness/ci.yml?branch=main&label=ci&style=flat-square" alt="CI 状态"></a>
  <a href="https://www.npmjs.com/package/@ringko-ai/rkh"><img src="https://img.shields.io/npm/v/@ringko-ai/rkh?label=npm&style=flat-square" alt="npm 版本"></a>
  <a href="https://www.npmjs.com/package/@ringko-ai/rkh"><img src="https://img.shields.io/npm/dm/@ringko-ai/rkh?label=downloads&style=flat-square" alt="npm 下载量"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-1A73E8?style=flat-square" alt="Apache-2.0 许可证"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%E2%89%A524-339933?logo=nodedotjs&logoColor=white&style=flat-square" alt="需要 Node.js 24 或更新版本"></a>
  <a href="https://bun.sh"><img src="https://img.shields.io/badge/bun-%E2%89%A51.2-fbf0df?logo=bun&logoColor=black&style=flat-square" alt="需要 Bun 1.2 或更新版本"></a>
  <a href="https://github.com/RingKoAI/ringko-harness/stargazers"><img src="https://img.shields.io/github/stars/RingKoAI/ringko-harness?label=stars&style=flat-square" alt="GitHub Star 数"></a>
</p>

<p align="center"><a href="README.md">English</a> | 简体中文</p>

RingKo 是一套 Agent Harness。它通过受审批门约束的工具注册表操作工作区，并把会话
写成只追加的事件日志。它提供终端界面和浏览器界面，两者共用同一个本地服务。

## 运行

`PATH` 上需要 Node.js 24+ 与 Bun 1.2+。发布的可执行文件是 Bun 打包产物，Bun 不是
可选项。

```sh
npm install -g @ringko-ai/rkh
ringko          # 终端界面（默认）
ringko web      # 浏览器界面，打印按 workspace 派生的访问地址
```

`ringko help` 列出全部命令。不想全局安装时，`npx @ringko-ai/rkh` 会启动终端界面。
预发布版本发布在 `next` 标签下：`npm install -g @ringko-ai/rkh@next`。

从源码运行：

```sh
pnpm install
pnpm dev:tui    # 终端界面
pnpm build      # code、tui 与 webui
```

## 功能

- **工具。** `read`、`write`、`edit`、`glob`、`grep`、`tree`、`shell`、
  `webfetch`、`websearch`、`ask`、`plan`、`update_plan`、`task`、`task_control`
  与 `job`。
  `read` 支持文本、图片、PDF 和 Notebook。
- **审批。** 每次工具调用都会做风险评估，有风险的调用等待宿主审批；没有审批处理器
  时直接拒绝。网络与 shell 工具独立于工作区工具注册。
- **沙盒。** 支持 `read-only`、`workspace-write` 与 `danger-full-access`。Linux
  使用 bubblewrap，macOS 使用 Seatbelt，Windows 使用受限令牌与 Job Object。
- **会话。** 只追加的 JSONL。可以续接、分叉，或在轨迹视图里检查事件；Web UI 提供
  使用统计，数据口径与限制见[使用统计说明](docs/usage-statistics.md)。
- **委派。** 子代理以 `read`、`write` 或 `full` 模式运行，拥有独立上下文和可选模型。
  命名 provider 可接入 Claude Code、Codex、ACP 和通用 CLI 后端；进程内与 CLI 子代理
  支持追加回合和冷恢复。支持后台执行、取消，以及 TUI、Web UI 和 `ringko run` 中的
  进度显示。
- **上下文。** 自动与手动压缩；每次请求前重新加载 `AGENTS.md`；技能；MCP server。
- **供应商。** 任意 AI SDK 模型。思考档位映射到各供应商自己的字段，缺失的模型限制
  由 Models.dev 补全。

## 共享会话

`ringko` 与 `ringko web` 会为同一组 workspace/配置启动或复用一个后端，并登记在
`~/.ringko/backends/`。用浏览器打开打印出的地址，然后在两个客户端里用
`ringko -s <id>` 选中同一个会话。消息、工具活动、审批、提问、计划和运行状态保持
同步。同一组配置再执行一次 `web` 只会打印已有地址；向忙碌会话并发提交会返回
HTTP 409。断开客户端不会取消正在进行的运行。

`ringko run`、`ringko loop` 和嵌入式 REPL 仍在本地执行。不要把它们指向另一个后端
正在写入的会话。

## 沙盒

执行默认使用 `workspace-write`。

```json
{
  "sandbox": {
    "mode": "workspace-write",
    "additionalWritableRoots": []
  }
}
```

`read-only` 禁止持久写入；`workspace-write` 允许工作区和额外根目录；
`danger-full-access` 取消这些限制。Runner 不可用时失败关闭。本地 MCP、REPL 显式
命令、文件写入和 Git 预览遵循同一策略；远程 MCP 需要在宿主设置中按端点授权。平台
细节与剩余边界见[沙盒说明](SANDBOX.md)。

## 会话与任务

会话是只追加的事件日志。`task` 以独立上下文运行子代理；`write` 自动放行工作区编辑，
`full` 打开父级已有的全部能力。`ask` 在 TUI 或 Web UI 中显示提问。`plan` 读取会话
计划，`update_plan` 整表替换。

轨迹视图显示用户、模型、助手、工具、任务、压缩和会话事件。其 API 每页最多返回 50 条
事件；浏览器保留最近 1,000 条，单条事件详情上限为 32,768 个字符。完整记录保存在会话
JSONL 中。

## 配置

| 资源 | 位置 |
| --- | --- |
| 配置 | `~/.ringko/provider.json`、`~/.ringko/settings.local.json` |
| 技能 | `~/.ringko/skills`、`~/.agents/skills` |
| MCP server | `~/.ringko/.mcp.json`、`~/.agents/.mcp.json` |
| 插件 | `~/.ringko/plugins`、`~/.agents/plugins`（信任名单在 `settings.local.json`） |
| 会话 | `~/.ringko/sessions/` |

`RINGKO_HOME` 与 `AGENTS_HOME` 可以覆盖这些主目录。用 `ringko config show`、
`ringko skills`、`ringko mcp` 和 `ringko session list` 查看现状。

供应商通过配置选择。内置供应商模块随 CLI 发布；自定义模块在运行时导入。自定义
OpenAI 兼容端点也使用同一份配置：

```json
{ "provider": { "name": "openai", "model": "gpt-6.1-sol" } }
```

思考档位映射到 Anthropic 的 `thinking`/`effort`、Google 的 `thinkingConfig`、
OpenAI 的 `reasoningEffort`，以及兼容端点对应的 provider-options 键。显式
`contextWindow`、`maxInputTokens` 和 `maxOutputTokens` 覆盖目录值；未匹配模型使用
128,000 token 的工作窗口和 4,096 token 的输出预留。Models.dev 元数据缓存在
`~/.ringko/cache/`。

运行时托管的 Agent 会在每次主模型请求前重新加载全局与项目 `AGENTS.md`（或项目
`CLAUDE.md`），压缩之后也一样。限制为单文件 256 KiB、合计 1 MiB、最多 64 个文件；
不可读或超限的文件会让请求失败。会话运行期间不能修改 MCP 配置。

## 开发

使用最新的 Node.js 24 LTS 补丁版本、pnpm 与 Bun。CI 每次运行都会解析当前补丁版本。
推送与 `packages/tui/package.json` 匹配的版本 tag 后，release 会在检查通过后发布
`@ringko-ai/rkh`；配置见 [npm 发布说明](packages/tui/NPM.md#automatic-npm-releases)。

```sh
pnpm test          # 全部 workspace 包
pnpm build         # code + tui + webui
```

npm 包内含 CLI、内置供应商与 WebUI。浏览器终端使用 `node-pty`。已发布版本之后的
变更见[未发布变更](CHANGELOG/unreleased.md)。

## 文档

- [配置](docs/configuration.zh-CN.md)
- [MCP server](docs/mcp.zh-CN.md)
- [插件](docs/plugins.zh-CN.md)
- [供应商](docs/providers.zh-CN.md)
- [技能](docs/skills.zh-CN.md)
- [子代理](docs/subagents.zh-CN.md)
- [沙盒](SANDBOX.md)
- [使用统计](docs/usage-statistics.md)

各包的自述记录该包的 API 与行为。本文件与 [README.md](README.md) 是顶层参考；
两者如有歧义，以英文版为准。

## 许可证

[Apache-2.0](LICENSE) - Copyright 2025-2026 KaguyaRing (RingKoAI)

## Star 趋势

<a href="https://www.star-history.com/#RingKoAI/ringko-harness&amp;Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=RingKoAI/ringko-harness&amp;type=Date&amp;theme=dark" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=RingKoAI/ringko-harness&amp;type=Date" />
    <img src="https://api.star-history.com/svg?repos=RingKoAI/ringko-harness&amp;type=Date" alt="Star 趋势图" />
  </picture>
</a>
