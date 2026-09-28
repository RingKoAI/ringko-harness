# DeepSeek Harness 与 RingKo Harness 全量对照

本文对照本地两份实现：参考实现 `Example/deepseek-harness`（下称 **dsh**）与本仓库
（下称 **RKH**）。结论来自两个仓库的源码与各自文档，不含推测；每条否定结论都指向
可核对的文件。

范围说明：RKH 侧以**工作区当前状态**（`main` = `eb2855a` 加未提交改动）为准。工作区
在每轮对照之间变化很大，第 0 节按轮次列出增量；因增量而失效的判断已就地改正。

## 0. 增量记录

### 第四轮（当前）

新增两个包，其中一个是本对照反复提到的 seam。

| 判断 | 现状 |
| --- | --- |
| 「RKH 没有能力 seam，工具直接 import `node:fs`」 | **开始搭了**。新增 `packages/runtime`（94 行）：`EventBus` 实现 dsh 的**四种分发语义**——`emit`（fire-and-forget，不改事件）、`parallel`（等全部）、`serial`（注册序，首个 reject 中断）、`waterfall`（链式传 `next`，不调 `next` 即短路）。`on()` / `onWaterfall()` 返回 disposer，注释写明「features (workflows, permissions, plugins) can register and unregister contributions independently」 |
| 「workflow 的工具 allow/deny 没有执行点，属于死代码」 | 降级为**宿主侧未接**。`workflow` 从 `config` 独立成包，新增 `routeWorkflow()` 返回 `WorkflowRoute{id, instructions, model?, tools?}`，把已解析的动作交给宿主，符合 dsh 的「defaulting is an explicit `resolve(request): Spec` step in the owning implementation」。宿主已改从 `@ringko-ai/workflow` 导入，但仍只用 `instructions` |
| 「新代码不写测试」 | **对这两个新包不成立**：`runtime` 94 行源码配 72 行测试（比 0.77，高于仓库均值），`workflow` 158 配 41。滞后的是 `config` 的 presets / tool-auth 与 `auth` 的 anthropic / 配额查询 |
| 本文档的绝对行数 | **早前版本偏低 7–12%**。原因是我用 `Get-Content \| Measure-Object -Line` 计数，它不计空行（`agent.ts` 真实 279 行报 253）。已全部改用显式 UTF-8 的 `ReadAllLines` 重算。比值与结论方向不变 |

### 第三轮

| 首轮或次轮的判断 | 现状 |
| --- | --- |
| 「OAuth 是三个（ChatGPT / Copilot / xAI）」 | 新增 **Anthropic Claude Pro/Max OAuth**，现在是四个 |
| 「provider 支持 7 种」 | 新增 `anthropic-oauth`，且引入 **57 条 provider 预设**（`packages/config/src/presets.ts`），本地推理端点（LM Studio / Ollama / vLLM / llama.cpp / Jan）也在内 |
| 「MCP 只有三种 transport 与工具注册」 | 新增 **MCP OAuth**（`packages/mcp/src/oauth.ts`）：RFC 9728 protected-resource 元数据 → RFC 8414 授权服务器元数据 → RFC 7591 动态客户端注册 → authorization code + PKCE，token 落 `tool.auth.json` |
| 「凭证只有 `auth.json` 与 `provider.json`」 | 新增 **`tool.auth.json`**（工具/连接器凭证，支持 `oauth` / `apikey` / `headers` 三种形态）与 **`workflows.json`** |
| 「Skills / MCP 只看用户级双根」 | 增加**项目级**资源：`findProjectRoot()` 以 `.git` / `.mcp.json` / `ringko.json` / `.agents` 为标记向上查找，项目内 `.mcp.json` 与 skills 以 `scope: "project"` 参与合并 |
| 「审批通过后执行，无 TOCTOU 防护」 | **已补**。`approvedTarget` 由 gate 从 `risk.target` 捕获并在 dispatch 时重新比对，`write` / `edit` 不一致即报 "target changed after approval; retry the call"（见第 6 节） |

### 第二轮

| 首次对照的判断 | 现状 |
| --- | --- |
| 「MCP 只到配置层，运行时没有客户端，工具进不了 registry」 | **已实现**。新增 `packages/mcp`：三种 transport，工具注册为受审批门约束的 harness 工具 |
| 「RKH 没有子代理」 | 已在首次对照中更正；`task` 扩到 **read / write / full** 三模式，支持选择宿主已配置的模型，并支持后台执行 |
| 「没有后台任务」 | **已实现**。`JobManager` 加 `job` / `subscribe` 工具，shell 与 task 都可 `background: true`，并有父级继续机制 |
| 「`workspace.ts` 承认缺 realpath re-check，调用方没做」 | **写入路径已补**。`resolveWriteTarget()` canonicalize 根与目标；**读取路径仍是词法解析**（见第 6 节） |
| 「OAuth 是 OpenAI 与 GitHub Copilot」 | 新增 **xAI / Grok** OAuth |
| 「技能正文不注入模型」 | **仍然如此**，但新增 ambient 指令文件加载（`AGENTS.md` / `CLAUDE.md`） |
| 「Web UI 7 个页面」 | 页面重组：`SettingsPage` 删除，新增 `OAuthPage`、task-panel、job-panel、question-panel、trajectory-view |

## 1. 量级

统计口径：`src` / `tests` 目录下的 `.ts` / `.tsx`，排除 `node_modules` / `lib` / `dist`，
行数用显式 UTF-8 的 `ReadAllLines`（**含空行**）。RKH 侧仍在被编辑，数字是某一时刻的快照。

| | dsh | RKH |
| --- | --- | --- |
| 语言 / 运行时 | TypeScript，Node ^22.19 \|\| >=24 | TypeScript，Bun |
| 包管理器 | pnpm 11.7.0 | pnpm 10.33.4（锁定 `bun.lock` 亦存在） |
| workspace 包数 | 321 | 15 |
| `packages/*/src` 文件 / 行 | 2340 / 401,670 | 157 / 20,144 |
| `packages/*/tests` 文件 / 行 | 1828 / 523,604 | 47 / 3,499 |
| apps / scripts | 503 文件 / 87,353 行、320 文件 / 65,299 行（旧口径） | 无独立 apps 目录 |
| 测试与源码行数比 | **1.30** | **0.17** |
| 文档 | 351 篇 md，另有 2412 篇 Agent Note、14 个 skill | 4 篇 md + 9 个包 README |
| CI workflow | 20 个 | 3 个（`ci.yml`、`release.yml`、`models-snapshot.yml`） |
| 许可证 | MIT | Apache-2.0（所有包 `private: true`） |

RKH 各包 `src` 行数（含空行）：

```
webui      58 files    7750 lines
repl       21 files    1826 lines
config     13 files    1498 lines
app         4 files    1448 lines
tools      12 files    1230 lines
session    13 files    1151 lines
harness     7 files    1012 lines
auth        8 files     981 lines
tui         2 files     907 lines
providers   9 files     846 lines
mcp         5 files     774 lines
sdk         2 files     448 lines
workflow    1 file      158 lines   (第四轮新增)
runtime     1 file       94 lines   (第四轮新增)
code        1 file       18 lines
```

`runtime`（94 行）是全部源码里最小的包之一，但它可能是结构上最重要的一个——第 2 节说明。

dsh 最大的几个包组是 `client`（1001 文件 / 134,329 行）、`experimental`（306 / 41,049）、
`extensions`（40 / 21,167）、`api`（92 / 20,515）、`session`（98 / 17,893）、
`core`（46 / 14,773）、`llm`（74 / 13,552）、`subagent`（46 / 10,838）。仅 `packages/client`
一个组仍是 RKH 全部源码的约 6.7 倍。

这不只是投入差异。dsh 把「界面」当成 61 个可替换的 client 插件；RKH 的 webui 是一个
58 文件的 React 应用，repl 是 21 文件的 Ink 应用。

## 2. 架构内核

**dsh：Cordis 全插件树。** 服务、类型化事件、可逆 effect 挂在同一个 context 上。
agent loop、模型适配器、工具注册表、会话日志本身都是插件，都能被配置文件里的一行
替换。启动是一条 profile 叠 bundle 再叠 `cordis.patch.yml` 的链条，实际发货 5 个
profile：`web`、`headless`、`sdk`、`sdk-minimal`、`acp`。文档里的主张是「没有需要
打补丁的特权核心」。

关键机制：

- **注册即 effect**：`ctx.effect()` / `ctx.on()`，插件的 `register()` 返回 disposer，
  卸载时自动撤回。HMR 依赖这条。
- **瀑布语义**：`agent/pre-step`、`agent/request`、`llm/stream`、`tools/pre-execute`、
  `tools/execute`、`tools/post-execute` 是 waterfall，监听者必须调 `next()` 才能放行。
- **能力 seam**：一项能力由 Service Definition / Service Provider / Consumer 三个角色
  组成。换 `ctx.fs` 或 `ctx.subprocess` 的 provider，bash、PTY、LSP 一起搬走。

**RKH：13 个包直接互相 import。** 内核是 `packages/harness` 里的 `Agent` +
`ToolRegistry` + `gate()` 三个东西，宿主通过 `createRingKo(config)` 拿到一个 `RingKo`
门面。工具在 `packages/tools` 里直接 `import node:fs/promises`，没有 provider 层。

