<p align="center">
  <img src="icon/ringko.svg" alt="RingKo Harness" width="96" height="96">
</p>

<h1 align="center">RingKo Harness</h1>

<p align="center"><a href="README.md">English</a> | 简体中文</p>

<p align="center">
  <a href="https://github.com/RingKoAI/ringko-harness/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/RingKoAI/ringko-harness/ci.yml?branch=main&label=ci&style=flat-square" alt="CI 状态"></a>
  <a href="https://www.npmjs.com/package/@ringko-ai/rkh"><img src="https://img.shields.io/npm/v/@ringko-ai/rkh?label=npm&style=flat-square" alt="npm 版本"></a>
  <a href="https://www.npmjs.com/package/@ringko-ai/rkh"><img src="https://img.shields.io/npm/dm/@ringko-ai/rkh?label=downloads&style=flat-square" alt="npm 下载量"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-1A73E8?style=flat-square" alt="Apache-2.0 许可证"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%E2%89%A524-339933?logo=nodedotjs&logoColor=white&style=flat-square" alt="需要 Node.js 24 或更新版本"></a>
  <a href="https://bun.sh"><img src="https://img.shields.io/badge/bun-%E2%89%A51.2-fbf0df?logo=bun&logoColor=black&style=flat-square" alt="需要 Bun 1.2 或更新版本"></a>
</p>

RingKo Harness 是编码 Agent 的运行时层，而不是又一个聊天前端。它负责让 Agent
在真实仓库里靠得住的那部分：有哪些工具、某次调用是否允许、命令在哪里执行、模型
该记住什么，以及长任务如何拆分、跟踪与恢复。聊天窗口只是它上面的一个客户端。

模型可以换，界面可以换，保证不能换。

## 设计原则

- **模型是依赖，不是架构。** 所有模型都通过同一个 `ModelClient` 契约进入 harness。
  推理回放、思考预算、工具结果格式这些供应商差异在适配层消化，工具循环与会话格式
  始终保持供应商无关。
- **权限显式，默认拒绝。** 每次工具调用都先做风险评估，再交给宿主的审批门。宿主
  没有提供审批处理器时，有风险的操作直接拒绝。网络工具和 shell 执行是宿主显式
  开启的能力，不是默认配置。
- **会话状态就是数据。** 会话是只追加的 JSONL 事件日志，而不是进程内存。正因如此，
  续接、派生、轨迹检查和多客户端同步才不需要第二份事实来源。
- **一套运行时，多个界面。** 终端界面、浏览器界面和 SDK 建立在同一套工具注册表、
  审批门与会话模型之上。TUI 与 Web UI 还可以接入同一个共享后端，因此在一个界面里
  开始的运行，可以在另一个界面检查或继续。

## 快速开始

RingKo 以 `@ringko-ai/rkh` 发布，只安装一个 `ringko` 命令，用它启动任一界面。
`PATH` 上需要同时有 Node.js 24+ 和 Bun 1.2+；可执行文件是 Bun 打包产物，Bun
不是可选项。

```sh
npm install -g @ringko-ai/rkh
ringko          # 终端界面（默认）
ringko serve    # 本地后端 + 浏览器界面，会打印访问地址（默认端口 8787）
```

`ringko help` 列出全部命令；不想全局安装时可以用 `npx @ringko-ai/rkh tui`。
从源码检出运行时，下文每个 `ringko <command>` 对应
`bun packages/tui/src/cli.ts <command>`，`pnpm dev:tui` 则直接启动 TUI。

预发布版本发布在 `next` dist-tag 下：`npm install -g @ringko-ai/rkh@next`。

## 包含什么

