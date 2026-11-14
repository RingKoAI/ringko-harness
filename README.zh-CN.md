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

npm 安装需要 Node.js 24+，**不需要安装 Bun**。npm 按系统与 CPU 架构安装对应的
独立二进制包，`ringko` 由轻量 Node 启动器转交执行。Bun 仅是源码开发及构建工具。
此安装方式随下一次发布生效；已发布旧版 npm 包仍可能要求 Bun。

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
pnpm build:native # 源码运行先构建 Node-API 文件模块，需要 C11 编译器
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
- **消息队列。** Web UI 在运行期间将新消息排队，支持修改、删除和逐条「直接发送」。
  直接发送会先停止并等待当前回合结束，再优先发送所选消息；其余消息保留顺序。
  停止失败或请求尚未被后端接收时，所选消息及附件会保留供重试。
- **流式工具调用。** 模型生成工具参数时会实时显示为“尚未执行”的预览；参数完整、
  通过校验并获批准后才执行。取消回合会保留已经流出的回答文本，并标记为已取消。
- **委派。** 子代理以 `read`、`write` 或 `full` 模式运行，拥有独立上下文和可选模型。
  命名 provider 可接入 Claude Code、Codex、ACP 和通用 CLI 后端；进程内与 CLI 子代理
  支持追加回合和冷恢复。支持后台执行、取消，以及 TUI、Web UI 和 `ringko run` 中的
  进度显示。
- **上下文。** 自动与手动压缩；每次请求前重新加载 `AGENTS.md`；技能；MCP server。
- **供应商。** 任意 AI SDK 模型。思考档位映射到各供应商自己的字段，缺失的模型限制
  由 Models.dev 补全。
- **终端设置。** `/status` 打开 Status、Config、Usage、Stats 四页，可编辑显示、更新、
  思考档位和访问模式，查看当前会话用量及工作区统计。`/config`、`/usage`、`/stats`
  直接打开对应页面。默认展示 Stats 概览的活动热力图与双列统计，可切换 Models。
  操作方式见[终端说明](packages/repl/README.md)。

## 共享会话

`ringko` 与 `ringko web` 会为同一组 workspace/配置启动或复用一个独立后端，并登记在
`~/.ringko/backends/`。默认终端只启动终端与必要 API，**不开放网页入口**；执行 `web`
后才开放网页，并保持该 `web` 前端进程运行。多个终端和多个 `web` 都可复用同一后端。

```powershell
# 窗口一：纯终端
bun E:\Code\RingKoAI\RingKo-Harness\packages\tui\src\cli.ts --workspace E:\Code
# 窗口二：按需开启网页，复用相同后端
bun E:\Code\RingKoAI\RingKo-Harness\packages\tui\src\cli.ts web --workspace E:\Code
```

用浏览器打开打印出的地址，终端可通过 `ringko -s <id>` 进入同一会话。消息、工具活动、
审批、提问、计划和运行状态保持同步；同一忙碌会话的并发提交仍返回 HTTP 409。

- 每个终端和 `web` **进程**各持有一份租约，每 3 秒续约；普通 API 请求、SSE 订阅和
  浏览器标签页不重复计数。关闭浏览器标签页不会退出仍在运行的 `web` 命令。
- 终端退出只释放自己的租约。只要 `web` 或其他终端还在，后端继续运行；`web` 的
  Ctrl+C 也只关闭该前端。最后一个 `web` 退出后，网页入口关闭，终端不受影响。
- 最后一个前端退出后，后端等待已接收的运行、上传及资源收尾完成，再经过约 1 秒空闲
  宽限期优雅关闭，清理注册文件。断开前端不会取消已接受的任务。
- 窗口被强制关闭或进程崩溃时，租约约 15 秒后失效，再执行相同的空闲关闭检查。
- 终端连接期间工作区保持固定，避免浏览器切项目改变终端工具的目录；只剩 Web 时，
  未指定 `--shared` 的后端仍可切换项目。

`ringko service start` 显式将后端设为常驻，可用 `service stop` 手动停止；开发入口
`pnpm dev` / `pnpm dev:app` 也保留显式宿主生命周期。它们不随前端租约归零退出。
升级前已启动的旧后端不支持租约时，会提示先正常停止旧后端再重启，不强杀运行中的实例。

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