RKH 的设计取向与它自己的历史一致：README 把 harness 定义为「provider-neutral 工具
注册表、风险门和回合循环」，这是一个库，不是一个可组合运行时。`packages/session`
的注释里写着 event-sourced「following the model used by DeepSeek Harness」，说明
日志模型是刻意对齐的，插件树不是。

**判断**：这一层不该照搬。Cordis 的代价（effect 生命周期、HMR、一整套包不变量门禁、
profile / bundle / patch 三层配置装配）需要几百个包才摊得平。RKH 值得从 dsh 拿的是
三条不变量加一套分发语义，不是框架：

1. 模型看见的内容必须能从日志重建。
2. 能力通过接口替换，而不是通过 import。
3. 监听者可以拦截，但不能绕过执行器。

**第 3 条的原语开始出现了。** `packages/runtime` 的 `EventBus`（94 行）提供 dsh 的四种
分发语义，且 `on()` / `onWaterfall()` 返回 disposer：

| 方法 | 语义 |
| --- | --- |
| `emit(name, event)` | fire-and-forget；不 await、不改事件、不向上传播监听者失败 |
| `parallel(name, event)` | await 全部监听者，顺序无关；任一 reject 向上抛 |
| `serial(name, event)` | 按注册顺序 await，首个 reject 中断 |
| `waterfall(name, event)` | 链式传 `next`；**不调 `next` 即短路**，调了可替换事件；返回最终事件 |

waterfall 的实现细节与 dsh 一致：监听者返回 `undefined` 不改变事件，返回一个值则替换。
dsh 的 `agent/pre-step`、`agent/request`、`llm/stream`、`tools/*` 都是这种语义，而 RKH
原来的 `AgentEvent` 只是四个类型加上一个 `onEvent` 回调，无法叠加、无法撤回。

这套语义是**值得照抄的那部分 Cordis**——它是「插件能拦截但不能绕过」的机械保证：
`tools/post-execute` 那种「只能 accept 或 block、无法 allow」的单调性就靠分发语义和
决策类型共同实现。RKH 现在有了分发语义，还缺与之配套的**决策类型**（当前只有审批的
`boolean`）。

对新代码有一条具体意见：`emit` 用 `void listener(event)` 丢弃了 promise，所以异步
监听者 reject 会变成 unhandled rejection——`try/catch` 只拦同步抛。dsh 在同类位置
（`tools/result` 的 emit）用 logger.warn 兜住。最小修法是
`void Promise.resolve(listener(event)).catch(() => {})`。

## 3. Agent 回合与模型调用

**dsh 的回合模型是显式的，并且全程落日志：**

```
turn/start
  claim next-step input plus one queued message
  assemble prompt sections + tool schemas
  -> agent/pre-step            reject | enter(messages, startsRequestSeries?)
     step/start
     agent/request -> prepareCall
     reconcile system/message using the prepared call capability
     append entered messages as user/message
     log request/header and request/context as needed
     derive and freeze model history from the log
     stream the bound prepared call -> llm/stream
     assistant/message | assistant/attempt
     tool/call* -> tools/pre-execute -> execute -> post-execute -> tool/result*
     step/end
  -> agent/turn-stopping
turn/end
```

要点：

- `turn/*`、`step/*`、`system/message`、`user/message`、`assistant/message`、
  `assistant/attempt`、`tool/*`、`request/header`、`request/context` 都是**持久事件**。
- `agent/assistant-stream` 是进程内的 start / chunk* / end 帧，**不落日志**；结算后
  才把完整压缩流作为一条 `assistant/message` 提交。失败的尝试走 `assistant/attempt`，
  只进日志不进模型历史。
- system prompt 作为 history 节点存在，空渲染会清掉旧 prompt，能力不足的路由把
  prompt 合并到第一个 system 节点。
- `TurnEndReasonMap` 是 merge-extensible 的：`completed | aborted | blocked | error |
  max-tokens | interrupted | forked`。`interrupted` 只由崩溃修复合成，`forked` 只由
  `buildForkSeed` 合成。
- 有一条运行时断言（`packages/core/agent-loop/src/invariant.ts`）挂在 `llm/stream`
  上：loop 构造的请求必须 frozen、带 sessionId、messages 数组 frozen；日志里必须
  已有 `step/start` 与 `request/header`；并且
  `JSON.stringify(options.messages) === JSON.stringify(session.deriveMessages())`，
  否则以 `log-reconstruction desync` 失败。

**RKH 是一个 `for` 循环。** `Agent.run()` 从 1 数到 `maxTurns`（默认 8），每轮调一次
模型，把 assistant 消息和工具结果 push 进 `messages` 数组，收到零工具调用就返回。
超过上限抛 `AgentTurnLimitError`。日志里没有 turn/step 边界、没有请求快照、没有
system prompt 节点——`packages/session/README.md` 自己承认了这三点。

模型客户端签名差异是结构性的：

```ts
// RKH：一次返回
type ModelClient = (request: ModelRequest) => Promise<ModelTurn>;

// dsh：适配器 seam 上跑流
ctx.llm stream -> llm/stream waterfall -> agent/assistant-stream start/chunk/end
```

RKH 的 `packages/providers/src/ai-sdk.ts` 只调 `generateText`，全包没有 `streamText`。
Web UI 的 SSE 是真的，但流的是**已经完整的**回合（`assistant` 事件带完整 content 与
toolCalls），不是 token 增量。

事件面也不同：RKH 的 `AgentEvent` 只有 `model | tool_call | tool | tool_error` 四种，
走 `onEvent` 回调；dsh 把事件分三个域——durable session events、`agent/*` 活事件、
capability events（`fs/*`、`tools/*`、`telemetry/*`）。

## 4. 工具执行管线

**dsh：11 个固定阶段。**

| # | 阶段 | 能做 |
| --- | --- | --- |
| 0 | `createExecution` | 参数 `snapshotJsonValue` 物化 + `deepFreeze`，分配 opaque token |
| 1 | `tools/pre-execute` waterfall | `allow` / `deny` / `cancel` / `ask`；**不能重写参数** |
| 2 | approval | 仅 `allowed-once` 继续 |
| 3 | 单调 guards | `(exec) => string \| undefined`，**没有 allow 返回值** |
| 4 | `tools/execute` waterfall | wrapper 只能替换 `exec.signal`，body 前重新 fuse |
| 5 | tool body | `execute(args, exec)`，`deferContext()`、`concludeTurn()` |
| 6 | `normalizeDispatchResult` | output schema 校验、冻结、`render`、`presentationMeta` |
| 7 | `projectContent` | post-execute 之前安装 prepared content |
| 8 | `tools/post-execute` waterfall | `accept{content}` / `accept{value}` / `block{feedback}` |
| 9 | `finalizeContent` | 同步、exactly once、content-only，必须 total |
| 10 | `materializeFinalResult` | 冻结后 emit `tools/result`（只读观察） |

注册与作用域也是分层的：`@deepseek-ai/dsh-scope` 的 opaque `ScopeKey` 加祖先链继承，
近者 shadow 远者；`restrict({allow, deny})` 只能在 scoped context 上调；`view(scope)`
在施加限制后**豁免本 scope 自身的注册**（委派子 agent 的结构化输出工具必须保留）；
`schemas()` 只投影 name / description / parameters / deferLoading，绝不泄漏 output、
execute 或 timeoutMs。`run_code` 是无条件保留名。

并发分类是 fail-closed 的：只有 `isConcurrencySafe(args) === true`（严格 `true`）算
parallel，未声明、不可解析、抛错、返回非 true 一律 exclusive。`prepare`（pre-execute
+ guards）按 model order 逐个 await，只有 dispatch/body 重叠；`commitReady()` 只推进
连续槽位，所以 `tool/result` 和 `additionalContexts` 始终是 model order。

**RKH：5 步。**

```
parseInput → assessRisk → gate() → approval → execute
```

- `ToolDefinition` 要求 `parseInput` / `assessRisk` / `execute` / `inputSchema`，
  `defineTool` 在书写处校验，`registry.registerAll` 整批原子注册。
- registry 只暴露 metadata（`list` / `get` / `has` / `names` / `size`），executor 藏在
  `call` 后面，模型输出拿不到未注册的实现。
- `assessRisk` 由工具自己返回 `{kind, level, reason, target}`；路径解析在工具内部完成
  （见 `packages/tools/src/read.ts` 的 `assessRisk`）。
- 并发模型与 dsh 同构：`concurrency: "exclusive"` 的调用自成屏障，其余按
  `maxParallelTools`（默认 10）滚动成批，结果按调用顺序回填。

**工具数量**：dsh 的 model-facing 工具目录有 70 条（65 个唯一名，含别名），覆盖
bash/pwsh（一次性与持久 PTY 两套）、read/write/edit/read_image、glob/grep、
str_replace_editor、web_search/web_fetch、todo_write、skill、ask_user_question、
present、job_*、subagent 系列、session_query 系列、goal 系列、schedule 系列、
terminal 系列、lsp、workflow、ralph、run_code、plugin_manager、cordis_inspect_*、
mcp_resources 系列、stagehand_*。

RKH 的内置工具是一组固定的 + 两组动态的：