| 层 | 内容 |
| --- | --- |
| Agent 运行时 | 流式回合循环、工具续跑、取消、自动与手动上下文压缩 |
| 内置工具 | `read`（文本、图片、PDF、Notebook）、`write`、`edit`、`glob`、`grep`、`tree`、`shell`、`webfetch`、`websearch`、`ask`、`plan`、`update_plan`、`task`、`job` |
| 策略 | 风险评估、审批门、已保存的权限规则、进入完全访问前的显式确认 |
| 沙盒 | `read-only`、`workspace-write`、`danger-full-access`；Linux 用 bubblewrap，macOS 用 Seatbelt，Windows 用受限令牌与 Job Object |
| 会话 | 事件溯源 JSONL、续接、派生、轨迹视图、使用统计 |
| 任务委派 | `read` / `write` / `full` 子代理，独立上下文与可选模型，后台执行、取消、实时进度 |
| 扩展 | MCP server、技能、`AGENTS.md` 指令、自定义供应商、宿主 SDK |

每次工具调用都要经过审批门。宿主没有提供审批处理器时，得到的是关着的门，而不是
默认放行。

## 一个后端，一份会话日志

`ringko` 和 `ringko serve` 会为「规范的 workspace + 配置」这一组合共用同一个后端。
后端把归属记录在 `~/.ringko/backends/`；TUI 启动时会发现这条记录（并以 rendezvous
端口和旧版 8787 端口作为回退），直接接入，而不是再起一个后端。同一 workspace/配置
再执行一次 `serve` 只会打印已有地址并退出；另一个程序化后端会被拒绝。用浏览器打开
打印出的后端地址，然后在两个客户端里选中同一个会话（`ringko -s <id>`）。消息、部分
输出、工具活动、审批、提问、计划与运行状态都通过这一个进程同步。断开某个客户端不会
取消正在进行的运行，要取消请使用客户端显式的停止动作。向忙碌会话并发提交会返回
HTTP 409。

`ringko` 与 `ringko serve` 默认使用**当前登记的活动项目**，而不是启动时所在的目录。
`--workspace` 是出于 CLI 兼容保留的显式覆盖。没有登记项目时，启动目录只用于首次
引导，让 UI 能添加一个项目。技能与 MCP 配置从选中的项目解析，并叠加文档说明的共享
与全局根目录。

`ringko run` / `loop` 以及嵌入式 REPL 仍在本地执行，尚未路由到归属后端。不要把它们
指向另一个活跃后端正在写入的会话。

```sh
ringko service status             # `ringko` 自动起的本地后端
ringko service stop
# 可选：手动起后端并显式连接
ringko serve --shared --workspace /path/to/project --port 8787
ringko --workspace /path/to/project --server http://127.0.0.1:8787
```

