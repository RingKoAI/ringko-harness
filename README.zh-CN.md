# RingKo Harness

[English](README.md) | 简体中文

与模型供应商无关的 agent 工具集，供 RingKo 的各个人类界面共用（TUI、Web UI、VS Code
扩展）。

- **`packages/harness`** — 与供应商无关的工具注册表、风险/审批门，以及 agent 回合循环。
- **`packages/tools`** — 受审批门约束的内置工具：workspace 文件、出站网络、shell 执行。
- **`packages/sdk`** — 面向宿主的稳定公共门面（`createRingKo`）。
- **`packages/session`** — 事件溯源式会话存储（`~/.ringko/sessions`）。
- **`packages/providers`** — 基于 AI SDK 的模型供应商适配（OpenAI、Anthropic）。
- **`packages/repl`** — 基于 Ink 的交互式终端界面（`ringko tui`）。
- **`packages/protocol` / `client`** — 与平台无关的通信契约，以及共用的 HTTP/SSE 客户端。
- **`packages/app/src/services`** — 由后端持有的同步状态与在途运行状态。
- **`packages/tui` / `webui` / `app` / `code`** — 面向用户的各个界面。

每一次工具调用都要经过 harness 的审批门；审批处理器由宿主提供，未配置处理器时，有风险的
操作一律按拒绝处理（fail closed）。

## 安装与首次运行

CLI 以 `@ringko-ai/rkh` 发布在 npm 上，按全局安装使用。它要求 `PATH` 上有 Node.js 24+
**与** Bun 1.2+ —— 可执行文件是 Bun 打包产物，Bun 不是可选项：

```sh
npm install -g @ringko-ai/rkh
ringko tui
```

`ringko help` 列出命令；不想全局安装时可以用 `npx @ringko-ai/rkh tui`。从源码检出运行时，
本文档里每个 `ringko <command>` 对应 `bun packages/tui/src/cli.ts <command>`，
`pnpm dev:tui` 则直接启动 TUI。

在 Web UI 中打开一个会话，在输入区控件旁选择 **工具调用日志**（Tool call log），即可查看
已记录调用的参数、结果、状态与时间戳。没有独立 `tool/call` 事件的旧会话仍可读取。该日志也可通过
`GET /api/sessions/:id/tool-log` 分页获取，每页最多 100 条。

### 终端与浏览器共享会话

`ringko tui` 会为「规范的 workspace + 配置」这一组合自动启动或复用本地后端。用浏览器
打开它打印出的后端地址，然后在两个客户端里选中同一个会话（`ringko tui -s <id>`）。
消息、部分输出、工具活动、审批、提问、todo 与运行状态都会同步。断开某个客户端不会取消
正在进行的运行，要取消请使用客户端显式的停止动作。向忙碌会话并发提交会返回 HTTP 409。

```sh
ringko service status             # `ringko tui` 自动起的本地后端
ringko service stop
# 可选：手动起后端并显式连接
ringko serve --shared --workspace /path/to/project --port 8787
ringko tui --workspace /path/to/project --server http://127.0.0.1:8787
# 源码检出时把 `ringko <command>` 换成 `bun packages/tui/src/cli.ts <command>`；
# 只想启动 TUI 可以用 `pnpm dev:tui`。
```

共享后端的架构与已知限制，记录在仓库之外的维护者笔记中。

### 委派任务

CLI、TUI 与 Web 聊天都支持 `task`，`mode` 可取 `"read"`、`"write"` 或 `"full"`。
`write` 模式自动放行对 workspace 的编辑；`full` 模式打开父级已配置的全部能力。子任务
拥有独立上下文，并可选一个宿主已配置的模型。任务与 shell 都支持后台执行、事件订阅与取消；
完成后会用结果恢复父模型。`ask` 在 TUI/Web 中渲染提问；`todowrite`/`todoread` 负责
会话计划的持久化与恢复。任务与作业工具的上限、权限边界记录在仓库之外的维护者笔记中。

### 会话轨迹

在聊天上方选 **轨迹**（Trajectory），可查看已记录的用户、模型、助手、工具、任务、压缩与
会话事件。
序列条用于选定某个事件，检查器显示它存下的数据（包括失败的工具结果）。过滤器与搜索作用于
已加载的事件摘要。活跃视图每三秒轮询一次，并支持加载更早的事件。

`GET /api/sessions/:id/trajectory` 与其他会话端点要求相同的授权。每页最多 50 条事件；
`before` 与 `after` 是互斥的序列游标。浏览器最多保留 1,000 条事件，单条事件详情上限为
32,768 个字符；完整记录仍保存在会话 JSONL 中。工具耗时取自记录下来的调用/结果时间戳。
模型事件反映的是既有的运行级日志；逐步的 token 用量与模型延迟尚未记录。

## 用户级资源

配置、技能与 MCP server 都放在项目之外，归两个根目录管理（同名条目以 ringko 专属路径为准）：

| 资源 | 位置 |
| --- | --- |
| 配置 | `~/.ringko/provider.json`、`~/.ringko/settings.local.json` |
| 技能 | `~/.ringko/skills`、`~/.agents/skills`（以及 `skill` 别名） |
| MCP server | `~/.ringko/.mcp.json`、`~/.agents/.mcp.json` |
| 会话 | `~/.ringko/sessions/**`（事件溯源 JSONL） |

`RINGKO_HOME` / `AGENTS_HOME` 可以覆盖这些主目录。用 `ringko config show`、
`ringko skills`、`ringko mcp`、`ringko session list` 查看现状。

## 目录结构

查看目录结构时，模型有一个原生 `tree` 工具，不必再通过 `shell` 调操作系统的 `tree`。
它支持深度/条目上限、隐藏文件与排除项控制，超出 workspace 的路径需要审批。

## 模型供应商

模型供应商适配自 [Vercel AI SDK](https://ai-sdk.dev)。`@ringko-ai/providers` 把任意
AI SDK 语言模型包装成 harness 的 `ModelClient`；工具循环与审批门仍由 harness 持有
（工具声明时不带 `execute`，因此 SDK 只返回工具调用然后停下）。

供应商**通过配置**引入，在运行时加载，因此永远不会被编进 CLI 二进制：

```json
{ "provider": { "name": "openai", "model": "gpt-4o-mini" } }
```

自定义 OpenAI 兼容端点、以及读取 VS Code 的 providers 文件，记录在仓库之外的维护者笔记中。
不要把真实的 API key 或端点 URL 提交进仓库——示例一律使用占位值。

## 开发

使用最新的 Node.js 24 LTS 补丁版本（见 `.node-version`）、pnpm 与 Bun。CI 每次运行都会
解析 Node.js 24 的最新补丁，以获取安全修复。

推送与 `packages/tui/package.json` 版本匹配的 tag 后，release 会在构建与检查通过后把
`@ringko-ai/rkh` 发布到 npm。所需的 npm Trusted Publisher 配置与本地包校验命令见
[npm 发布说明](packages/tui/NPM.md#automatic-npm-releases)。

```sh
pnpm install
pnpm test          # 全部 workspace 包
pnpm build         # code + tui + webui
```

## 文档

设计说明、对照报告与工具参考属于维护者文档，保存在本仓库之外。本 README、它的英文版本
与各包的 README 是仓库内的权威参考；两者如有歧义，以英文版为准。

## 许可证

[Apache-2.0](LICENSE) - Copyright 2025-2026 KaguyaRing (RingKoAI)