- **固定 11 个**：`read`、`write`、`edit`、`glob`、`grep`、`shell`、`webfetch`、
  `todowrite`、`todoread`、`ask`，加可选启用的 `task`。
- **作业控制 2 个**：`job`（status / cancel / background）与 `subscribe`（事件回放与
  长轮询），由 `JobManager.tools()` 提供。
- **动态 N 个**：每个已连接的 MCP server 的每个工具注册为 `<server>__<tool>`（两段
  都做字符消毒，总长截到 128），风险种类默认 `network`，名字冲突时跳过。

`shell` 的 schema 新增 `background`，`task` 新增 `mode: "full"`、`model`、`background`。
`full` 模式授予父级已配置的全部能力（仍排除 `task` / `job` / `subscribe`），并且模型
参数无法提权——dispatch 边界会重新查 `taskAccess`。

## 5. 审批与权限

**dsh 把两个独立的旋钮分开：沙箱模式（文件效果约束）与审批策略（要不要问人）。**

`ApprovalOutcome` 是闭集，且 fail-closed：

```ts
type ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'
```

只有 `allowed-once` 是授权。缺失、非拥有、抛错、返回不在词汇表里的值、没有答案者，
一律归一为 `unavailable`，调用方按拒绝处理。`ApprovalPolicy = 'ask' | 'never'`；
`never` 在 `decide()` 内部**先于 waterfall dispatch** 判定并直接返回 `rejected`，因此
后注册的 prepend 监听者无法绕过。有效值取会话日志里最后一个 `approval/policy` 事件。

`permission-presets` 把两个旋钮打包成命名预设，默认表只有两项：

| 预设 | sandbox | approval |
| --- | --- | --- |
| `workspace-write` | workspace-write | ask |
| `danger-full-access` | danger-full-access | never |

`custom` 与 `auto` 是保留名，配置它们会在加载期抛错。注意 `danger-full-access` 的
approval 是 `never` 而不是 `allow`——不约束文件效果，同时所有审批确定性拒绝。

**RKH 只有一个轴：审批。** 三档模式映射到一张按风险种类的权限矩阵：

| 模式 | workspaceFiles | workspaceWrites | externalFiles | network | riskyOperations |
| --- | --- | --- | --- | --- | --- |
| `approval`（默认） | allowed | risk-assessed | approval-required | approval-required | approval-required |
| `assist` | allowed | risk-assessed | risk-assessed | risk-assessed | risk-assessed |
| `full` | allowed | allowed | allowed | allowed | allowed |

`gate()` 把工具的 `assessRisk` 结果与模式比对，`ALWAYS_GATED` 集合
（`external_file`、`network`、`shell`）在 `approval` 模式下无条件要审批。`ApprovalHandler`
返回 `boolean`；缺处理器且需要审批时抛 `ApprovalHandlerUnavailableError`
（fail closed）。并发工具的审批通过 `approvalChain` 串行化，宿主一次只看到一个提示。

**关键差异**：RKH 的 `full` 模式意味着**完全不约束**——`packages/tools/src/shell.ts`
直接 `Bun.spawn(["/bin/sh", "-c", command])` 或 `cmd.exe /d /s /c`，没有任何进程或
文件系统隔离。dsh 的 `danger-full-access` 同样不约束，但它是一个**显式的、命名危险的
预设**，默认是 `workspace-write` + `ask`，且沙箱部署默认是 `read-only`。

## 6. 沙箱（最大差距）

**dsh 有真正的操作系统级沙箱 seam。**

```ts
ctx.sandbox.confine(argv, policy, signal?) => Promise<ConfinedArgv>
```

返回 `{argv, enforcement, denialSignatures, runnerFailureRules}`。没有可用 backend 时
reject `SandboxUnavailableError`，**禁止静默无约束透传**。

| 平台 | backend | 手段 |
| --- | --- | --- |
| Linux | `bwrap` | 只读 host root、新 `/dev`、private PID namespace；workspace-write 加 ephemeral `/tmp` 与 workspace bind |
| Linux | Landlock | `node-addon-system/landlock-run`，provider 只做 mode→grant 映射 |
| macOS | Seatbelt | `sandbox-exec` SBPL，allow-default + `(deny file-write*)` + `writableRoots` |
| Windows | ACL restricted token | `WRITE_RESTRICTED` token + workspace/temp capability SID + Low integrity + 拒 `FILE_DELETE_CHILD` |
| 远程 | `sandbox-ssh` | 远端 host 选它已装的本地 backend 应用同一 policy |
| 进程内 | `fs-sandbox` | 不是进程沙箱，是 fs 层的 mutation fence（`FS_SANDBOX_DENIED`） |

`SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access'`，只覆盖**文件效果**；
network、process visibility、syscall、device、credential 都不在词汇表里。enforcement 是
**被报告的事实**：`full` 表示 backend 管理了该模式承诺的每一项文件效果，`partial` 表示
只管理了子集（旧 Landlock ABI、Windows ACL 的 hard-link / 无约束读 / AppContainer
边界是当前 partial 案例）。调用方自行决定 partial 能否接受。

还有升级路径：`WIDER_MODES` 闭表（read-only→{workspace-write, danger-full-access}；
workspace-write→{danger-full-access}）、`validateEscalationArgs`、`approveEscalation`。
模型看到的拒绝文本是 `[sandbox: file access denied under <mode> mode]` 加升级提示。
`denialSignatures` 是 per-backend 方言：bwrap 是 EROFS 文本，Landlock 是 EACCES，
Seatbelt 是 EPERM。

**RKH 没有沙箱。** 全仓库对 `sandbox` / `bwrap` / `landlock` / `seatbelt` / `jail` 的
搜索零命中。唯一的执行边界是审批门，而审批是「问人」，不是「约束」。

这个差距的性质需要说清楚：它不是「少了一个功能」。审批门保护的是**用户知情**，沙箱
保护的是**即使批准了也越不过边界**。RKH 现在的模型是——用户点「同意」之后，shell
命令拥有用户账户的全部权限（`packages/tools/src/shell.ts` 仍是
`Bun.spawn(["/bin/sh", "-c", command])` 或 `cmd.exe /d /s /c`，无隔离）。

RKH 自己知道这个边界在哪，`docs/TASK-TOOL.md` 的验证一节写了：

> This is capability isolation, not an OS sandbox. Descriptor-relative filesystem
> operations are unavailable in the current implementation, so hostile local
> filesystem replacement races remain outside its sandbox guarantees.

**写入路径的符号链接问题已经修补，读取路径还没有。** 这是值得记下来的一个精确差异：

- `write` 与 `edit` 改走 `resolveWriteTarget()`（`packages/tools/src/workspace.ts`）：
  对 workspace root 与目标**同时** `realpath`，新文件取最近的存在父目录（带 256 层
  深度上限），再算相对路径判是否在界内。`resolve()` 另加了 NUL 字节与 32768 字符长度
  校验。这正好对应 dsh 要求的「canonicalize the existing target or the nearest existing
  parent for a new target」。
- `read`、`glob`、`grep` 仍用词法 `workspace.resolve()`。因此 workspace 内一个指向外部
  的 symlink 会被判为 `insideWorkspace`，分类成 `workspace_file`，在默认 `approval`
  模式下**无需审批即可读取**。`read` 的风险评估只做前缀判定，没有 canonicalize。

**审批与执行之间的 TOCTOU 也补上了。** `ToolExecutionContext` 新增 `approvedTarget`：
gate 决策用的 `risk.target` 被捕获下来，dispatch 时与工具重新算出的 canonical 目标比对。
`write` 与 `edit` 在 `packages/tools/src/{write,edit}.ts` 里各有一处：

```ts
if (context?.approvedTarget && context.approvedTarget !== target.absolute)
  throw new Error("Write target changed after approval; retry the call.");
```

这正是「审批时看到的」与「执行时作用的」必须是同一个对象这条要求。注意 `shell` 与
`webfetch` 没有对应检查，但它们的 `risk.target` 是命令串与 URL 而非路径，语义不同。

要补读取路径的话，最小改动是把 `read` 的 `assessRisk` 也走 canonical 解析（glob / grep
同理），代价是每个调用多一次 `realpath`。这件事与是否引入 OS 沙箱无关，可以独立先做。

## 7. 会话与持久化

**两边都是 event-sourced、append-only JSONL、日志是真源。这是 RKH 对齐得最彻底的一层。**

| | dsh | RKH |
| --- | --- | --- |
| 当前格式版本 | **4** | **1** |
| 迁移 | 4 个相邻包：`v0→v1`、`v1→v2`、`v2→v3`、`v3→v4` | 无 |
| 压缩 | 默认 zstd，每个 append batch 一个独立 checksummed frame | 无（纯文本 JSONL） |
| 文件命名 | v0 `session.jsonl[.zstd]`，v1+ `session.vN.jsonl[.zstd]` | `session.jsonl` |
| 代际规则 | 已提交代际**永不** rename / replace / delete，只新增 successor；不支持 downgrade | 单文件，无代际概念 |
| 未知事件 | `ignorable?: true` 才能跳过，否则 fail closed 拒绝重建整个 session | 同样有 `ignorable`，同样 fail closed |
| 校验 | `packages/core/session/src/invariant.ts` 强制 seq 严格递增、turn 从 1 连续、step 每 turn 连续、tool/result 必须有先前的 tool/call 等一批关系 | 非连续 seq 抛错；无关系校验 |
| 事件表 | merge-extensible `SessionEventMap`，插件用 declaration merging 扩展 | 固定字符串常量表 |
| 投影 | `ctx.sessionProjections` registry，zod stateSchema + 纯同步 apply + stateVersion + 持久化缓存 | 无；`tool-log` / `trajectory` / `task-log` 是各自独立的读侧函数 |
| 查询 | `ctx.sessionQuery` + 独立 FTS5 SQLite 索引（schema version 8），17 项封闭错误码 | `store.list()` 加 REST 分页 |
| 导出 | 流式 ZIP（`/api/session.export`），含附件与文件 | 无 |
| 锁 | — | 独占创建锁文件 + pid，死进程的陈旧锁可回收（`packages/session/src/lock.ts`） |