共享后端的契约与边界见 [TUI 包自述](packages/tui/README.md#shared-backend)。

## 执行边界

宿主执行默认使用 `sandbox.mode = "workspace-write"`。三种模式是 `read-only`、
`workspace-write` 和必须显式选择的 `danger-full-access`。只读模式禁止持久写入；
工作区写入模式允许工作区及显式授权目录写入；完整访问模式取消这些限制，因而是有意识
的选择。Runner 不可用时失败关闭，不会退回普通 shell。

```json
{
  "sandbox": {
    "mode": "workspace-write",
    "additionalWritableRoots": []
  }
}
```

Linux 使用 bubblewrap，macOS 使用 Seatbelt，Windows 使用受限令牌、低完整性标签、
capability-SID 写入 ACL 与 kill-on-close Job Object。Windows 交互式终端由原生
ConPTY host 在相同令牌边界下运行。Helper 源码内嵌于 npm 包和独立二进制，不再依赖
源码 sidecar。本地 MCP、REPL 显式命令、文件写入和工作区 Git 预览都遵循沙盒策略。
远程 MCP 必须在宿主设置中按端点与工具名授权，服务端自报的只读提示不能授予权限。
配置、前提、已验证行为及剩余写入边界见 [沙盒说明](SANDBOX.md)。

## 会话、委派与计划

会话是只追加的事件日志。可以续接，可以在某条消息之前分叉（fork）新会话，也可以打开聊天上方
的**轨迹**（Trajectory）查看记录下来的用户、模型、助手、工具、任务、压缩与会话事件。
序列条用于选定事件，检查器显示它存下的数据，包括失败的工具结果。过滤器与搜索作用于
已加载的事件摘要。活跃视图每三秒轮询一次，并支持加载更早的事件。

`GET /api/sessions/:id/trajectory` 与其他会话端点要求相同的授权。每页最多 50 条事件；
`before` 与 `after` 是互斥的序列游标。浏览器最多保留 1,000 条事件，单条事件详情上限
为 32,768 个字符；完整记录仍保存在会话 JSONL 中。工具耗时取自记录下来的调用/结果
时间戳。模型事件反映运行级日志；逐步的 token 用量与模型延迟尚未记录。在
**设置 → 使用统计**中查看工作区与会话的用量摘要、筛选、趋势和分页调用明细；
数据口径与限制见[使用统计说明](docs/usage-statistics.md)。

`task` 以 `read`、`write` 或 `full` 模式运行子代理。子任务拥有独立上下文，可选一个
宿主已配置的模型。`write` 自动放行工作区编辑；`full` 打开父级已拥有的全部能力。任务
支持后台执行、事件订阅与取消，完成后把结果交还给父模型。`ask` 在 TUI 与 Web UI 中
渲染提问；`plan` 读取会话计划，`update_plan` 整表替换。已有的计划快照以及保存的
权限/工作流规则仍然有效。

TUI 在输入框下方显示运行中的子代理及其最近活动；Web 聊天显示一张可检查的运行中
子任务行；`ringko run` 打印子代理的开始、工具与结果事件。轨迹按 task id 与子回合
关联任务事件，因此委派出去的一次运行可以作为父会话的一部分阅读。

## 用户级资源

配置、技能与 MCP server 都放在项目之外，归两个根目录管理（同名条目以 ringko 专属
路径为准）：

| 资源 | 位置 |
| --- | --- |
| 配置 | `~/.ringko/provider.json`、`~/.ringko/settings.local.json` |
| 技能 | `~/.ringko/skills`、`~/.agents/skills`（以及 `skill` 别名） |
| MCP server | `~/.ringko/.mcp.json`、`~/.agents/.mcp.json` |
| 会话 | `~/.ringko/sessions/**`（事件溯源 JSONL） |

`RINGKO_HOME` / `AGENTS_HOME` 可以覆盖这些主目录。用 `ringko config show`、
`ringko skills`、`ringko mcp`、`ringko session list` 查看现状。

技能发现是分层的：项目根目录优先，其次是用户主目录内祖先 workspace 的共享
`.agents` / `.ringko` 技能目录，最后是上面的主目录级根。这样嵌套仓库也能使用父级
项目目录安装的技能。MCP 注册在后端启动时加载；`GET /api/mcp/connected` 只报告当前
连接，会话运行期间不能修改 MCP 配置。

### 指令上下文

运行时托管的 Agent 会在每次主模型请求前重新加载适用的全局/项目 `AGENTS.md`（或项目
`CLAUDE.md` 作为回退），包括工具续跑以及自动/手动压缩之后的请求。当前规则会替换
早先的运行时指令块，而对话摘要保持独立。恢复会话时，即使历史里只有摘要，也会从磁盘
重新加载规则。被删除的规则会被移除；发现的文件不可读或超出限制时，请求失败，而不是
静默省略策略。限制为单文件 256 KiB、文件内容合计 1 MiB、最多 64 个文件。规则变化会
使早先的输入 token 估算失效。压缩请求使用自己的摘要提示词。

独立 SDK 宿主可以提供 `resolveInstructions`，获得同样的逐请求刷新行为。环境中的文件
发现由 `RuntimeManager` 提供。

## 工作区感知

模型有一个原生 `tree` 工具来查看目录结构，不必通过 shell 调操作系统的 `tree` 命令。
它支持深度与条目上限、隐藏文件和排除项控制，超出 workspace 的路径需要审批。`read`
对源码、目录和 Notebook 返回纯文本，并把图片与 PDF 提取成模型真正能消费的内容。
`glob` 与 `grep` 负责文件发现和搜索；`write` 与 `edit` 是仅有的两条修改工作区路径。

## 模型供应商

后端统一解析模型 token 限制，并把同一结果用于上下文 API 响应和 SDK 压缩。WebUI 与
TUI 从后端读取上下文上限。未填写的容量字段由
[Models.dev](https://models.dev/api.json) 自动补全。RingKo 自行维护
`~/.ringko/cache/models-<来源哈希>.json`，并附带离线元数据快照。缓存或快照立即可用；
过期一小时后，在使用模型时触发后台刷新，失败后间隔五分钟重试。下载、校验或落盘失败
时保留旧数据。`RINGKO_MODELS_URL` 可以指定公共 JSON 镜像；目录请求不携带供应商凭证。
远程镜像要求 HTTPS，HTTP 只接受回环开发镜像。每日快照工作流同时更新模型名称和容量
元数据。

手动配置的 `contextWindow`、`maxInputTokens`、`maxOutputTokens` 优先于目录字段。为
兼容旧配置，仅设置 `maxInputTokens` 时仍将其作为窗口覆盖值。匹配依据供应商地址与
标识、精确模型 ID 和无歧义的 canonical ID；自定义别名可用
`catalogId: "provider/model-id"` 指定映射，不会改变实际请求中的模型 ID。本地模型需
显式映射才使用目录容量。自动补全结果不会写回用户配置，也不会放入模型提示词。

总上下文窗口和输入上限分开处理。默认预留输出为 4,096 token，并受目录中的最大输出量
约束；显式 `maxOutputTokens` 会覆盖该预算。未匹配模型沿用统一的 128,000 token 回退
窗口，它是运行预算，并非探测出的容量。独立使用 SDK 时也采用同一份默认值，或使用宿主
传入的限制。Models.dev 的授权声明包含在 [NOTICE](NOTICE) 中。

模型供应商适配自 [Vercel AI SDK](https://ai-sdk.dev)。`@ringko-ai/providers` 把任意
AI SDK 语言模型包装成 harness 的 `ModelClient`；工具循环与审批门仍由 harness 持有，
因为工具声明时不带 `execute`，SDK 只返回工具调用然后停下。思考档位映射到各供应商
自己的字段：Anthropic 的 `thinking` 与 `effort`、Google 的 `thinkingConfig`、OpenAI
的 `reasoningEffort`，以及带连字符的 OpenAI 兼容端点所使用的精确 provider-option
键。助手推理只按当前供应商接受的形式回放；切换供应商时，外来推理会被丢弃，而不是
重新贴标签。

供应商**通过配置**引入，在运行时加载，因此永远不会被编进 CLI 二进制：

```json
{ "provider": { "name": "openai", "model": "gpt-4o-mini" } }
```

自定义 OpenAI 兼容端点与供应商模块也通过同一份配置提供，并在运行时导入。凭证应放在
环境变量或用户级配置中，绝不能提交进仓库；示例一律使用占位值。VS Code 扩展目前是
早期宿主包（`packages/code`），还不是完整界面。

## 开发

使用最新的 Node.js 24 LTS 补丁版本（见 `.node-version`）、pnpm 与 Bun。CI 每次运行
都会解析 Node.js 24 的最新补丁，以获取安全修复。

推送与 `packages/tui/package.json` 版本匹配的 tag 后，release 会在构建与检查通过后把
`@ringko-ai/rkh` 发布到 npm。所需的 npm Trusted Publisher 配置与本地包校验命令见
[npm 发布说明](packages/tui/NPM.md#automatic-npm-releases)。

```sh
pnpm install
pnpm test          # 全部 workspace 包
pnpm build         # code + tui + webui
```

npm 包内含 CLI、内置供应商与构建好的 WebUI。浏览器的交互式终端依赖 Node.js 与
`node-pty`。宿主配置的自定义供应商模块在运行时单独加载。发布后的变更见
[未发布变更](CHANGELOG/unreleased.md)与[变更日志](CHANGELOG/)。

## 文档

各包的自述记录该包的 API 与运行细节。本文件及其英文版本是顶层参考；两者如有歧义，
以英文版为准。

## 许可证

[Apache-2.0](LICENSE) - Copyright 2025-2026 KaguyaRing (RingKoAI)