dsh 的 surface 事件还区分 `surfaceOp: 'append' | {op:'replace', startSeq, endSeq}`，
只有 system/developer/user/assistant/tool 这类会进模型上下文的类型能带它；非 surface
事件在**编译期**就禁止这两个字段。`assistant/message` 额外禁止 `sourceEventSeqs`，
因为它内嵌的 stream 本身就是证据。

RKH 的事件集：`user/message`、`assistant/message`、`tool/call`、`tool/result`、
`session/model`、`model/call`、`session/title`、`session/thinking`、`session/archived`、
`session/compaction`，本轮新增 `task/*`（started / event / completed / failed /
cancelled）、`job/sub/*`、`job/shell/*`、`session/todo`、`session/notification`。

事件数量在增长，但**事件表仍是固定字符串常量**，不是 dsh 那种 merge-extensible 的
`SessionEventMap`。差别在扩展方式：dsh 的插件用 declaration merging 加事件类型且类型
系统知道新成员；RKH 加事件要改 `transcript.ts` 的常量表与对应的读侧投影函数。

**RKH 已经做对的部分**：工具调用先落盘再执行（`tool/call` 是写屏障，handler 失败则
不进入工具体）、恢复时对没有结果的调用补一条 failed `tool/result` 且**明确不重跑**、
torn tail 容忍、更新版本 fail closed、跨进程单写者锁。这些是做过几轮才会定下来的约束。

读侧投影的取向也一致：`trajectory` / `task-log` / `jobs` / `todos` 都只投影已记录的事实，
缺的时间戳不推测，未完成的记 `unknown`，不假装 `running`。

**RKH 缺的部分**：turn/step 边界、请求快照、流式 attempt、格式迁移链、投影 seam、
关系不变量。`packages/session/README.md` 自己列了前三项。本轮新增了四种事件类型而
格式版本没动，这让「趁早立迁移规则」这件事更紧了。

## 8. 压缩、附件、输出溢出

dsh 拆成 4 个包：

- `compaction`：Service Definition。`compactIfNeeded(agent, 'pressure'|'context-overflow')`
  / `compactNow` / `compactRegion`；三个 log-only 事件 `compaction/start`、
  `compaction/summary`、`compaction/end`，start 先 end 后构成 log-recorded lock。
- `compaction-basic`：默认 provider。阈值 `floor(min(W×0.8, W−O−65536))`，保留最近
  `W−O` 的 16%，支持 per-model `modelPolicies`。
- `compaction-tool-result-pruner`：无模型调用，默认把超过 8192 code point 的工具结果
  裁成 head 4096 + marker + tail 1024，紧邻前置 `compaction/prune` shadow-price 事件。
- `compaction-image-offload`：把超预算图片永久替换为文本加只读路径，注册 message
  projection。重试不消耗 provider retry budget。

外加两个独立 seam：

- **attachment**：content-addressed 存储（`<DSH_HOME>/attachments/v1`），`saveImage`
  先完整解码验证再原子发布；限额每消息 ≤20 张 / 单张 ≤20 MiB / 64,000,000 px / 边长
  ≤8192，规范化长边 2048 px；`admitPromptContent` 在任何 message 创建前把 base64
  换成 durable ref，session 事件只带 ref。
- **spill**：`ctx.spillStore.saveText()` 返回 `SpillRef`。本地实现写
  `<root>/session-<sha256(sessionId)>/<random>-<safeName>`，root 0700，
  **独占 `open(path, 'wx', 0o600)`** 防止被预置 symlink 重定向。spill-policy 对超限的
  工具结果用有序 head/tail 加地址替换，best-effort——保存失败保留原 inline 结果，
  不把成功调用变成 isError。

**RKH 只有压缩，且是一段内联逻辑**（`packages/sdk/src/index.ts` 的 `compact()`）：
超过 `budget × 0.8` 时用小模型摘要中间段，保留最近 6 条，`budget` =
`contextWindow − reserveOutputTokens − margin`。分数是直接用启发式估算
（`packages/harness/src/tokens.ts`）或上一次 provider usage。压缩结果作为
`session/compaction` 事件记录，replay 时从摘要重启。

没有附件存储、没有输出溢出，也没有图片处理。Web UI 的 `/api/upload` 存在，但上传的
文件路径是**作为文本拼进 prompt** 的（server.ts 把 attachments 拼成
`Attached files (read them if relevant): <paths>`），不是结构化附件。

## 9. 扩展能力

| 能力 | dsh | RKH |
| --- | --- | --- |
| MCP | `mcp-client`（stdio 或 Streamable HTTP，官方 SDK，工具名 `mcp__<server>__<tool>`）+ `mcp-resources`（默认挂在所有发货 profile）；server instructions 作为 scoped、server-attributed 的 literal 文本进被记录的 system prompt | **已实现客户端**：`packages/mcp` 覆盖 stdio、旧版 HTTP+SSE、Streamable HTTP 三种 transport，`initialize` / `tools/list` 游标分页 / `tools/call`，30 秒请求超时，单 server 失败不阻断其余。工具经 `mcpToolDefinitions()` 注册为 harness 工具，风险种类默认 `network`。协议版本 `2025-06-18`。**并且有 OAuth**：`oauth.ts` 走 RFC 9728 protected-resource 元数据 → RFC 8414 授权服务器元数据 → RFC 7591 动态客户端注册 → authorization code + PKCE，token 落 `tool.auth.json` 并在连接前自动刷新 |
| Skills | `ctx.skills` 分层注册表，6 级本地根（projectRoot/.dsh/skills 100 → agents/skills 200 → customSkillDirs 300 → dshHome/skills 400 → agentsHome/skills 500 → bundled 600），`skill` 工具把正文经 `agent.inject()` 注入并追加完整替换目录 | `discoverSkills()` 扫描 `~/.ringko/skills`、`~/.agents/skills`（及 `skill` 别名），解析 frontmatter，支持 create/remove。**正文仍不注入模型**，agent 回合看不到 skill。但新增了 ambient 指令文件加载：`loadInstructions()` 按 opencode 的规则取一个全局文件（`~/.ringko/AGENTS.md` 优先，其次 `~/.agents/AGENTS.md`）+ 从 cwd 向上到项目根的工程文件，且**首个有命中的文件类型即停止**（`AGENTS.md` 与 `CLAUDE.md` 不叠加祖先） |
| 子代理 | 7 个 provider 变体（`spawn-in-process`、`fork-in-process`、`acp`、`codex`、`claude-code`、`dsh-sdk` + `in-process-driver`），默认挂 spawn + fork；两态（一次性 `SubagentRun` 与 continuable `AgentHandle`）；`SubagentCapabilities` = `agentOptions|outputSchema|depthLimit|toolFilter|persona`，缺失即 `UNSUPPORTED_CAPABILITY` 硬失败；控制工具 `send_message` / `interrupt_agent` / `list_agents` | `task` 工具：**read / write / full** 三模式。能力白名单按 `taskAccess`（`"read" \| "write"`）过滤，dispatch 边界重新校验，`task` / `job` / `subscribe` 一律排除，所以无递归。可选 `model` 必须命中宿主 `configuredModelIds()`，模型参数无法提供 endpoint 或凭据。`background: true` 走作业系统。限额 `maxConcurrent 2`、`maxPerRun 8`、`maxTurns 10`、`timeoutMs 120_000`。校验与预留同步完成，避免并发绕过预算 |
| 后台作业 | `ctx.jobs` + `job_list` / `job_output` / `job_kill`，bash、PTY send、子代理统一接入同一个注册表 | `JobManager`（`packages/harness/src/jobs.ts`，132 行）：session 本地，`active 4` / `perRun 32` / 每 job 200 事件 / 单事件 8192 字符 / 结果 163840 字符 / 单次等待 30 秒。有序列游标、`missed` 截断标记、`foreground()` 等待、`detach()` 前台转后台、`cancelAll()`、`settle()`。shell 与 task 都支持 `background: true`。**父级继续**：父级出最终答复后 SDK 等待后台完成，用记录的 `session/notification` 消息恢复父模型，每次完成只投递一次 |
| Workflow | `ctx.workflowEngine` + `workflow-ptc`（在调用 session 的 file policy 下跑 Node PTC 进程），hook 有 `agent()`/`pipeline()`/`parallel()`/`phase()`/`log()`；另有 `ralph`。这是**执行编排**：模型写 JS 脚本驱动多个子代理 | 有一层轻量 **workflow（模式）**，已独立成 `packages/workflow`：内置 `agent` / `plan` / `ask` / `debug`，每个可带 `instructions`、工具 `allow`/`deny`、模型覆盖，用户可在 `~/.ringko/workflows.json` 增删，Web 有 `mode-picker`。这是**行为塑形**，不是执行编排。包侧已提供 `routeWorkflow()` → `WorkflowRoute{id, instructions, model?, tools?}` 与 `workflowAllowsTool()`；宿主 `app/src/server.ts` 已改从该包导入，但**只消费 `instructions`**，工具 allow/deny 仍未施加。`ToolRegistry` 目前也只有 `register`，没有子集 API，所以宿主还差一个受限视图 |
| 运行时自修改 | `ctx.dynamicCordisRunner`：agent 定义版本化 Cordis 包并跑 host 与 browser 两半；配套 `cordisInspect`、`inspector`、`tool-cordis` | 无 |
| Hooks | `hook-protocol` + 两个**配置格式兼容桥**：`hooks-claude-code`、`hooks-codex`。桥读的是对方产品的 hook 配置文件，把这些 command hook 挂到 **dsh 自己的**拦截点上（session 开始、prompt 到达、tool 前后、turn 停止），可阻断并给模型可见理由、附加上下文或强制继续。hook 命令经 `ctx.shell` 执行。**方向是配置 → dsh，不涉及对方的运行时**；`hooks-codex` 只支持 Codex 五事件子集。**默认不发货** | 无（但有 `loadInstructions()` 的 ambient 指令注入，性质更接近 dsh 的 `agent-instructions`） |
| 插件管理 | `plugin_manager` 工具 + `dsh plugin` 命令，profile 内安装 / 启用 / 禁用 / 版本豁免 | 无 |
| 资源作用域 | 用户级与项目级并存：项目根 `.dsh/` 与 `.agents/`，profile 与 home patch 分层 | **用户级**（`~/.ringko/`、`~/.agents/`）加**项目级**：`findProjectRoot()` 以 `.git` / `.mcp.json` / `ringko.json` / `.agents` 为标记向上查找，项目内 `.mcp.json` 与 skills 以 `scope: "project"` 参与合并。指令文件同样是全局 + 工程两级 |
| 其他 | terminal（持久 PTY）、lsp、schedule、goal、plan、webhook、agent teams、browser-use、computer-use、PTC runtime、session-query 5 个只读工具 | todo（含 `todoread` 与会话持久化）、ask（最多 4 问 / 8 选项 / 多选 / 自定义作答 / FIFO 队列） |

MCP 这条落差已经补上，而且补得比预期深（含完整 OAuth）。**Skills 是剩下唯一形状相同的
缺口**：配置层与 UI 都在，缺的只是把正文注入模型回合。

**workflow 的工具 allow/deny 是个半成品。** `WorkflowTools` 的 `allow` / `deny` 有完整的
解析与合并逻辑（`workflowAllowsTool()`，deny 优先、空 allow 表示全放行），但全仓库零调用
点，且 `ToolRegistry` 没有子集 API。也就是说用户在 `workflows.json` 里写
`tools: { deny: ["shell"] }` 不会生效——只有 `instructions` 会进 system prompt。这属于
「定义了但没有执行点」，按仓库自己的规范应该由执行器而不是提示词来强制。

## 9b. 作业、后台与父级继续

这是本轮新增能力里结构最重的一块，单独说明因为它触及 agent loop 的边界。

RKH 的 `JobManager` 是 session 本地的（`docs/TASK-TOOL.md` 明确写「This is an
in-process session workflow, not a daemon that survives process shutdown」），与 dsh
的 `ctx.jobs` 定位一致。两者的差异在控制面：

| | dsh | RKH |
| --- | --- | --- |
| 工具面 | `job_list` / `job_output` / `job_kill` 三个 | `job`（status / cancel / background 合一）+ `subscribe`（带 `after` 游标与 `waitMs` 长轮询）两个 |
| 事件回放 | 有（job 输出可读） | 显式有界回放：每 job 200 事件，超出丢弃并给 `missed` 标记 |
| 前台转后台 | 无对应概念 | `detach()` 把运行中的前台 job 转后台（Web task 卡片 / TUI Ctrl+B） |
| 父级继续 | 后台完成经 `agent.inject()` 投递完成通知 | 父级出最终答复后等待后台完成，以 `session/notification` 消息恢复父模型，**每次完成只投递一次**，上限 32 次继续 |

RKH 把「前台 job 转后台」做成了一等操作，这是 dsh 没有的，对交互体验有实际价值。
反向的差距是进程外持久性：两边都不做 daemon，但 dsh 的作业在 Host 进程内跨 session
共享一个注册表，RKH 的 job 生命周期绑在单次 SDK run 上（`resetRun()` 清空，运行中的
job 会阻止 reset）。

## 10. 界面与入口

**dsh 的人类界面只有两个：Web GUI 与 headless 一次性输出。**

- 5 个 profile 都是同一条 `dsh` launcher 的不同组装：`web`（默认 127.0.0.1:3080，
  明确拒绝 `--host 0.0.0.0`）、`headless`（驱动到 quiescence，final text 到 stdout，
  `--json` 改事件流）、`sdk`（stdio JSON-RPC）、`sdk-minimal`（不叠 `dsh-base` 的独立树）、
  `acp`（automation-only）。
- Electron Desktop 独占 `$DSH_HOME/profiles/desktop`，默认端口 19387，渲染进程不拿
  文件系统访问、原始 IPC 或 shell。
- Python SDK 与 TypeScript SDK 都是启动 `dsh --profile sdk` 的进程外客户端。
- **没有 TUI。** 全仓对 `ink` / `blessed` / `terminal-kit` 等零命中；对 `tui` 的 53 处
  命中全是测试夹具、帮助文本示例与 JSDoc。反向证据是
  `apps/cli/tests/built-bin.e2e.ts` 断言 help 输出**不得**匹配 `tui|meta|upgrade`。

> 注意别把 `packages/terminal/` 当成人机界面：那是给模型用的持久 PTY 能力
> （`terminal_open/send/read/signal/close`），不是人类 REPL。

**RKH 是一个二进制两个界面。**

- `packages/tui` 的 bin 是 `ringko`，Bun 编译成单文件，`build:all` 覆盖 5 个交叉目标
  （linux x64/arm64、darwin x64/arm64、windows x64），`build` 编译当前平台。
- CLI 子命令：`config`（show/path/get/set/unset）、`auth`（login/logout/status/list）、
  `session`、`skills`、`mcp`、`models`、`tools`、`info`、`tui`、`run`。
- `packages/repl` 是 Ink + React 的交互式 TUI，交互层本轮大幅重构：拆出 `editor.ts`、
  `keybindings.ts`、`launch.tsx`、`selection.ts`、`transcript-layout.ts`，删掉
  `MessageRow.tsx`，新增 `AskDialog.tsx`。已实现 Pi 风格快捷键（Ctrl+L 模型选择、
  Ctrl+P/Alt+P 切换、Shift+Tab 推理深度、Ctrl+O 工具输出、Ctrl+T thinking、Ctrl+X 复制、
  Ctrl+R 会话选择、PgUp/PgDn 翻页、Ctrl+B 前台转后台）、分组可搜索的模型列表、多行编辑、
  括号粘贴、CJK 宽度的 transcript 分页。`docs/TUI-COMPARISON.md` 记录了参考来源与剩余缺口。
- `packages/app` 是 Web 的宿主（Bun 服务，REST + SSE），`packages/webui` 是
  React + Radix/shadcn 的前端。页面本轮重组：`SettingsPage` 被删除，改为
  `settings-dialog.tsx` + `settings-panel.tsx`；新增 `OAuthPage.tsx`（配
  `lib/oauth.ts`）、`task-panel.tsx`、`job-panel.tsx`、`question-panel.tsx`、
  `trajectory-view.tsx`。当前页面是 Chat / Connectors / Login / OAuth / Projects /
  Providers / Skills。
- `packages/code` 是 VS Code 扩展，**15 行，`createRingKo` 的模型是返回固定文本的
  echo client**，只有一条 `ringko.status` 命令。这是占位，不是产品面。

**这一层 RKH 领先，而且是产品层面的领先。** dsh 需要另装客户端才有终端交互；RKH
开箱就有 TUI 与 Web 两套界面。

## 11. 模型接入与凭据

**dsh 的 `packages/llm/` 有 9 个包**，`ctx.llm` 是 provider-neutral seam：`llm`（词汇与
adapter seam）、`llm-deepseek`（共享 Messages 协议）、`llm-deepseek-api-key`（API key
认证与发现）、`llm-deepseek-account`（账号 token 认证）、`llm-pi-ai`（经 pi-ai catalog
与 wire protocol 的路由，可用于 OpenAI 兼容 gateway 或自托管）、
`deepseek-llm-api-extensions`、`plugin-package-inventory-deepseek`、`llm-retry`
（在 durable agent-step 边界按 provider 策略重试）、`token-meter`。

`llm-pi-ai` 支持的协议只有三种：`openai-completions`、`openai-responses`、
`anthropic-messages`。凭据存 `$DSH_HOME/.credentials.yaml`，**write-only**——页面只收到
脱敏 descriptor，settings 只保留 credential reference。

**ChatGPT / Codex OAuth 在 dsh 里不是 first-class。** 证据：

- `docs/user/guide/providers.md` 明写 "Providers that sign in with OAuth, such as
  Codex, are not supported here yet."
- `packages/llm/llm-pi-ai/src/discovery.ts` 注释确认 Codex 走 OAuth 故不在可列举协议内。
- `llm-pi-ai` README 只承诺「当已安装的 pi-ai provider 自带该流程时，可通过
  authorization seam 的 OAuth grant 登录」——dsh 自己**不实现** ChatGPT OAuth 客户端。
- Desktop 的浏览器登录走的是 DeepSeek Platform 账号（`deepseek-account-platform`），
  与 ChatGPT 无关。

（`@openai/codex` 与 `@anthropic-ai/claude-agent-sdk` 确实出现在依赖里，但用途是
subagent provider 的运行体，不是模型 provider。`subagent-codex` 会 `createRequire`
解析 `@openai/codex` 的 `bin.codex`，每次委派 spawn 一个全新的 Codex app-server 进程、
建一个 ephemeral thread、跑恰好一个 turn，native 配置与认证保持权威，默认
`permissionMode: never` 无人值守。方向的澄清见第 9 节：dsh 不 hook Codex，它把 Codex
当子代理驱动，或者只复用 Codex 的 hook 配置格式。）

**RKH 的 provider 走 AI SDK**（`ai@^7`，以及 `@ai-sdk/openai`、`@ai-sdk/anthropic`、
`@ai-sdk/google`、`@ai-sdk/openai-compatible`），支持 **8 种**：`openai`、`openai-oauth`、
`github-copilot`、`xai-oauth`、`anthropic`、`anthropic-oauth`、`google`、
`openai-compatible`。

另外有一张 **57 条 provider 预设表**（`packages/config/src/presets.ts`）作为数据而非代码
存在：第一方与 OAuth 四家、主流 OpenAI 兼容网关（Groq / Mistral / OpenRouter / Together /
Fireworks / Cerebras / Perplexity / DeepSeek / Moonshot / Z.ai / DashScope / Volcengine 等），
以及本地推理端点（LM Studio `127.0.0.1:1234`、Ollama `11434`、vLLM `8000`、
llama.cpp `8080`、Jan `1337`）。`OAUTH_DOMAIN_BY_TYPE` 把三个 OAuth 类型映射到凭证域，
Web 通过 `GET /api/presets` 读取。

**Anthropic Claude Pro/Max OAuth** 是本轮新增的第四个 OAuth：`packages/auth/src/anthropic.ts`
走 PKCE 回环（端口 **53692**，`http://localhost:53692/callback`），client id
`9d1c250a-e61b-44d9-88ed-5944d1962f5e`，scope 含 `user:inference`、`user:sessions:claude_code`、
`user:mcp_servers`、`user:file_upload`。请求侧
（`packages/providers/src/anthropic/index.ts`）删掉 `x-api-key`、改注入
`Authorization: Bearer`，并把 User-Agent 设成 `claude-cli/<version>`、合并
`anthropic-beta` 头（默认加 `claude-code-20250219` 与 `oauth-2025-04-20`）——与 Codex、xAI
是同一个做法：复用官方 CLI 的客户端身份。

**还多了配额查询**：`packages/auth/src/openai.ts` 的 `queryCodexQuota()` 打
`https://chatgpt.com/backend-api/wham/usage`，`xai.ts` 的 `queryXaiQuota()` 同构，两者都
返回 `{ tiers: QuotaTier[] }`，Web 通过 `GET /api/auth/quota` 读取（对非
`openai-oauth` / `xai-oauth` 域直接 400）。这是把订阅用量暴露给用户，dsh 没有对应功能。

**凭证现在是三个文件，各自分管一类**：

| 文件 | 管什么 |
| --- | --- |
| `~/.ringko/auth/auth.json` | provider 登录态（`oauth` 轮换 token / 预设 `apikey`） |
| `~/.ringko/provider.json` | 用户自定义 provider 定义（含可选的端点 `apiKey`） |
| `~/.ringko/tool.auth.json` | 工具 / 连接器凭证，按 MCP server 名索引，支持 `oauth`（带 tokenEndpoint / clientId / clientSecret / scopes / resource）、`apikey`、`headers` |

**而 OAuth 是 RKH 自己实现的一等能力**（`packages/auth`，902 行，从 454 行经两轮增长）：

- **OpenAI / ChatGPT**：`packages/auth/src/openai.ts` 固定 localhost:1455 回环 + PKCE
  （S256），scope 与 client id 对齐 Codex CLI，另有 device-code 流程；
  `packages/auth/src/codex.ts` 提供 Codex backend 的 token 注入 fetch 与 client
  identity 头。`extractAccountId` 从 id/access token 的 `chatgpt_account_id` 或
  `https://api.openai.com/auth` claim 里取账号。
- **Anthropic**：`anthropic.ts`，端口 53692，`claude-cli` 身份 + oauth beta 头。
- **xAI / Grok**：`xai.ts`，`x-xai-token-auth: xai-grok-cli` 头。
- **GitHub Copilot**：device flow。
- 共享的 `callback-page.ts` 渲染 OAuth 回环页。

三个 OAuth fetch 用的是同一套模式：`pending ??=` 去重并发刷新、过期前 60 秒预刷新、
`updateOAuthCredential()` 写回。差异只在注入的头。

**结论**：这一层 RKH 明显更强。dsh 的 provider seam 更抽象、更多包，但 ChatGPT 登录
它没有实现；RKH 有四个 OAuth 实现、一张 57 条的预设表，还有订阅配额查询，而且这些都
是用户日常会碰到的路径。

**两条路的取舍值得记下来。** Codex 是开源项目（`openai/codex`，Rust 实现 codex-rs），
所以 RKH 从 `codex-rs/login/src/auth/default_client.rs` 读客户端常量、对齐官方
client id 与 scope，属于配置兼容，不是逆向。真正不开源的是服务端
（`chatgpt.com/backend-api/codex`）——这是服务契约与订阅条款问题，不是保密问题。

dsh 绕开了整件事：`subagent-codex` 把 `@openai/codex` 钉在 `0.153.4` 当 peer dependency
（darwin-arm64 payload 约 114 MB），spawn 真的 Codex app-server，README 明写
"Native Codex configuration and authentication remain authoritative"——登录与 token
刷新是 Codex 自己的事。RKH 则自己实现客户端身份与 OAuth，因此 auth 是 RKH 的维护
责任：`RINGKO_CODEX_VERSION` 覆盖版本的存在，说明身份必须跟上游走。dsh 把同样的
漂移当工程任务处理（"upgrading requires regenerating the upstream schema evidence
and rerunning the credentialed nonce tests"）。

一句话：dsh 用体积依赖换掉 auth 维护与条款暴露，RKH 用自实现 auth 换掉体积依赖、
自己承担上游变更。不是对错，是资产归属。

## 12. i18n

| | dsh | RKH |
| --- | --- | --- |
| 发货语言 | `zh`、`en` | `en`、`zh-CN` |
| 机制 | `ctx.locale` 字典注册表，按 namespace 注册，查找走 fallback 链，`addLanguage({id, label, fallback})` 可扩展并带**自述名称** | 类型化 message 对象（`i18n/en.ts`、`i18n/zh-CN.ts`）+ `messages.ts` 契约 + `language-toggle` 组件 |
| 强制 | `verify-client-ui-i18n` 拒绝组件内硬编码产品文案；每个产品可见字符串必须走类型化字典 | 无门禁 |

RKH 的 CLAUDE.md 规范要求 zh-CN / zh-TW / EN 三种，且要求 i18n 描述文件展示语言自述
名称以便切换栏显示。**当前只有 en 与 zh-CN**，zh-TW 未做。dsh 的 `addLanguage` 加自述
元数据正好是那个形态，可以参考它的做法而不是照搬代码。

## 13. 工程化

**dsh 把正确性做成了门禁链。**

- **覆盖率**：`test:coverage` 才是 CI 门禁，`perFile: true` 且 statements / branches /
  functions / lines 全 **100%**，作用域 `packages/*/*/src/**`。
- **快照回放**：顶层 `snapshots/` 有 205 个 `snapshot.yml`（294 个目录），一篇 fixture
  既是 replay 输入又是期望落盘输出。`test-support/llm-replay` 在没有 provider 时挂
  `llm/stream` waterfall 回放录制的响应，未录制的调用 **fail loud**，`assertConsumed()`
  在 teardown 断言脚本被全部消费。归一化后断言 stdout、重新落盘的会话日志**逐事件**
  等于 fixture、system prompt 与 tool schema 侧车、以及 `workspace.expected/` 完整目录树。
  macOS / Linux 上无 key 即可跑。
- **e2e**：真实 API，无 key 自跳过，nightly 触发。
- **生成物新鲜度**：tool-catalog、config-catalog、cordis-catalog、client-catalog、
  dependency-catalog、persistence-catalog、session-format-catalog、module-graph 等
  一批 `gen-X --check`，改源不改生成物即失败。
- **静态验证**：约 100 个 `scripts/verify-*.ts`，包括 package invariants、
  runtime-closure、application-entrypoints、default-product-isolation、
  no-unknown-casts（对照 baseline 只许持平或下降）、export-jsdoc、client-route-resolution。
- **CI**：17 个 gate aggregate；`ci-primary` 串联共享静态门 + typecheck + lint +
  duplication + coverage + snapshot + doc-sync + build + publint + built-package-invariants；
  Node 兼容矩阵 22.19 / 24.9 / 26；Windows 分 blocking 与 observational；
  `all-checks-passed` 是唯一 required verdict。
- **文档**：分层（root/subtree AGENTS.md、architecture、subsystems、Agent Notes、
  postmortem、cookbook、生成参考），中英配对由 `foo.i18n.yaml` 分段哈希校验，
  字数预算由 manifest 强制，`verify-md-wrap` 强制一段一物理行，fenced `ts` 块必须可编译。
- **仓库卫生**：oxlint typeaware，`no-floating-promises` 是最高价值 bug 类；
  lefthook pre-commit 跑配对校验、staged lint、vendor manifest、
  `git diff --cached --check`；pre-push 跑 typecheck。刻意不在 hook 里跑测试。
- **Agent Notes**：2412 篇，路径即状态与类别，格式与归档由三个门禁强制。

**RKH 现在是 `bun test` 加三个 workflow。**

- 47 个测试文件、3,499 行（首轮 36 / 2,251，含空行的新口径）。覆盖 config（paths /
  config / auth / mcp / skills / proxy）、harness（agent / tools / schedule / jobs）、
  session（format / store / lock / transcript / tool-log / compaction / trajectory /
  task-log / jobs）、tools（workspace / shell / webfetch / todo / ask / session-tools）、
  auth（openai / codex）、providers（ai-sdk / models / openai-oauth）、sdk（index /
  task / background）、mcp（stdio / http，带真实 echo server 夹具）、runtime（bus）、
  workflow、repl（commands / state / interactions / terminal）、tui、app（tool-log /
  background）。
- `ci.yml` 在矩阵上跑 `pnpm install --frozen-lockfile` → `pnpm test` →
  `pnpm typecheck` → `pnpm build:bin`。
- `release.yml` 用 bun 编译 5 个平台的二进制。
- `models-snapshot.yml` 定时刷新模型目录。
- **没有**：覆盖率门禁、快照回放、e2e、生成物新鲜度、包不变量、i18n 门禁、lint 门禁
  （只有 `packages/webui/.oxlintrc.json`，根目录没有）、发布到 registry 的流程。

测试比 **0.17 vs 1.30** 是这一节最直接的量化。

需要承认的是分母不同：dsh 把大量本可以是运行时逻辑的东西写成了测试与门禁（覆盖
分片、生成器、规格校验），而它的 `scripts/` 本身就有 6 万多行。RKH 的 20,144 行源码配
3,499 行测试，对一个还在快速成形的实现是正常的，但对一个准备发布的 agent 宿主不够。

**覆盖是不均匀的，而且方向在往好的那边走。** 值得点名的几处强测试：

- `packages/mcp/tests/http.test.ts` 起了真实的 `Bun.serve`，同时扮演 RFC 9728
  protected-resource、RFC 8414 授权服务器、RFC 7591 注册端点、authorize 端点（302 回跳）、
  token 端点与 streamable-HTTP MCP 端点，然后驱动**完整的 OAuth 握手**：发现 → 注册 →
  PKCE 回环 → 换 token，并断言取回的 credential 字段。这不是弱意义上的单元测试。
- `packages/auth/tests/openai.test.ts` 启动真实的 1455 回环服务，走拒绝路径断言浏览器页
  与拒绝语义，并断言回调页对 `<Provider & "team">` 做了转义（注入防护）。
- `packages/app/tests/background.test.ts` 通过真实 HTTP 装配驱动 ask 应答、todo 持久化、
  sub/shell 订阅、父级继续，以及取消先落盘再关会话——属于真实组合测试。
- 核心不变量有行为断言：工具体在 pre-execute 事件失败时**不进入**
  （`harness/tests/agent.test.ts`）、审批门 5 条、批处理不可序列化时**不推进 seq**
  （`session/tests/store.test.ts`）、task 拒绝越权的 write/shell/递归调用
  （`sdk/tests/task.test.ts`）、子任务审批取消后不落盘。
- REPL 的编辑器测试含字素簇、emoji、CJK 光标定位、粘贴上限与终端控制序列拒绝。

仍然没有测试的是 `config` 的 `presets.ts` / `tool-auth.ts`（约 217 行，纯数据与解析）与
`auth` 的 `anthropic.ts` / `queryCodexQuota` / `queryXaiQuota`（约 210 行，含网络、
PKCE 与 JWT claim 解析）。也就是说：**结构化逻辑与协议适配在写测试，纯数据表和较新的
OAuth 分支还没有**。

**唯一零覆盖的是模型可见文本。** 全仓没有任何测试断言 tool `description` 或组装后的
system prompt——`skills.test.ts` 断的是 frontmatter 解析，`ai-sdk.test.ts` 断的是指令
透传，`workflow.test.ts` / `bus.test.ts` 断的是指令拼接。也就是说改写一个工具描述、
调整 `task` 的那段长 instructions、或改动 workflow 的引导语，不会有任何测试失败。dsh
把这两样做成侧车（`tool-schemas.expected.json`、`system-prompt.expected.md`）逐字钉住。

## 14. 未提交增量的清单

当前 `main` 是 `eb2855a`。工作区有 72 个已跟踪文件被修改（+3,415 / −1,108）、48 个新
文件。新增能力已并入前面的能力对照，这里只留索引，说明每个改动的性质。

**a. MCP 客户端与 MCP OAuth（新包）**

- `packages/mcp`（5 个源文件、722 行）：`transport.ts`（stdio / 旧版 HTTP+SSE /
  Streamable HTTP）、`client.ts`（`McpClient`、`openMcpServer(s)`、
  `closeMcpConnections`）、`tools.ts`（`mcpToolDefinitions` / `registerMcpTools`）、
  `oauth.ts`（RFC 9728 / 8414 / 7591 + PKCE）。
- 单 server 失败不阻断其余，错误收集后返回；`tools/list` 走游标分页；`tools/call` 把
  content 数组拍平成文本，`isError` 转 throw。连接前会先 `ensureToolAuth()` 刷新 OAuth
  token。测试用 `tests/fixtures/echo-server.ts` 起真实 stdio 子进程。

**b. 作业系统与父级继续**

- `packages/harness/src/jobs.ts`：`JobManager`（132 行）。同步预留、有界事件回放、
  序列游标、`foreground()` / `detach()` / `cancelAll()` / `settle()`、
  `nextNotifications()`。每个 job 的 `completed` 事件持久化失败会把状态降级为
  `failed`，不让内存与日志分叉。`tools()` 提供 `job` 与 `subscribe`。
- `packages/session/src/jobs.ts`：`sessionJobs()` 从 `job/*` 事件折叠，历史未完成记
  `unknown`。
- `packages/tools/src/shell.ts`：schema 加 `background`，执行体改为经 `context.jobs`。
- `packages/app`、`packages/sdk` 接入：`/api/sessions/:id/jobs`、
  `/api/sessions/:id/events` 长轮询、`session/notification` 父级继续（上限 32 次）。

**c. 任务委派扩展**

- `packages/sdk/src/task.ts`：三模式（read / write / full）、可选 `model` + `background`。
  `full` 模式走 `accessMode: "full"`，`write` 模式把 `workspace_write` 风险自动放行、
  其余仍问父级。能力在 dispatch 边界二次校验。
- `packages/config/src/task-models.ts`：`configuredModelIds()` 只从宿主配置里取
  `provider/model`，注释写明 "never accept model-supplied endpoints"。
- `docs/TASK-TOOL.md`：契约、限额、事件与 HTTP 端点、验证范围。

**d. 会话读侧投影（四块）**

- `trajectory.ts`（轨迹分页）、`task-log.ts`（任务状态折叠）、`jobs.ts`（作业状态折叠）、
  `todos.ts`（todo 快照恢复）。共同取向是**只投影已记录的事实**：缺的时间戳不推测，
  未完成的记为 `unknown`。
- `GET /api/sessions/:id/trajectory`，以及 Web 的 `trajectory-view.tsx` /
  `use-trajectory.ts`。`turn` 只在事件 data 里已有数字时才填，否则为 `null`。

**e. 配置层扩张**

- `presets.ts`：57 条 provider 预设 + `OAUTH_DOMAIN_BY_TYPE`。
- `workflows.ts`：内置四个模式 + `~/.ringko/workflows.json`；`workflowAllowsTool()`
  目前无调用点。
- `tool-auth.ts`：`~/.ringko/tool.auth.json`，三种凭证形态。
- `instructions.ts`：全局 + 工程的 `AGENTS.md` / `CLAUDE.md` 发现，首个有命中的类型即停。
- `paths.ts`：新增 `PROJECT_CONFIG_FILE_NAME`（`ringko.json`）、`findProjectRoot()`、
  `projectMcpPaths()`、`projectSkillsDirs()`。

**f. Anthropic OAuth 与配额**

- `packages/auth/src/anthropic.ts`、`packages/providers/src/anthropic/index.ts`。
- `auth/openai.ts` 的 `queryCodexQuota()`、`auth/xai.ts` 的 `queryXaiQuota()`，
  Web 端点 `GET /api/auth/quota`。

**g. REPL 与 Web UI 重构**

- REPL：新增 `editor.ts`、`keybindings.ts`、`launch.tsx`、`selection.ts`、
  `transcript-layout.ts`、`AskDialog.tsx`；删除 `MessageRow.tsx`；`app.tsx` 大幅改写；
  新增 `interactions.test.ts` 与 `terminal.test.tsx`；`package.json` 加 `wrap-ansi`
  与 `string-width`（注释说明是为了正确的 CJK / Unicode 布局，而不是用局部实现替换
  cell-width 逻辑）。
- WebUI：`SettingsPage` 删除，改为 `settings-dialog.tsx` + `settings-panel.tsx`；
  新增 `OAuthPage.tsx` + `lib/oauth.ts`、`mode-picker.tsx`、`task-panel.tsx`、
  `job-panel.tsx`、`question-panel.tsx`；`ConnectorsPage` +289 行；i18n 两个语言各 +107 行。
- `docs/TUI-COMPARISON.md` 记录参考来源、已实现行为、快捷键表与安全审阅范围
  （渲染文本做 OSC/CSI 注入消毒、输入上限 65,536 UTF-16 单元且不切断字素、
  凭据不在 provider 浏览器里显示）。

**h. 工具基座**

- `packages/harness`：`ToolExecutionContext` 增加 `jobs` 与 `approvedTarget`；
  `taskAccess` 元数据；各阶段之间的 `throwIfAborted`；`cancellation.ts` 的 `abortable()`。
- `packages/tools`：`workspace.ts` 引入 `resolveWriteTarget()` 与 canonical 解析；
  `write` / `edit` 消费 `approvedTarget` 做 dispatch 时再校验；`ask.ts` 扩到多问多选
  自定义；`todo.ts` 加 `createTodoReadTool`。
- `packages/providers`：`ai-sdk.ts` 把 system context 经 AI SDK instructions 路由；
  `models.ts`、`openai/oauth.ts`、`github-copilot/index.ts` 随 OAuth 更新。

**i. 事件运行时与 workflow 独立（第四轮）**

- `packages/runtime`（新包，94 行 + 72 行测试）：`EventBus` 提供 `emit` / `parallel` /
  `serial` / `waterfall` 四种分发语义，`on()` / `onWaterfall()` 返回 disposer。目前
  **还没有消费者**——它是为插件层准备的原语。
- `packages/workflow`（新包，158 行 + 41 行测试）：从 `config/src/workflows.ts` 迁出，
  新增 `routeWorkflow()` → `WorkflowRoute{id, instructions, model?, tools?}`。宿主
  `app/src/server.ts` 已改从该包导入，但仍只消费 `instructions`。
- 两个包都 `private: true`，各自带 `bun test` 脚本，已进 `pnpm-workspace` 的构建与
  测试链路。

这批改动**没有改会话格式版本**（仍是 v1），**也没有引入沙箱**——所以第 6 节的结论
不受影响，其中「写路径缺 realpath」与「审批到执行之间无再校验」两条已被修掉，读路径
仍然存在。

## 15. 结论

**RKH 已经对齐的部分**（这些不该再动）：

- 日志是唯一真源，历史从日志派生。
- 工具调用先落盘再执行，中断恢复不重跑副作用。
- 工具注册边界：模型输出无法到达未注册的实现。
- fail-closed 的审批门与串行化提示；审批目标在 dispatch 时再校验（TOCTOU）。
- 并发调度模型（exclusive 屏障 + 滚动并行池 + 结果按调用顺序）。
- 写入路径的 canonical 解析（含新文件的最近存在父目录）。
- MCP 三种 transport、完整 OAuth 与受门约束的工具注册。
- 委派的权限模型：宿主白名单 + dispatch 边界二次校验 + 无递归 + 同步预留预算。
- 事件分发的四种语义（`emit` / `parallel` / `serial` / `waterfall`）与可撤回注册。

**RKH 结构性领先的部分**：

- 一个二进制两个人类界面（TUI + Web），dsh 没有 TUI。
- **四个 OAuth**（ChatGPT / Anthropic Claude Pro-Max / xAI Grok / GitHub Copilot）+ 57 条
  provider 预设 + 订阅配额查询，dsh 自己一个都不实现。
- 单文件分发的发布方式（bun compile，5 个交叉目标）。
- **前台 job 转后台**（`detach()` + Ctrl+B）做成一等操作，dsh 没有对应概念。
- 项目级资源配置（`ringko.json` / 项目 `.mcp.json` / 项目 skills）。

**差距，按「是否值得补」排序**：

1. **读路径的 canonical 校验**。写路径已经补了，读路径没有：`read`、`glob`、`grep` 用
   词法 `workspace.resolve()`，workspace 内指向外部的 symlink 会被判为界内并按
   `workspace_file` 免审批。这是当前最有价值、也最独立的一小步。

2. **workflow 的 allow/deny 接上执行点**。包侧 `routeWorkflow()` 已经把 `tools` 交出来，
   缺的是宿主侧施加，以及 `ToolRegistry` 的受限视图（现在只有 `register`）。按仓库自己的
   规范，这类判断应由执行器强制，而不是靠提示词。

3. **沙箱**。仍是唯一一条「性质不同」的差距。前面两条修完之后，剩下的部分才是进程级
   隔离：先做进程内 fs fence（对应 dsh 的 `fs-sandbox`），再考虑平台 backend。
   注意这一条与第 1 条不同——第 1 条是路径解析正确性，这条是「批准了也越不过边界」。

4. **`EventBus` 接上第一批消费者**。原语已就位，但四个方法目前零调用方。`waterfall`
   一旦被 `agent/pre-step` 或 `tools/pre-execute` 这样的真实拦截点用上，才算是把第 2 节
   的第 3 条不变量落地；同时需要配套的**决策类型**（现在是审批的 `boolean`，dsh 是
   `PreToolDecision = allow | deny | cancel | ask`）。顺带修 `emit` 的
   `void listener(event)`（异步 reject 会变成 unhandled rejection）。

5. **钉住模型可见文本**。这是唯一零覆盖的一类：没有测试断言 tool `description` 或组装后
   的 system prompt，所以改写工具描述、调整 `task` 的 instructions、改动 workflow 引导语
   都不会有测试失败。而这三样直接决定模型行为，属于产品面。做法是把 `tools.list()` 的
   schema 与拼好的 prompt 落成两份快照文件，逐字比对，改了要显式更新。dsh 就是这样做
   （`tool-schemas.expected.json`、`system-prompt.expected.md`）。

6. **turn/step 进日志**。这是剩下的多数能力的前提：`trajectory` 里 `turn` 字段现在恒为
   `null`，子代理无法按回合 fork，压缩无法按回合切。先落 `turn/start`、`step/start`、
   `request`、`step/end`、`turn/end` 五个就够，并把 `deriveMessages()` 变成唯一历史来源。

7. **流式模型调用**。已接上：`packages/providers/src/ai-sdk.ts` 在 `options.stream` 或
   `request.onDelta` 时走 `streamText`，把 `text-delta` / `reasoning-delta` 经 `onDelta`
   送出，`server.ts` 再以 `delta` SSE 事件转发。`generateText` 仍是非流式回退，并且在
   gateway 返回 `invalid_parameter` 时会去掉 `maxOutputTokens` 重试一次。剩下的不是「有没有
   流」，而是增量不落日志：中断发生在结算前，日志里没有半截文本。

8. **Skills 正文注入**。剩下唯一形状相同的缺口。MCP 已经走通了同一条路，Skills 可以照做。

9. **格式迁移链**。现在停在 v1 且无迁移，而事件类型已有 `job/*`、`task/*`、`session/todo`、
   `session/notification` 等一批。趁版本还没分叉立规则，代价比以后补小得多。

**不建议搬的部分**：

- Cordis 的**框架**（effect 生命周期、HMR、profile / bundle / patch 三层装配、包不变量
  门禁）。但它的**分发语义**值得照搬，而 `packages/runtime` 已经这么做了。
- dsh 的文档体系（2412 篇 Agent Note、17 个 gate aggregate、约 100 个 verify 脚本）。
  那是为 321 个包与多团队协作设计的。RKH 现在需要的是**几条能机械检查的不变量**，
  不是一套流程。
- PTC、extensions、agent teams、hooks。这些是 dsh 生态位的产物，不是 agent 宿主的必需品。

**一句话总结**：dsh 是「一切皆可替换」，RKH 是「一条路走通」。四轮之间 RKH 把 MCP（含
OAuth）、作业系统、四个 OAuth、provider 预设、指令注入、项目级资源、事件运行时都做了
出来，缺口从「一片」收敛到三条结构性项（沙箱、回合日志、流式）加六条接线型小项。第四
轮的 `runtime` 是有意义的一步——它是唯一一个「先造原语、暂不接线」的包，而且带了测试。
剩下的风险不再是能力缺失，而是接线与验证的滞后：`routeWorkflow()` 和 `EventBus` 都已经
就位，但都还没有真实消费者；模型可见文本是唯一零覆盖的产品面。上面九条按依赖顺序排，
第 1、2、4、5 条可以在当前结构内做完。

